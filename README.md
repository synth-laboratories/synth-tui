# synth-tui

This repo contains the synth-ai TUI (Terminal User Interface).

## Structure

```
synth-tui/
├── app/                 # OpenTUI JS app
│   ├── src/             # TypeScript source
│   ├── dist/            # Built bundle (index.mjs)
│   ├── package.json
│   └── tests/
├── python/
│   └── synth_tui/        # Python launcher + helpers
├── opencode_config/
├── scripts/
└── tests/
```

## Build the JS bundle

```bash
cd app
bun install
bun run build
```

## Install via Homebrew

```bash
brew tap synth-laboratories/tap
brew install synth-tui
```

Or in one command:

```bash
brew install synth-laboratories/tap/synth-tui
```

Then run:

```bash
synth-tui
```

The first run will install JavaScript dependencies (~5 seconds).

## Entry point

```python
from synth_tui import run_tui
run_tui()
```

Note: the Python launcher depends on the `synth-ai` package (`synth_ai.core.*`).

## Keyboard shortcuts

- `r` refresh
- `c` cancel
- `a` artifacts
- `s` snapshot (opens modal)
- `q` quit
