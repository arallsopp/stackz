#!/usr/bin/env bash
# PostToolUse hook: after an Edit/Write to source, verify the project still
# builds so breakage surfaces immediately during agentic development.
# Only acts on files that affect the build; otherwise exits silently.
set -uo pipefail

input=$(cat)
f=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')

case "$f" in
  */src/*.js | */src/*.css | */vite.config.js | */index.html) ;;
  *) exit 0 ;;
esac

dir="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$dir" || exit 0

if ! out=$(npm run build 2>&1); then
  {
    echo "STACKZ build FAILED after editing $f — fix before continuing:"
    printf '%s\n' "$out" | tail -25
  } >&2
  exit 2
fi
exit 0
