# Changelog

All notable changes to Tezgah are listed here. Versions follow [Semantic Versioning](https://semver.org).

## [Unreleased]

### Added

- Drop files on a terminal to type their paths, escaped for the shell. Pasting files copied in Finder, Explorer or a file manager does the same, and a pasted image is saved to a temporary PNG and its path typed, so you can hand screenshots to Claude.

### Fixed

- In `npm run dev` on macOS, the Desktop, Documents and Downloads folders were silently unreadable because the development Electron app had no folder usage descriptions. A postinstall script now adds them.

- On the light theme, white and pale text from programs that assume a dark background (Claude Code among them) was invisible. Tezgah now raises such text to a readable contrast, maps the palette's whites to grays, and tells programs the background is light (`COLORFGBG`).

## [1.0.0-alpha.1] - 2026-10-28

A rewrite of Tezgah on Electron, xterm.js and node-pty: smaller, and it runs on macOS, Windows and Linux.

- Projects and sessions in a sidebar; each Claude session resumes its conversation after a relaunch.
- Live status from Claude Code's own reports (OSC 7501): working, needs you, done. Badge count and notifications.
- Allow and Deny for permission prompts, from the sidebar or with a shortcut.
- Subagents listed under their session with what each is doing.
- Split panes, a Changes panel with notes you can send to Claude, worktree sessions with merge.
- Claude plan usage limits, recent conversations, quick switcher, light and dark themes.
