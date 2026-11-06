# Tezgah Prototype (native macOS)

A decision-gate prototype of Tezgah as a native Mac app: AppKit window + SwiftUI views,
terminals drawn by libghostty ([libghostty-spm](https://github.com/Lakr233/libghostty-spm) 2.2.2026103001)
with a pty Tezgah owns, so it can read and answer OSC 7501 (agent status).

```sh
xcodegen generate
xcodebuild -project TezgahMac.xcodeproj -scheme Tezgah -configuration Debug -derivedDataPath build/DD build
xcodebuild -project TezgahMac.xcodeproj -scheme Tezgah -derivedDataPath build/DD test
open "build/DD/Build/Products/Debug/Tezgah Prototype.app"
```

- Data: `~/Library/Application Support/Tezgah Prototype/workspace.json`
- `--verbose` logs agent status changes to stderr.
- `--snapshot <dir>` builds a demo workspace (real shells, `docs/demo/fake-agent.mjs` from the
  Electron repo), renders welcome / board / session / agents in light and dark to PNGs and quits.

Layout: `Sources/TezgahCore` (OSC 7501 parser, stream scanner, layout tree, workspace file; unit
tested), `Sources/Tezgah` (app: pty, panes, store, views).
