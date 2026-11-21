#!/bin/bash
# Records the demo: stages three small projects under ~/acme (with history, changes and past conversations),
# plays the story in Tezgah Dev (see Sources/Tezgah/App/DemoRecorder.swift), and turns the frames into
#   docs/media/demo.mp4, demo.gif, demo-poster.jpg and four stills (home, board, waiting, session)   (English)
#   the same with -tr in their names                                                                (Turkish)
# ~/acme and the staged conversations are removed again. Needs node and ffmpeg.
#
#   scripts/demo/record.sh          # both languages
#   scripts/demo/record.sh en       # one
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT=$PWD
ACME="$HOME/acme"
CLAUDE="$HOME/.claude/projects/$(printf '%s' "$ACME/web" | sed 's/[^A-Za-z0-9]/-/g')"
[ -e "$ACME" ] && { echo "~/acme already exists; move it away first"; exit 1; }
[ -e "$CLAUDE" ] && { echo "$CLAUDE already exists"; exit 1; }
cleanup() { rm -rf "$ACME" "$CLAUDE"; }
trap cleanup EXIT

stage() {
  mkdir -p "$ACME/$1" && cd "$ACME/$1"
  git init -q -b main
  shift
  for f in "$@"; do mkdir -p "$(dirname "$f")"; printf '// %s\n' "$f" > "$f"; done
  git add -A && git -c user.name=Acme -c user.email=dev@acme.test commit -q -m "Start"
  cd "$ROOT"
}
stage web src/auth/session.ts src/App.tsx src/styles/tokens.css src/components/Header.tsx package.json
stage api app/payments.py tests/conftest.py tests/payments/test_refund.py migrations/024.sql
stage docs README.md guide/export.md
# What the agent in the story will have changed by the time the board is shown.
printf '// refresh once, then reject\nexport const maxAge = 3600\n' >> "$ACME/web/src/auth/session.ts"
printf 'test("rejects an expired token", () => {})\n' > "$ACME/web/src/auth/session.test.ts"
printf '/* dark */\n' >> "$ACME/web/src/styles/tokens.css"

# Conversations Claude Code "had" in ~/acme/web, for the board's list.
mkdir -p "$CLAUDE"
conv() { # id, minutes ago, title
  printf '{"type":"user","message":{"role":"user","content":"%s"},"sessionId":"%s"}\n{"type":"ai-title","aiTitle":"%s","sessionId":"%s"}\n' "$3" "$1" "$3" "$1" > "$CLAUDE/$1.jsonl"
  touch -t "$(date -v-"$2"M +%Y%m%d%H%M)" "$CLAUDE/$1.jsonl"
}
conv 3f2a9c1e-7b64-4d0a-9a51-0c8e4f6b2d10 95 "Dark mode that follows the system"
conv 8d5e1b7a-2c39-4f86-b0d4-6a7c9e3f1b52 1500 "Header layout on small screens"
conv c4b8e2f6-9a1d-4e73-8c5b-2f0d7a6e9b34 4400 "Set up the test runner"

xcodegen generate >/dev/null
xcodebuild -project TezgahMac.xcodeproj -scheme Tezgah -configuration Debug -derivedDataPath build/DD build 2>&1 | grep -E "error:|BUILD"
APP="build/DD/Build/Products/Debug/Tezgah Dev.app/Contents/MacOS/Tezgah Dev"
mkdir -p docs/media

take() { # language, file suffix
  local out; out=$(mktemp -d)
  "$APP" --snapshot "$out" --demo -AppleLanguages "($1)" 2>&1 | grep "demo:" | tail -25 || true
  local frames="$out/frames"
  [ -f "$frames/frames.txt" ] || { echo "no frames for $1"; exit 1; }
  # A steady 30 frames a second from frames taken as fast as the app could draw them.
  ffmpeg -y -loglevel error -f concat -safe 0 -i "$frames/frames.txt" -vf "fps=30,scale=1920:-2:flags=lanczos,format=yuv420p" \
    -c:v libx264 -crf 21 -preset slow -movflags +faststart "docs/media/demo$2.mp4"
  ffmpeg -y -loglevel error -i "docs/media/demo$2.mp4" -vf "fps=12,scale=1100:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4" "docs/media/demo$2.gif"
  ffmpeg -y -loglevel error -ss 17 -i "docs/media/demo$2.mp4" -frames:v 1 -q:v 3 "docs/media/demo$2-poster.jpg"
  # Stills from the same take, for the README and the site.
  ffmpeg -y -loglevel error -ss 4.2 -i "docs/media/demo$2.mp4" -frames:v 1 -q:v 2 "docs/media/home$2.jpg"
  ffmpeg -y -loglevel error -ss 6.6 -i "docs/media/demo$2.mp4" -frames:v 1 -q:v 2 "docs/media/board$2.jpg"
  ffmpeg -y -loglevel error -ss 17 -i "docs/media/demo$2.mp4" -frames:v 1 -q:v 2 "docs/media/waiting$2.jpg"
  ffmpeg -y -loglevel error -ss 23 -i "docs/media/demo$2.mp4" -frames:v 1 -q:v 2 "docs/media/session$2.jpg"
  rm -rf "$out"
  ls -lh "docs/media/demo$2.mp4" "docs/media/demo$2.gif" | awk '{print $5, $9}'
}
case "${1:-both}" in
  en) take en "" ;;
  tr) take tr "-tr" ;;
  *) take en ""; take tr "-tr" ;;
esac
