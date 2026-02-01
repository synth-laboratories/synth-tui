# Synth Backend OpenAI-Compatible API Implementation Plan

## Overview
Full rewrite of `/api/synth-research/chat/completions` and `/api/synth-research/v1/chat/completions` endpoints to be 100% OpenAI-compatible for OpenCode integration.

## Current State Analysis

### Current Implementation (`backend/app/routes/synth_responses/chat_endpoints.py`)
- ✅ Endpoint exists at `/synth-research/chat/completions` and `/synth-research/v1/chat/completions`
- ✅ Handles authentication via `ValidatedAPIKey`
- ✅ Supports non-streaming responses (works)
- ❌ **Streaming is BROKEN**: `stream_llm_api()` just passes through upstream chunks without ensuring proper SSE format
- ❌ Missing: Proper SSE formatting (`data: ` prefix, `\n\n` separators)
- ❌ Missing: Final `data: [DONE]` signal
- ❌ Missing: Usage stats in final chunk when `stream_options.include_usage=true`
- ❌ Missing: Proper error formatting (OpenAI-style)

### Current `stream_llm_api()` Issues (`backend/app/routes/synth_responses/api_client.py:590-650`)
- Line 640: `yield line + "\n"` - only adds single newline, not double
- No validation that upstream chunks are properly formatted
- No final `[DONE]` signal injection
- No usage aggregation/injection in final chunk

## Required Changes

### 1. Fix SSE Streaming Format (`chat_endpoints.py`)

**File**: `backend/app/routes/synth_responses/chat_endpoints.py`

**Changes needed**:
1. Replace the simple passthrough streaming with proper SSE formatter
2. Ensure all chunks have `data: ` prefix (if not already present)
3. Ensure all chunks end with `\n\n` (double newline)
4. Inject final `data: [DONE]\n\n` after stream completes
5. Aggregate usage stats and inject into final chunk when `stream_options.include_usage=true`

**New streaming function**:
```python
async def format_sse_stream(
    upstream_stream: AsyncIterator[str],
    include_usage: bool = False,
) -> AsyncIterator[str]:
    """
    Transform upstream SSE stream into properly formatted OpenAI-compatible SSE.
    
    Ensures:
    - All chunks have 'data: ' prefix
    - All chunks end with '\n\n'
    - Final chunk includes usage if requested
    - Final 'data: [DONE]' signal is sent
    """
    usage_accumulator = {}
    last_chunk_data = None
    
    async for line in upstream_stream:
        line = line.rstrip()  # Remove trailing whitespace
        
        # Skip empty lines
        if not line:
            continue
            
        # Ensure 'data: ' prefix
        if not line.startswith('data: '):
            # If it's already JSON, wrap it
            if line.startswith('{'):
                line = f'data: {line}'
            else:
                # Skip malformed lines
                continue
        
        # Parse chunk to extract usage if present
        if include_usage:
            try:
                json_part = line[6:]  # Remove 'data: ' prefix
                if json_part != '[DONE]':
                    chunk_data = json.loads(json_part)
                    if 'usage' in chunk_data:
                        usage_accumulator.update(chunk_data['usage'])
                    last_chunk_data = chunk_data
            except json.JSONDecodeError:
                pass
        
        # Ensure double newline
        if not line.endswith('\n\n'):
            if line.endswith('\n'):
                yield line + '\n'
            else:
                yield line + '\n\n'
        else:
            yield line
    
    # Inject usage into final chunk if requested
    if include_usage and usage_accumulator and last_chunk_data:
        # Re-send final chunk with usage
        final_chunk = last_chunk_data.copy()
        final_chunk['usage'] = usage_accumulator
        yield f'data: {json.dumps(final_chunk)}\n\n'
    
    # Always send [DONE]
    yield 'data: [DONE]\n\n'
```

**Update endpoint**:
```python
if is_streaming:
    include_usage = payload_dict.get("stream_options", {}).get("include_usage", False)
    
    async def event_stream() -> AsyncIterator[str]:
        upstream = stream_llm_api(
            payload_dict, llm_api_key, payload.model, timeout_s, use_responses_api=False
        )
        async for chunk in format_sse_stream(upstream, include_usage=include_usage):
            yield chunk

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream; charset=utf-8",  # Add charset
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Transfer-Encoding": "chunked",  # Add explicit chunked encoding
            "X-Accel-Buffering": "no",
        },
    )
```

### 2. Fix Error Responses (`chat_endpoints.py`)

