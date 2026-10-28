# Changelog

All notable changes to Tezgah are listed here. Versions follow [Semantic Versioning](https://semver.org).

## [Unreleased]

### Added

- A + menu at the top of the sidebar: new Claude, shell, worktree and SSH sessions, new terminal and browser panes, saved layouts and your commands.
- Layouts: save a session's panes and splits by name and open them as a new session.
- A notification bell with the unread count.
- Tezgah in the menu bar (the tray on Windows and Linux): how many agents are working or need you, each session to jump to, and quick actions.
- Panes in a split get a bar with what runs there, its status, and split and close buttons; right-click a pane for more. Sessions close from a button on their sidebar row.

- Exact Codex status: in Tezgah's terminals `codex` runs with hooks (passed for that run only; your Codex config isn't changed, and Codex asks you to trust them first) that report working, the tool in use, permission requests with Allow and Deny, and done.
- Status for agents other than Claude Code (Grok, Gemini, Codex, Aider, OpenCode, Amp…): Tezgah notices the agent running in a terminal, names the session after it, and shows Working, Needs you (a question at the bottom of the screen) and Done from what it does, with notifications. macOS and Linux.
- Plan limits per agent: Claude (live) and Codex (from its last run's logs), each with its plan, reset times and a tick for how far into the window you are. Choose which agents' limits to show in Settings or by right-clicking them. Codex's are hidden once it's signed out and unused for a week.
- Sidebar rows show the session's git branch, the ports its programs listen on (click to open) and the branch's pull request (with the GitHub CLI).
- Attention rings on panes and sessions that finished or notified while you looked away; a notification panel (⌘I) and a jump to the newest unread (⇧⌘U).
- Notifications from any program through OSC 9, 777 and 99, so agents other than Claude Code can call you too.
- Find in terminal (⌘F / Ctrl+Shift+F).
- Browser panes beside the terminal, opened from a port, the header, ⇧⌘L / Ctrl+Shift+Y or `tezgah open`. They stay alive while you look at other sessions.
- Agents can use the browser: a text snapshot with element refs, real clicks and typing, form filling, key presses, screenshots, waiting, and the page's console and network log (`tezgah browser …`).
- `tezgah mcp`, an MCP server with the browser and pane tools. Claude sessions started by Tezgah get it automatically (Settings → Browser and pane tools); other agents can add it.
- The `tezgah` command in every Tezgah terminal: notify, status, split, new, open, browser, send, read, list, run, focus.
- Custom commands (Settings → Commands), run in a new pane from the quick switcher or `tezgah run`.
- SSH sessions; files dropped on them are uploaded with scp.
- Click a subagent to follow its transcript.
- Shell panes keep their screen across relaunches.
- Optional terminal font and colors from your Ghostty config.
- Drop files on a terminal to type their paths, escaped for the shell. Pasting files copied in Finder, Explorer or a file manager does the same, and a pasted image is saved to a temporary PNG and its path typed, so you can hand screenshots to Claude.

### Changed

- Searches typed in a browser pane's address bar go to Google.

### Fixed

- Terminals could draw garbled letters after moving between sessions or splits, or go blank after the GPU context was lost; they now redraw cleanly and fall back to the DOM renderer.
- With many panes side by side, the close button disappeared. It now always stays (labels and split buttons give way first), splitting shares a row equally instead of halving one pane, a split that would leave panes too narrow is refused with a hint, and Even Out Panes (pane menu, or double-click a divider) fixes squeezed layouts.
- Sessions of the same kind in a project are numbered (Shell, Shell 2…) instead of all looking alike.

- In `npm run dev` on macOS, the Desktop, Documents and Downloads folders were silently unreadable because the development Electron app had no folder usage descriptions. A postinstall script now adds them.
- Light theme: secondary and hint text (paths, shortcut hints, diff line numbers, agent tools) was too pale; it now has readable contrast.
- On macOS, opening Tezgah again after closing its window did nothing; it now opens a new window.
- Started from the Dock or Finder, Tezgah now finds git and gh installed with Homebrew.
- On the light theme, white and pale text from programs that assume a dark background (Claude Code among them) was invisible. Tezgah now raises such text to a readable contrast, maps the palette's whites to grays, and tells programs the background is light (`COLORFGBG`).

## [1.0.0-alpha.1] - 2026-10-28

A rewrite of Tezgah on Electron, xterm.js and node-pty: smaller, and it runs on macOS, Windows and Linux.

- Projects and sessions in a sidebar; each Claude session resumes its conversation after a relaunch.
- Live status from Claude Code's own reports (OSC 7501): working, needs you, done. Badge count and notifications.
- Allow and Deny for permission prompts, from the sidebar or with a shortcut.
- Subagents listed under their session with what each is doing.
- Split panes, a Changes panel with notes you can send to Claude, worktree sessions with merge.
- Claude plan usage limits, recent conversations, quick switcher, light and dark themes.
