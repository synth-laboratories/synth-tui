#!/usr/bin/env bash
set -euo pipefail

find_app_dir() {
  local candidate=""
  for root in \
    "${TEST_SRCDIR:-}" \
    "${RUNFILES_DIR:-}" \
    "$(pwd)"
  do
    [[ -n "$root" ]] || continue
    candidate="$(find "$root" -path '*/synth_tui+/app/package.json' -print -quit 2>/dev/null || true)"
    if [[ -n "$candidate" ]]; then
      dirname "$candidate"
      return 0
    fi
  done
  return 1
}

app_dir="$(find_app_dir)"
cd "${app_dir}"

bun install --frozen-lockfile
bun test tests/tui_data.test.ts tests/solid_migration.test.ts