**Wrap all exceptions in OpenAI-style error format**:
```python
from fastapi import HTTPException
from fastapi.responses import JSONResponse

# In endpoint, wrap all exceptions:
try:
    # ... existing code ...
except HTTPException as e:
    # Re-format to OpenAI style if not already
    if isinstance(e.detail, dict) and "error" not in e.detail:
        raise HTTPException(
            status_code=e.status_code,
            detail={
                "error": {
                    "message": str(e.detail.get("detail", e.detail)),
                    "type": e.detail.get("type", "api_error"),
                    "param": e.detail.get("param"),
                    "code": e.detail.get("code"),
                }
            }
        )
    raise
except Exception as e:
    logger.error(f"Unexpected error in chat completions: {e}", exc_info=True)
    raise HTTPException(
        status_code=500,
        detail={
            "error": {
                "message": f"Internal server error: {str(e)}",
                "type": "internal_error",
                "param": None,
                "code": None,
            }
        }
    )
```

### 3. Ensure Non-Streaming Response Format (`chat_endpoints.py`)

**Verify non-streaming response matches OpenAI format exactly**:
```python
# After call_llm_api(), ensure response structure:
response = await call_llm_api(...)

# Validate/transform response structure
if not isinstance(response, dict):
    raise HTTPException(status_code=500, detail={"error": {"message": "Invalid response format"}})

# Ensure required fields exist
if "choices" not in response:
    raise HTTPException(status_code=500, detail={"error": {"message": "Missing choices in response"}})

if "object" not in response:
    response["object"] = "chat.completion"

# Ensure finish_reason is valid
for choice in response.get("choices", []):
    if "finish_reason" not in choice:
        choice["finish_reason"] = None
    elif choice["finish_reason"] not in ["stop", "length", "tool_calls", "content_filter", None]:
        choice["finish_reason"] = "stop"  # Default to stop if invalid

return response
```

### 4. Add `/v1/chat/completions` Route (if not exists)

**Ensure both paths work**:
```python
# Already exists at line 209-214, but verify it's correct:
router.add_api_route(
    "/synth-research/v1/chat/completions",
    synth_research_chat_completions,
    methods=["POST"],
    name="synth_research_chat_completions_v1",
)

# Also add direct /v1 route (without /synth-research prefix) if router is mounted at root:
# This depends on how the router is mounted in main.py
```

### 5. Update Request Model to Accept All OpenAI Fields (`models.py`)

**Make ChatCompletionRequest more permissive**:
```python
class ChatCompletionRequest(BaseModel):
    """OpenAI Chat Completion request format."""
    
    model: str
    messages: list[Message]
    temperature: Optional[float] = Field(default=1.0, ge=0.0, le=2.0)
    max_tokens: Optional[int] = Field(default=None, ge=1)
    max_completion_tokens: Optional[int] = Field(default=None, ge=1)
    top_p: Optional[float] = Field(default=1.0, ge=0.0, le=1.0)
    frequency_penalty: Optional[float] = Field(default=0.0, ge=-2.0, le=2.0)
    presence_penalty: Optional[float] = Field(default=0.0, ge=-2.0, le=2.0)
    stream: Optional[bool] = False
    stream_options: Optional[Dict[str, Any]] = None  # ADD THIS
    n: Optional[int] = Field(default=1, ge=1)
    stop: Optional[list[str] | str] = None
    user: Optional[str] = None
    tools: Optional[list[Dict[str, Any]]] = None
    tool_choice: Optional[Any] = None
    reasoning_effort: Optional[str] = None
    response_format: Optional[Dict[str, Any]] = None  # ADD THIS (for JSON mode)
    extra_body: Optional[Dict[str, Any]] = None
    
    class Config:
        extra = "allow"  # Allow unknown fields (ignore them)
```

### 6. Fix Content Extraction for synth-small/synth-medium (`api_client.py` or model config)

**Issue**: These models return empty content with all tokens in `reasoning_tokens`.

**Fix location**: Likely in `get_model_config()` or response transformation logic.

**Required**: Ensure `message.content` is populated even when reasoning tokens exist.

## Implementation Checklist

### Phase 1: Core SSE Formatting (CRITICAL)
- [ ] Create `format_sse_stream()` function
- [ ] Update `chat_endpoints.py` to use formatter
- [ ] Ensure `data: ` prefix on all chunks
- [ ] Ensure `\n\n` between all chunks
- [ ] Inject `data: [DONE]\n\n` at end
- [ ] Add `charset=utf-8` to Content-Type header
- [ ] Add `Transfer-Encoding: chunked` header

