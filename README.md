<p align="center"><img src="resources/icon.png" width="112" alt="Tezgah"></p>

<h1 align="center">Tezgah</h1>

<p align="center"><i>tezgâh</i> — Turkish for workbench. A terminal for working with AI coding agents.</p>

Tezgah keeps your projects in a sidebar and the sessions you run in each one under it. Every [Claude Code](https://claude.com/claude-code) session tells you what it's doing — working, waiting for you, done — and lists the subagents it has running, so you can keep several going and still know where to look. It runs on macOS, Windows and Linux.

> **Early version.** This is a rewrite of the first Tezgah (a macOS-only Swift app, kept in [tezgah-legacy](https://github.com/itsyunusacar/tezgah-legacy)) into something smaller that runs everywhere.

## What it does

- **Projects and sessions.** A project is a folder; sessions live under it. A session is usually one Claude Code conversation, or a plain shell.
- **Live status, no setup.** Claude Code reports its state to the terminal (OSC 7501). Tezgah shows it on each session — *Working*, *Needs you*, *Done* — with a badge for the ones waiting on you and a notification when you're elsewhere.
- **Allow or Deny from the sidebar.** When Claude asks for a permission, answer it without switching to the session.
- **Subagents.** While Claude runs subagents, the session lists each one and what it's doing right now.
- **Conversations that resume.** Each Claude session is pinned to its conversation, so quitting and reopening Tezgah picks up where you left off. ⇧⌘O reopens any past conversation.
- **Split panes.** Put a shell or a dev server next to Claude in the same session.
- **Changes.** The session's diff, against its base branch or uncommitted. Click a line to leave a note, then send all notes to Claude in one message.
- **Worktree sessions.** A session can get its own git branch and folder (`<repo>.worktrees/<branch>`) so parallel agents don't touch each other's files. Merge it back from the session's menu.
- **Plan limits.** Claude's 5-hour and weekly limits, and Codex's, at the bottom of the sidebar: how much is used, when each resets, and a tick for how far into the window you are.
- **What's running where.** Each session shows its git branch, the ports its programs listen on (click one to open it) and the branch's pull request when the [GitHub CLI](https://cli.github.com) is installed.
- **Notifications that don't get lost.** A pane that finished or called for you while you looked away gets a blue ring. ⌘I lists every notification, ⇧⌘U jumps to the newest unread. Other agents and scripts can notify too, with OSC 9, 777 or 99, or `tezgah notify`.
- **A browser your agents can use.** Open your dev server, docs or a PR in a pane beside the terminal. Agents read the page, click, fill forms, press keys, take screenshots and check the console and network, so they can try what they built. It keeps working while you look at another session.
- **Follow a subagent.** Click one to read its task, tool calls and results as it works.
- **Find** in any terminal (⌘F), **drop or paste files and screenshots** to type their paths, **SSH sessions** that upload dropped files, and shell panes that keep their screen across relaunches.
- **Your own commands** (Settings → Commands) in the quick switcher, each running in a new pane. Codex, Gemini CLI or any other agent fits here.
- Light and dark, Geist type, optional font and colors from your Ghostty config, a quick switcher, and keyboard shortcuts for everything.

## Install

Download the latest build for your system from [Releases](https://github.com/itsyunusacar/tezgah/releases):

- **macOS:** `Tezgah-<version>-arm64.dmg` (Apple silicon) or `-x64.dmg` (Intel). Builds aren't notarized yet: the first time, right-click Tezgah in Applications and choose *Open*.
- **Windows:** `Tezgah-Setup-<version>-x64.exe`.
- **Linux:** `Tezgah-<version>-x86_64.AppImage` (make it executable and run it) or the `.deb`.

You need [Claude Code](https://claude.com/claude-code) installed as `claude` for Claude sessions. Shell sessions work without it.

## Keyboard shortcuts

On Windows and Linux, plain Ctrl+letter keys belong to the shell, so Tezgah uses Ctrl+Shift.

| Action | macOS | Windows / Linux |
| --- | --- | --- |
| New Claude session / shell session | ⌘T / ⇧⌘T | Ctrl+Shift+T / Ctrl+Shift+N |
| New session in a worktree | ⌥⌘T | Ctrl+Alt+Shift+T |
| Open folder / recent conversations | ⌘O / ⇧⌘O | Ctrl+Shift+O / Ctrl+Shift+H |
| Go to session | ⌘P | Ctrl+Shift+P |
| Next session that needs you | ⌘J | Ctrl+Shift+J |
| Allow / Deny | ⇧⌘↩ / ⇧⌘⌫ | Ctrl+Shift+Enter / Ctrl+Shift+Backspace |
| Split right / down | ⌘D / ⌥⌘D | Alt+Shift+= / Alt+Shift+- |
| Changes | ⇧⌘D | Ctrl+Shift+G |
| Close pane / session | ⌘W / ⇧⌘W | Ctrl+Shift+W / Ctrl+Alt+Shift+W |
| Session 1–9 | ⌘1 … ⌘9 | Alt+1 … Alt+9 |
| Copy / paste | ⌘C / ⌘V | Ctrl+Shift+C / Ctrl+Shift+V |
| Find | ⌘F | Ctrl+Shift+F |
| Notifications / latest unread | ⌘I / ⇧⌘U | Ctrl+Shift+I / Ctrl+Shift+L |
| Open browser | ⇧⌘L | Ctrl+Shift+Y |

## Agents and the browser

Claude sessions started by Tezgah get its tools automatically, through an MCP config passed to that session only (your Claude settings aren't changed; turn it off in Settings). Ask Claude to "open the app and check the sign-in form" and it can:

| Tool | What it does |
| --- | --- |
| `browser_open` | Open a URL in the session's browser pane and wait for it to load |
| `browser_snapshot` | The page as text, each link, button and field with a ref (`e12`) |
| `browser_click`, `browser_fill`, `browser_type`, `browser_press`, `browser_select`, `browser_hover`, `browser_scroll` | Act on the page with real mouse and keyboard input |
| `browser_screenshot` | See the page or one element as an image |
| `browser_wait` | Wait for text, a selector, a URL or the page to load |
| `browser_console`, `browser_network` | What the page logged, and the requests it made (failed ones too) |
| `browser_eval`, `browser_navigate` | Run JavaScript; back, forward, reload |
| `terminal_read`, `terminal_send`, `terminal_split` | Read or type into other panes, or start a dev server beside you |
| `tezgah_list`, `tezgah_notify` | Sessions and panes; notify you |

**Other agents** can use the same tools. Any agent that runs shell commands can use the `tezgah` command below with no setup. For agents that speak MCP, add `tezgah mcp` as a server, for example:

```toml
# Codex: ~/.codex/config.toml
[mcp_servers.tezgah]
command = "tezgah"
args = ["mcp"]
```

```json
// Gemini CLI: ~/.gemini/settings.json
{ "mcpServers": { "tezgah": { "command": "tezgah", "args": ["mcp"] } } }
```

The `tezgah` command exists only inside Tezgah's terminals, so these servers start when the agent runs in Tezgah.

## The `tezgah` command

Every terminal inside Tezgah has a `tezgah` command. It needs nothing installed; it runs on Tezgah's own runtime and talks to the app over a socket only your user can open.

```sh
tezgah browser open http://localhost:5173    # open your app beside the terminal
tezgah browser snapshot                      # the page as text, with refs
tezgah browser fill text=Email ada@example.com
tezgah browser click "text=Sign in"          # a ref (e12), a CSS selector, or text=…
tezgah browser wait --text "Welcome"
tezgah browser screenshot                    # prints the PNG's path
tezgah browser console --errors              # also: network --failed, eval <js>, press Enter
tezgah notify --title Build "tests passed"   # notification, ring and panel entry
tezgah status working "deploying"            # this pane's status in the sidebar
tezgah split down -- npm run dev             # a new pane beside this one, running a command
tezgah new --shell --dir ~/code/api -- make  # a new session
tezgah send --enter "run the tests again"    # type into this session's Claude
tezgah read --lines 50                       # what a pane shows
tezgah list                                  # sessions and panes
tezgah run "Dev server"                      # one of your custom commands
```

`tezgah help` lists everything.

## Build from source

Needs Node 22+ (and, on Linux, the usual build tools for native modules).

```sh
git clone https://github.com/itsyunusacar/tezgah.git
cd tezgah
npm install
npm run dev          # run with hot reload
npm test             # unit tests
npm run dist         # installers for your platform, in dist/
```

Electron, [xterm.js](https://xtermjs.org) and [node-pty](https://github.com/microsoft/node-pty), with React for the interface.

## Privacy

Tezgah has no telemetry and no account. It makes one kind of network request: to show your plan limits, it reads Claude Code's login (the macOS Keychain item `Claude Code-credentials`, or `~/.claude/.credentials.json` elsewhere) and calls `https://api.anthropic.com/api/oauth/usage`, the endpoint Claude Code's `/usage` uses. That endpoint is undocumented and may stop working.

For Codex limits it reads the last rate-limit report in Codex's own session logs (`~/.codex/sessions`); nothing is sent anywhere. Other agents (Gemini CLI, Cursor, OpenCode) don't keep their limits on your computer, so Tezgah can't show them.

It reads `~/.claude/projects` to resume conversations, list recent ones and follow subagents. Your projects and sessions, and the last screen of each shell pane, are saved in Tezgah's own settings folder. When the GitHub CLI is installed, Tezgah runs `gh pr view` in your projects to show their pull requests; that uses your own `gh` login.

Tezgah is independent and not affiliated with Anthropic. Claude and Claude Code are trademarks of Anthropic.

## License

[MIT](LICENSE)
