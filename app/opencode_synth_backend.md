# OpenCode + Synth Backend Integration

## Current Status: BROKEN (streaming)
OpenCode requests return 0 tokens and "unknown" finish reason after ~16 minute timeout.

## Root Cause
**The Synth backend does NOT support SSE streaming responses.**

OpenCode's `@ai-sdk/openai-compatible` SDK **always uses streaming** (`stream: true`). The backend hangs on streaming requests.

---

## What Synth Backend MUST Implement

### 1. Endpoint
```
POST /v1/chat/completions

# Compatibility alias (optional but recommended if your deployed path is namespaced):
POST /api/synth-research/chat/completions
```

### 2. Request Format (what OpenCode sends)
```json
{
  "model": "synth-large-instant",
  "messages": [
    {"role": "system", "content": "..."},
    {"role": "user", "content": "..."}
  ],
  "stream": true,
  "stream_options": { "include_usage": true },
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "tool_name",
        "description": "optional",
        "parameters": { "type": "object", "properties": {}, "required": [] }
      }
    }
  ],
  "tool_choice": "auto",
  "max_tokens": 8192,
  "temperature": 0.7
}
```

**Notes:**
- `stream: true` is ALWAYS sent. The backend MUST handle this.
- The AI SDK/OpenCode may include additional OpenAI-compatible fields (e.g. `response_format`, `top_p`, `stop`, tool-calling variants, etc). The backend should **ignore unknown fields** instead of failing.
- `messages[].content` may also be an array of parts (multimodal style), e.g. `[{ "type": "text", "text": "..." }, { "type": "image_url", "image_url": { "url": "data:..." } }]`. If unsupported, return a clear 400 error (see Errors section).

### 3. Response Headers (REQUIRED)
```http
HTTP/1.1 200 OK
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache
Connection: keep-alive
Transfer-Encoding: chunked
```

### 4. SSE Response Format (REQUIRED)

Each chunk must be a Server-Sent Event with `data:` prefix:

```
data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"synth-large-instant","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"synth-large-instant","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"synth-large-instant","choices":[{"index":0,"delta":{"content":"!"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"synth-large-instant","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}

data: [DONE]

```

**Critical Format Details:**
- Each line must start with `data: ` (note the space)
- Each event must be followed by TWO newlines (`\n\n`)
- Final event must be `data: [DONE]\n\n`
- JSON must be on a single line (no pretty printing)

### 5. Chunk Schema (validated by SDK)

```typescript
{
  id: string | null,           // e.g., "chatcmpl-abc123"
  object?: "chat.completion.chunk",
  created: number | null,      // Unix timestamp
  model: string | null,        // e.g., "synth-large-instant"
  choices: [{
    index: number,             // Usually 0
    delta: {
      role?: "assistant",      // Only in first chunk
      content?: string,        // Text content delta
      reasoning_content?: string,  // For thinking models
      tool_calls?: [{          // For tool use
        index: number,
        id?: string,
        function: {
          name?: string,
          arguments?: string
        }
      }]
    },
    finish_reason: string | null  // null until final chunk, then "stop", "length", "tool_calls", etc.
  }],
  usage?: {                    // Only in final chunk when stream_options.include_usage=true
    prompt_tokens: number,
    completion_tokens: number,
    total_tokens: number,
    prompt_tokens_details?: {
      cached_tokens?: number
    },
    completion_tokens_details?: {
      reasoning_tokens?: number
    }
  }
}
```

### 6. Example Python Implementation

```python
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
import json
import asyncio

app = FastAPI()

@app.post("/api/synth-research/chat/completions")
async def chat_completions(request: dict):
    if request.get("stream", False):
        return StreamingResponse(
            stream_response(request),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            }
        )
    else:
        # Non-streaming response (already works)
        return await generate_response(request)

async def stream_response(request: dict):
    model = request.get("model", "synth-large-instant")

    # First chunk: role
    yield f'data: {json.dumps({"id": "chatcmpl-123", "object": "chat.completion.chunk", "created": 1234567890, "model": model, "choices": [{"index": 0, "delta": {"role": "assistant"}, "finish_reason": None}]})}\n\n'

    # Content chunks
    response_text = "Hello! How can I help you today?"
    for char in response_text:
        yield f'data: {json.dumps({"id": "chatcmpl-123", "object": "chat.completion.chunk", "created": 1234567890, "model": model, "choices": [{"index": 0, "delta": {"content": char}, "finish_reason": None}]})}\n\n'
        await asyncio.sleep(0.01)  # Simulate token generation

    # Final chunk with finish_reason and usage
    include_usage = request.get("stream_options", {}).get("include_usage", False)
    final_chunk = {
        "id": "chatcmpl-123",
        "object": "chat.completion.chunk",
        "created": 1234567890,
        "model": model,
        "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]
    }
    if include_usage:
        final_chunk["usage"] = {
            "prompt_tokens": 10,
            "completion_tokens": len(response_text),
            "total_tokens": 10 + len(response_text)
        }
    yield f'data: {json.dumps(final_chunk)}\n\n'

    # Done signal
    yield 'data: [DONE]\n\n'
```

### 7. Non-Streaming Response (REQUIRED for curl/debugging)

Even if OpenCode always streams, `stream: false` should return a standard OpenAI-compatible JSON response:

- `object: "chat.completion"`
- `choices[0].message.content` or `choices[0].message.tool_calls`
- `choices[0].finish_reason` in `"stop" | "length" | "tool_calls" | "content_filter" | null`
- `usage` populated (prompt/completion/total tokens)