### Phase 2: Usage Stats (REQUIRED)
- [ ] Parse usage from upstream chunks
- [ ] Accumulate usage stats
- [ ] Inject usage into final chunk when `stream_options.include_usage=true`
- [ ] Ensure usage format matches OpenAI spec (prompt_tokens, completion_tokens, total_tokens, optional details)

### Phase 3: Error Handling (REQUIRED)
- [ ] Wrap all exceptions in OpenAI error format
- [ ] Ensure 400/401/403/429/500 errors return proper JSON
- [ ] Test error cases (invalid model, auth failure, rate limit, etc.)

### Phase 4: Request Model Updates (REQUIRED)
- [ ] Add `stream_options` field to `ChatCompletionRequest`
- [ ] Add `response_format` field
- [ ] Set `extra = "allow"` to ignore unknown fields
- [ ] Test with OpenCode's full request payload

### Phase 5: Non-Streaming Validation (REQUIRED)
- [ ] Ensure `object: "chat.completion"` in response
- [ ] Validate `finish_reason` values
- [ ] Ensure `usage` is always present
- [ ] Test non-streaming responses

### Phase 6: Content Extraction Fix (SEPARATE ISSUE)
- [ ] Fix synth-small/synth-medium empty content bug
- [ ] Ensure reasoning tokens don't consume all content tokens
- [ ] Test with actual model responses

## Testing Plan

### Unit Tests
1. Test `format_sse_stream()` with various upstream formats
2. Test usage accumulation and injection
3. Test error formatting
4. Test request model with extra fields

### Integration Tests
1. **Streaming Test**:
   ```bash
   curl -N -X POST "http://localhost:8000/api/synth-research/chat/completions" \
     -H "Authorization: Bearer $SYNTH_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"model":"synth-large-instant","messages":[{"role":"user","content":"hi"}],"stream":true,"stream_options":{"include_usage":true}}'
   ```
   Expected: Proper SSE format with usage in final chunk, ending with `data: [DONE]`

2. **Non-Streaming Test**:
   ```bash
   curl -X POST "http://localhost:8000/api/synth-research/chat/completions" \
     -H "Authorization: Bearer $SYNTH_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"model":"synth-large-instant","messages":[{"role":"user","content":"hi"}]}'
   ```
   Expected: JSON response with `object: "chat.completion"`, `usage`, valid `finish_reason`

3. **Error Test**:
   ```bash
   curl -X POST "http://localhost:8000/api/synth-research/chat/completions" \
     -H "Authorization: Bearer invalid" \
     -H "Content-Type: application/json" \
     -d '{"model":"synth-large-instant","messages":[{"role":"user","content":"hi"}]}'
   ```
   Expected: 401 with OpenAI-style error JSON

### OpenCode Integration Test
1. Configure OpenCode with Synth provider
2. Start OpenCode TUI
3. Send a message through OpenCode
4. Verify:
   - No timeout/hanging
   - Tokens are counted correctly
   - Finish reason is valid (not "unknown")
   - Response appears in UI

## Files to Modify

1. **`backend/app/routes/synth_responses/chat_endpoints.py`**
   - Add `format_sse_stream()` function
   - Update streaming response handler
   - Add error formatting wrapper
   - Add non-streaming response validation

2. **`backend/app/routes/synth_responses/models.py`**
   - Add `stream_options` field
   - Add `response_format` field
   - Set `extra = "allow"` in Config

3. **`backend/app/routes/synth_responses/api_client.py`** (if needed)
   - May need to adjust `stream_llm_api()` to not add extra newlines
   - Or ensure it returns raw upstream chunks

## Dependencies

- No new dependencies required
- Uses existing: `fastapi`, `httpx`, `json`, `asyncio`

## Rollout Plan

1. **Development**: Implement changes in feature branch
2. **Testing**: Run all unit + integration tests
3. **Staging**: Deploy to staging, test with OpenCode
4. **Production**: Deploy with monitoring
5. **Verification**: Confirm OpenCode integration works end-to-end

## Success Criteria

✅ OpenCode can connect to Synth backend  
✅ Streaming requests complete without timeout  
✅ Tokens are counted correctly (not 0)  
✅ Finish reason is valid (not "unknown")  
✅ Usage stats appear in final chunk  
✅ Non-streaming requests work  
✅ Error responses are OpenAI-compatible  
✅ All OpenAI-compatible fields are accepted (even if ignored)

## Notes

- **No backward compatibility needed**: User confirmed these routes aren't used by anything else
- **Full rewrite acceptable**: Can change behavior completely
- **Focus on OpenAI compatibility**: Match OpenAI API exactly
- **Test thoroughly**: OpenCode SDK validates responses strictly




