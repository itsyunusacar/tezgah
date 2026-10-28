#!/bin/sh
# Usage: stage.sh <lang> <theme>   — launches Tezgah with the demo set up, leaves it running on :9333
SP=${DEMO_TMP:-${TMPDIR:-/tmp}/tezgah-demo}; mkdir -p "$SP"; HERE=$(cd "$(dirname "$0")" && pwd)
pkill -f "remote-debugging-port=9333"; pkill -f "http.server 4173"; sleep 1
rm -rf $SP/demo-profile; mkdir -p $SP/demo-profile
printf '{"language":"%s","theme":"%s","introSeen":true,"notify":false,"checkUpdates":false,"agentTools":false,"hiddenUsage":["codex"]}' "$1" "$2" > $SP/demo-profile/settings.json
python3 -c 'import json,time,os,sys; d=json.load(open(os.path.expanduser("~/Library/Application Support/Tezgah/claude-limits.json"))); n=int(time.time()*1000); d["asOf"]=n; [l.update(resetsAt=n+8280000) for l in d["limits"] if l.get("resetsAt",0)<n]; json.dump(d,open(sys.argv[1],"w"))' "$SP/demo-profile/claude-limits.json" 2>/dev/null
cd "$HERE/../.." && (TEZGAH_USER_DATA=$SP/demo-profile npx electron . --remote-debugging-port=9333 > $SP/demo.log 2>&1 &)
sleep 7
A="node $HERE/fake-agent.mjs"
node $HERE/cdp.mjs "(async () => {
  const T = window.__tezgah, A = T.actions, wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const mk = (proj, title, command) => { const s = A.newSession(proj.id, 'shell'); A.updatePane(s.id, s.panes[0].id, { command }); A.retitle(s.id, title); return s }
  const web = A.addProject('/Users/Shared/demo/acme-web'), api = A.addProject('/Users/Shared/demo/acme-api'), docs = A.addProject('/Users/Shared/demo/acme-docs')
  const ids = {}
  ids.login = mk(web, '$3' || 'Fix expired login tokens', 'clear; $A login').id
  ids.dark = mk(web, '$4' || 'Dark mode', 'clear; $A darkmode').id
  ids.dev = mk(web, '$5' || 'Dev server', 'clear; python3 -m http.server 4173 --bind 127.0.0.1').id
  ids.codex = mk(api, '$6' || 'Migrate orders table', 'clear; $A codex').id
  ids.tests = mk(api, '$7' || 'Flaky payment tests', 'clear; $A tests').id
  ids.grok = mk(docs, '$8' || 'Export docs', 'clear; $A grok').id
  for (const k of ['grok', 'tests', 'codex', 'dev', 'dark', 'login']) { A.select(ids[k]); await wait(900) }
  await wait(1500)
  await wait(2500)
  const login = A.session(ids.login)
  A.openBrowser('http://localhost:4173', ids.login)
  A.focusPane(ids.login, login.panes[0].id)
  window.__ids = ids
  return JSON.stringify(ids)
})()"
