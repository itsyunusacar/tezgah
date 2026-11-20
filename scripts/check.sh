#!/bin/bash
# Everything that can be checked without a person at the keyboard: the unit tests, then the app itself,
# started for real and driven with real clicks (the bar over a scrolling page, closing one of three panes).
#
#   scripts/check.sh            # tests + click tests
#   scripts/check.sh --agents   # also starts the agents on this Mac (Claude Code, Grok) and a silent one,
#                               # and checks their state and conversation are followed
#   scripts/check.sh --shots    # also renders every screen to build/shots (look at the ones you changed)
#
# The app runs with a throwaway workspace and leaves your projects, sessions and settings alone.
set -euo pipefail
cd "$(dirname "$0")/.."

xcodegen generate >/dev/null
echo "unit tests…"
if ! xcodebuild -project TezgahMac.xcodeproj -scheme Tezgah -derivedDataPath build/DD test > build/check-tests.log 2>&1; then
  grep -E "error:|✘|failed" build/check-tests.log | head -20
  echo "FAILED: unit tests (build/check-tests.log)"; exit 1
fi
grep -E "Test run with|Executed [0-9]+ tests" build/check-tests.log | tail -2

APP="build/DD/Build/Products/Debug/Tezgah Dev.app/Contents/MacOS/Tezgah Dev"
OUT=$(mktemp -d)
ARGS=(--snapshot "$OUT" --click-test)
[[ " $* " == *" --agents "* ]] && ARGS+=(--with-agents --with-claude)
echo "the app, for real…"
"$APP" "${ARGS[@]}" 2>&1 | grep "test:" | tee build/check-app.log
if grep -q "FAILED" build/check-app.log || [ "$(grep -c "test:" build/check-app.log)" -lt 2 ]; then
  echo "FAILED: the app (build/check-app.log)"; exit 1
fi

if [[ " $* " == *" --shots "* ]]; then
  rm -rf build/shots && mkdir -p build/shots
  "$APP" --snapshot build/shots >/dev/null 2>&1
  echo "screens: build/shots ($(ls build/shots | wc -l | tr -d ' ') images)"
fi
echo "ok"
