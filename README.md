# Tezgah (native macOS)

Tezgah as a native Mac app, a terminal for working with AI coding agents across many projects: AppKit window + SwiftUI views,
terminals drawn by libghostty ([libghostty-spm](https://github.com/Lakr233/libghostty-spm) 2.2.2026103001)
with a pty Tezgah owns, so it can read and answer OSC 7501 (agent status).

```sh
xcodegen generate
xcodebuild -project TezgahMac.xcodeproj -scheme Tezgah -configuration Debug -derivedDataPath build/DD build
xcodebuild -project TezgahMac.xcodeproj -scheme Tezgah -derivedDataPath build/DD test
open "build/DD/Build/Products/Debug/Tezgah Dev.app"
```

- Tezgah opens on home: every project and every agent (waiting, working, finished). The strip beside a
  session lists all projects with their sessions; a project's board (⇧⌘B) has its sessions, changes and
  Claude Code conversations (`~/.claude/projects/…`), each one click from being resumed.
- Claude Code is started under an id Tezgah picks (`--session-id`), so after a restart each pane returns
  to its own conversation (`--resume`). First messages and one-off commands are never typed again.
- Agents: Claude Code and Grok say what they are doing themselves (OSC 7501) and are started under an id
  Tezgah picks, so each pane returns to its conversation; Codex gets a hook for the run. Any other
  command-line agent can be added in Settings › Agents: its state (working, waiting for you, done) is
  read from what its screen does (`TezgahCore/PaneWatch.swift`).
- Shells: zsh reads one file of Tezgah's first (`AgentHooks.zshenv`), which hands control straight back to
  the user's own files, then puts Tezgah's `claude`/`codex` shims first on the PATH and says when the
  shell is ready for a command. bash and fish get the same through `PROMPT_COMMAND` and `-C`.
- `scripts/check.sh` runs the unit tests and then the app itself with real clicks; `--agents` also starts
  the agents on this Mac, `--shots` renders every screen to `build/shots`.
- Data: `~/Library/Application Support/Tezgah Dev/workspace.json`; `--workspace <dir>` keeps it elsewhere.
- `--verbose` logs agent status changes to stderr.
- `--snapshot <dir>` builds a demo workspace (real shells, `docs/demo/fake-agent.mjs` from the
  Electron repo), renders welcome / board / session / agents in light and dark to PNGs and quits.

Layout: `Sources/TezgahCore` (OSC 7501 parser, stream scanner, layout tree, workspace file; unit
tested), `Sources/Tezgah` (app: pty, panes, store, views).
