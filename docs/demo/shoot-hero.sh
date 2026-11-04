#!/bin/sh
# shoot-hero.sh <out> <lang> <theme> [titles…]: stage, wait until the login agent asks, screenshot.
SP=${DEMO_TMP:-${TMPDIR:-/tmp}/tezgah-demo}; mkdir -p "$SP"; HERE=$(cd "$(dirname "$0")" && pwd)
out=$1; shift
$HERE/stage.sh "$@" >/dev/null
for i in $(seq 1 30); do
  s=$(node $HERE/cdp.mjs "(()=>{const st=window.__tezgah.store.getState(); const l=st.ws.sessions[0]; const r=st.panes[l.panes[0].id]?.records?.[0]; return (r?r.state:'-')+'|'+(document.querySelector('webview')?.getURL()||'')})()" 2>/dev/null)
  case "$s" in *blocked*4173*) break;; esac; sleep 1
done
sleep 2.5
node $HERE/cdp.mjs "(async()=>{const w=document.querySelector('webview'); return await w.executeJavaScript('document.body.innerText.slice(0,30)')})()"
node $HERE/shot.mjs "$out"
