# Changelog

All notable changes to Tezgah are listed here. Versions follow [Semantic Versioning](https://semver.org).

## [Unreleased]

### Added

- Open folders with Tezgah: Finder's Open With on macOS, "Open in Tezgah" when you right-click a folder (or inside one) in Windows Explorer, and your file manager's Open With on Linux.
- Make Tezgah your default terminal (Settings): on macOS it opens shell scripts (.command, .sh) and ssh:// links; on Linux it becomes GNOME's terminal and takes `-e` / `-x` commands like other terminals.
- Settings → Opening a folder starts: Claude or a shell.
- A shell with no project opens in your home folder.

## [1.0.0] - 2026-10-28

The first release of the new Tezgah: a rewrite of the macOS-only app ([tezgah-legacy](https://github.com/itsyunusacar/tezgah-legacy)) on Electron, xterm.js and node-pty. Smaller, and it runs on macOS, Windows and Linux.

### Sessions and agents

- Projects and sessions in a sidebar; each Claude session resumes its conversation after a relaunch, and shell panes keep their screen.
- Live status from Claude Code's own reports (OSC 7501): working, needs you, done. Allow and Deny for permission prompts from the sidebar.
- Status for other agents too. Codex reports exactly through hooks Tezgah passes when you run `codex` in it (Codex asks you to trust them once; your Codex config isn't changed). Grok, Gemini, Aider, OpenCode, Amp and others are read from what they do: output while working, a question when they need you, quiet when done (macOS and Linux).
- Subagents listed under their session; click one to follow its transcript.
- Drag sessions and projects to reorder them, pin sessions to the top, and archive ones you're done with (their conversation resumes when you restore them; the quick switcher finds them too).
- Each pane is named after the agent working in it, Claude included.
- Split panes with a bar for each (status, split, close), layouts you can save and reopen, worktree sessions with merge, SSH sessions that upload dropped files.
- Each session shows its git branch, the ports its programs listen on and its pull request (with the GitHub CLI).

### Notifications

- Notifications when an agent finishes or needs you, an attention ring on the pane and session, a notification panel (⌘I) with a bell and unread count, and a jump to the newest unread (⇧⌘U).
- Any program can notify with OSC 9, 777 or 99, or `tezgah notify`.
- Tezgah in the menu bar (the tray on Windows and Linux): who's working, who needs you, and a jump to each.

### Browser and the `tezgah` command

- Browser panes beside the terminal, kept alive while you look at other sessions.
- Agents can use the browser: a text snapshot with element refs, real clicks and typing, screenshots, waiting, the console and network log.
- The `tezgah` command in every Tezgah terminal (notify, status, split, new, open, browser, send, read, list, run), and `tezgah mcp`, an MCP server with the same tools. Claude sessions started by Tezgah get it automatically.

### Everything else

- Each Claude session shows how full its context is and how many tokens it has used, read from its transcript.
- Changes panel with line notes you can send to Claude, and commit, push and open a pull request (with the GitHub CLI) from it.
- Plan limits for Claude (live) and Codex (from its logs), with reset times and pace.
- Find in terminal, drop or paste files and screenshots as paths, custom commands, a + menu, quick switcher, recent conversations.
- A short animated tour on first launch, skippable and replayable from Settings.
- A first-run checklist: Claude Code, signing in, git and the GitHub CLI, with how to get what's missing.
- A note in the sidebar when a newer Tezgah is out, with a link to download it (Settings can turn the check off).
- Change any keyboard shortcut in Settings → Keyboard Shortcuts (conflicts are caught; each goes back to its default).
- Turkish and English, following the system language or chosen in Settings.
- Light and dark themes, Geist type, optional font and colors from your Ghostty config.
