import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Api } from '../shared/types'

function listen<A extends unknown[]>(channel: string, cb: (...args: A) => void): () => void {
  const handler = (_e: unknown, ...args: unknown[]) => cb(...(args as A))
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: Api = {
  platform: process.platform,
  load: () => ipcRenderer.invoke('load'),
  saveWorkspace: (ws) => ipcRenderer.send('save-workspace', ws),
  saveSettings: (s) => ipcRenderer.send('save-settings', s),

  ptyStart: (opts) => ipcRenderer.invoke('pty-start', opts),
  // Synchronous so it completes while the window is closing.
  saveScrollback: (id, data) => void ipcRenderer.sendSync('save-scrollback', id, data),
  loadScrollback: (id) => ipcRenderer.invoke('load-scrollback', id),
  dropScrollback: (id) => ipcRenderer.send('drop-scrollback', id),
  ptyWrite: (id, data) => ipcRenderer.send('pty-write', id, data),
  ptyResize: (id, cols, rows) => ipcRenderer.send('pty-resize', id, cols, rows),
  ptyKill: (id) => ipcRenderer.send('pty-kill', id),
  onPtyData: (cb) => listen('pty:data', cb),
  onPtyExit: (cb) => listen('pty:exit', cb),
  onPtyAgent: (cb) => listen('pty:agent', cb),

  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  claudeHasConversation: (id) => ipcRenderer.invoke('claude-has', id),
  subagents: (id) => ipcRenderer.invoke('subagents', id),
  conversationStats: (claudeId) => ipcRenderer.invoke('conversation-stats', claudeId),
  agentTranscript: (claudeId, agentId) => ipcRenderer.invoke('agent-transcript', claudeId, agentId),
  recentConversations: () => ipcRenderer.invoke('recent'),
  usage: () => ipcRenderer.invoke('usage'),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  mcpConfig: (paneId) => ipcRenderer.invoke('mcp-config', paneId),
  browserAct: (id, action, args) => ipcRenderer.invoke('browser-act', id, action, args),
  ghosttyLook: () => ipcRenderer.invoke('ghostty-look'),

  sessionMeta: (cwd, paneIds) => ipcRenderer.invoke('session-meta', cwd, paneIds),
  diff: (cwd, base) => ipcRenderer.invoke('diff', cwd, base),
  isGitRepo: (cwd) => ipcRenderer.invoke('is-repo', cwd),
  worktreeAdd: (repo, branch) => ipcRenderer.invoke('wt-add', repo, branch),
  worktreeRemove: (repo, wt, del) => ipcRenderer.invoke('wt-remove', repo, wt, del),
  worktreeMerge: (repo, wt) => ipcRenderer.invoke('wt-merge', repo, wt),

  updateTray: (state) => ipcRenderer.send('tray', state),
  setBadge: (n) => ipcRenderer.send('badge', n),
  notify: (title, body, sessionId) => ipcRenderer.send('notify', title, body, sessionId),
  onNotificationClick: (cb) => listen('notification-click', cb),
  onMenu: (cb) => listen('menu', cb),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  clipboardPaste: () => ipcRenderer.invoke('clipboard-paste'),
  nativePaste: () => ipcRenderer.send('native-paste'),
  scpUpload: (target, files) => ipcRenderer.invoke('scp-upload', target, files),
  pathForFile: (file) => webUtils.getPathForFile(file),
  revealPath: (p) => ipcRenderer.send('reveal', p),
  onOpenFolder: (cb) => listen('open-folder', cb),
  onControl: (cb) => listen('control', cb),
  controlReply: (id, res) => ipcRenderer.send('control-reply', id, res),
}

contextBridge.exposeInMainWorld('tz', api)
