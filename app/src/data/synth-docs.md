# Synth AI Platform Documentation

## Overview

Synth is an AI-powered platform for prompt engineering, evaluation, and optimization. You are running inside the Synth TUI (Terminal User Interface) with access to the user's working directory.

## CLI Commands

### synth-ai eval
Run evaluations against task apps.

```bash
# Run eval with default config
synth-ai eval --config eval_config.toml

# Run eval and poll for results
synth-ai eval --config eval_config.toml --poll
```

### synth-ai train
Run GEPA (Generative Evolutionary Prompt Amplification) optimization.

```bash
# Run GEPA optimization
synth-ai train --config gepa_config.toml --poll

# Specify number of rollouts
synth-ai train --config gepa_config.toml --rollouts 50 --poll
```

### synth-ai agent run
Execute research agents for automated experimentation.

```bash
# Run a research agent
synth-ai agent run --config agent_config.toml
```

### synth-ai scan
Discover local task apps and tunnels.

```bash
# Scan for task apps
synth-ai scan

# Scan specific port range
synth-ai scan --port-range 8000-8100

# Output as JSON
synth-ai scan --json
```

## API Endpoints

### POST /api/eval/jobs
Create an evaluation job.

```json
{
  "task_app_url": "https://your-app.tunnel.usesynth.ai",
  "config": { ... }
}
```

### POST /api/prompt-learning/jobs
Create a GEPA optimization job.

```json
{
  "task_app_url": "https://your-app.tunnel.usesynth.ai",
  "rollouts": 50,
  "config": { ... }
}
```

### POST /api/graphgen/jobs
Create a graph generation job.

### GET /api/research-agent/jobs
List research agent jobs.

## Configuration Files

### TOML Config Format

```toml
[task]
name = "my_task"
app_url = "http://localhost:8000"

[eval]
num_samples = 100

[optimization]
rollouts = 50
method = "gepa"
```

## Task Apps

Task apps are your application endpoints that Synth evaluates and optimizes. They can be:

1. **Local apps**: Running on localhost (e.g., http://localhost:8000)
2. **Tunnel apps**: Exposed via Cloudflare tunnels (e.g., https://myapp.tunnel.usesynth.ai)

### Required Endpoints

- `GET /health` - Health check endpoint
- `GET /info` - Returns app metadata (task name, version, etc.)
- `POST /run` - Execute the task with input data

## Working with Jobs

Jobs are tracked in the TUI Jobs panel. You can:

1. View job status and progress
2. See evaluation metrics
3. Access optimized prompts

### Job Types

- **Eval**: Runs evaluation dataset against your task app
- **GEPA**: Optimizes prompts using evolutionary algorithms
- **GraphGen**: Generates task graphs
- **Research Agent**: Automated experimentation

## Best Practices

1. **Always use --poll flag** for long-running jobs to see real-time progress
2. **Check job status** in the TUI Jobs panel (press 'j' to toggle)
3. **Use tunnels** for reliable connectivity with backend services
4. **Version your configs** to track optimization experiments

## Environment Variables

- `SYNTH_API_KEY`: Your Synth API key
- `OPENCODE_WORKING_DIR`: Override working directory for OpenCode
- `SYNTH_SCAN_PORT_RANGE`: Port range for local app scanning (default: 8000-8100)