### 8. Errors (REQUIRED)

For non-2xx responses, return OpenAI-style error JSON (this is what `@ai-sdk/openai-compatible` parses):

```json
{
  "error": {
    "message": "human readable message",
    "type": null,
    "param": null,
    "code": "optional-string-or-number"
  }
}
```

---

## Authentication

### How OpenCode Passes Credentials

1. **Environment Variable** (preferred):
   ```bash
   export SYNTH_API_KEY="<SYNTH_API_KEY>"
   ```
   OpenCode checks `env: ["SYNTH_API_KEY"]` in config.

2. **Auth File** (`~/.config/opencode/auth.json`):
   ```json
   {
     "synth": {
       "apiKey": "<SYNTH_API_KEY>"
     }
   }
   ```

3. **Config File** (`~/.config/opencode/opencode.json`):
   ```json
   {
     "provider": {
       "synth": {
         "options": {
           "apiKey": "<SYNTH_API_KEY>"
         }
       }
     }
   }
   ```

### Request Headers (sent by SDK)
```http
Authorization: Bearer <SYNTH_API_KEY>
Content-Type: application/json
User-Agent: ai-sdk/openai-compatible/0.1.0
```

---

## OpenCode Configuration (Complete)

### ~/.config/opencode/opencode.json
```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "synth": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Synth",
      "api": "https://<SYNTH_BACKEND_HOST>/api/synth-research",
      "env": ["SYNTH_API_KEY"],
      "options": {
        "baseURL": "https://<SYNTH_BACKEND_HOST>/api/synth-research",
        "apiKey": "<SYNTH_API_KEY>"
      },
      "models": {
        "synth-small": {
          "name": "Synth Small (GPT-4o-mini)",
          "tool_call": true,
          "temperature": true,
          "attachment": false,
          "reasoning": false,
          "limit": { "context": 128000, "output": 16384 }
        },
        "synth-medium": {
          "name": "Synth Medium (GPT-4o)",
          "tool_call": true,
          "temperature": true,
          "attachment": false,
          "reasoning": false,
          "limit": { "context": 128000, "output": 16384 }
        },
        "synth-large-instant": {
          "name": "Synth Large Instant (Claude Sonnet)",
          "tool_call": true,
          "temperature": true,
          "attachment": false,
          "reasoning": false,
          "limit": { "context": 200000, "output": 8192 }
        },
        "synth-large-thinking": {
          "name": "Synth Large Thinking (Claude Sonnet)",
          "tool_call": true,
          "temperature": true,
          "attachment": false,
          "reasoning": true,
          "limit": { "context": 200000, "output": 16384 }
        }
      },
      "blacklist": ["gpt-4o-mini", "gpt-4o", "claude-sonnet-4-20250514"]
    }
  },
  "model": "synth/synth-large-instant",
  "default_agent": "coder"
}
```

---

## Testing

### Test Non-Streaming (works)
```bash
curl -X POST "https://<SYNTH_BACKEND_HOST>/api/synth-research/chat/completions" \
  -H "Authorization: Bearer <SYNTH_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"model":"synth-large-instant","messages":[{"role":"user","content":"hi"}]}'
```

### Test Streaming (MUST FIX)
```bash
curl -N -X POST "https://<SYNTH_BACKEND_HOST>/api/synth-research/chat/completions" \
  -H "Authorization: Bearer <SYNTH_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"model":"synth-large-instant","messages":[{"role":"user","content":"hi"}],"stream":true}'
```

Expected output (currently hangs):
```
data: {"id":"...","choices":[{"delta":{"role":"assistant"}}]}

data: {"id":"...","choices":[{"delta":{"content":"Hi"}}]}

data: {"id":"...","choices":[{"delta":{"content":"!"}}]}

data: {"id":"...","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{...}}

data: [DONE]

```

---

## Known Backend Issues (Separate from Streaming)

### synth-small and synth-medium Return Empty Content
These models return empty `content` with all tokens going to `reasoning_tokens`:
```json
{
  "choices": [{
    "message": {
      "content": "",  // Empty!
      "refusal": null
    }
  }],
  "usage": {
    "completion_tokens_details": {
      "reasoning_tokens": 100  // All tokens here
    }
  }
}
```

**Fix:** Ensure content is properly extracted from the underlying model response.

---

## Summary

| Issue | Status | Fix Required |
|-------|--------|--------------|
| Streaming support | BROKEN | Backend must implement SSE |
| Authentication | WORKING | Env var or config |
| synth-large-instant | WORKING (non-stream) | Add streaming |
| synth-small/medium | BROKEN | Fix content extraction |

---

## Implementation Plan

See **[IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)** for detailed implementation steps, code changes, and testing plan.

**Quick Summary**:
1. Fix SSE formatting in `chat_endpoints.py` (add `format_sse_stream()` function)
2. Ensure proper `data: ` prefix and `\n\n` separators
3. Inject `data: [DONE]\n\n` at end
4. Add usage stats to final chunk when `stream_options.include_usage=true`
5. Format all errors as OpenAI-style JSON
6. Update request model to accept `stream_options` and other OpenAI fields
7. Validate non-streaming responses match OpenAI format

**Files to modify**:
- `backend/app/routes/synth_responses/chat_endpoints.py` (main changes)
- `backend/app/routes/synth_responses/models.py` (add fields)
- `backend/app/routes/synth_responses/api_client.py` (minor adjustments)
