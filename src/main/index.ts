import { app, shell, BrowserWindow, ipcMain, dialog, nativeTheme } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { Project } from './project'
import { AgentSession } from './agent'
import { getSettings, setSettings } from './settings'
import {
  createProject,
  listProjects,
  migrateRecent,
  rememberExternal,
  removeProject,
  updateMeta
} from './projects'
import { installSkills, skillStatus } from './skills'
import { promises as fsp } from 'fs'
import { basename, extname } from 'path'
import { detectAgents, loadShellPath } from './env'
import { validateKey } from '@shared/vdb'
import type { AgentKind, Attachment, ProjectMeta, Settings } from '@shared/ipc'
import type { Timeline } from '@shared/timeline'

let win: BrowserWindow | null = null
let project: Project | null = null

const send = (channel: string, payload: unknown): void => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

const agent = new AgentSession(send, (prompt) => {
  void project?.checkpoint(`Agent: ${prompt.replace(/\s+/g, ' ').slice(0, 72)}`)
})

const need = (): Project => {
  if (!project) throw new Error('No project open')
  return project
}

async function openProject(dir: string) {
  agent.stop()
  project?.close()
  project = new Project(dir, send)
  const state = await project.open()
  await rememberExternal(dir)
  return { state, history: await project.history() }
}

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.srt': 'text/plain',
  '.json': 'application/json'
}

async function describeFiles(paths: string[]): Promise<Attachment[]> {
  const out: Attachment[] = []
  for (const path of paths) {
    const st = await fsp.stat(path).catch(() => null)
    if (st?.isFile())
      out.push({
        path,
        name: basename(path),
        size: st.size,
        mime: MIME[extname(path).toLowerCase()] ?? ''
      })
  }
  return out
}

function registerIpc(): void {
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => setSettings(patch))
  ipcMain.handle('settings:validate-key', (_e, key: string) => validateKey(key.trim()))
  ipcMain.handle('agents:detect', () => detectAgents())
  ipcMain.handle('theme:set', (_e, theme: 'light' | 'dark' | 'system') => {
    nativeTheme.themeSource = theme
  })

  ipcMain.handle('project:pick', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Open a folder as a project',
      properties: ['openDirectory', 'createDirectory']
    })
    return r.canceled || !r.filePaths[0] ? null : openProject(r.filePaths[0])
  })
  ipcMain.handle('project:open', (_e, dir: string) => openProject(dir))
  ipcMain.handle('projects:list', () => listProjects())
  ipcMain.handle('projects:create', async (_e, name?: string) =>
    openProject(await createProject(name))
  )
  ipcMain.handle(
    'projects:update',
    (_e, dir: string, patch: Partial<Pick<ProjectMeta, 'name' | 'description'>>) =>
      updateMeta(dir, patch)
  )
  ipcMain.handle('projects:remove', async (_e, dir: string, name: string, owned: boolean) => {
    const r = await dialog.showMessageBox(win!, {
      type: 'warning',
      buttons: [owned ? 'Move to Trash' : 'Remove from list', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: owned ? `Move “${name}” to the Trash?` : `Remove “${name}” from Cutroom?`,
      detail: owned
        ? 'The project folder goes to the Trash; you can restore it from there. Media stays in your VideoDB account.'
        : 'The folder itself is not touched.'
    })
    if (r.response !== 0) return false
    if (project?.dir === dir) {
      agent.stop()
      project.close()
      project = null
    }
    await removeProject(dir)
    return true
  })
  ipcMain.handle(
    'project:rename',
    (_e, patch: Partial<Pick<ProjectMeta, 'name' | 'description'>>) => need().rename(patch)
  )
  ipcMain.handle('attach:pick', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Attach files',
      properties: ['openFile', 'multiSelections']
    })
    return r.canceled ? [] : describeFiles(r.filePaths)
  })
  ipcMain.handle('attach:paths', (_e, paths: string[]) => describeFiles(paths))
  ipcMain.handle('attach:save', (_e, name: string, bytes: Uint8Array, mime: string) =>
    need().saveAttachment(name, bytes, mime)
  )
  ipcMain.handle('skills:status', () => skillStatus())
  ipcMain.handle('skills:install', (_e, agents: AgentKind[]) => installSkills(agents))
  ipcMain.handle('project:close', () => {
    agent.stop()
    project?.close()
    project = null
  })
  ipcMain.handle('project:compile', () => need().compile())
  ipcMain.handle('project:write-timeline', (_e, t: Timeline) => need().writeTimeline(t))
  ipcMain.handle('project:history', () => need().history())
  ipcMain.handle('project:restore', (_e, hash: string) => need().restore(hash))
  ipcMain.handle('project:undo', () => need().undo())
  ipcMain.handle('project:export', () => need().export())
  ipcMain.handle('project:reveal', () => shell.openPath(need().dir))
  ipcMain.handle('project:import-files', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Import media',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Media',
          extensions: [
            'mp4',
            'mov',
            'm4v',
            'webm',
            'mkv',
            'mp3',
            'wav',
            'm4a',
            'aac',
            'png',
            'jpg',
            'jpeg',
            'webp'
          ]
        }
      ]
    })
    if (!r.canceled) void need().importMedia(r.filePaths.map((filePath) => ({ filePath })))
    return r.filePaths.length
  })
  ipcMain.handle('project:import-paths', (_e, filePaths: string[]) =>
    need().importMedia(filePaths.map((filePath) => ({ filePath })))
  )
  ipcMain.handle('project:import-url', (_e, url: string) => need().importMedia([{ url }]))

  ipcMain.handle('agent:start', async (_e, kind: AgentKind) => {
    const { apiKey } = await getSettings()
    await setSettings({ agent: kind })
    await agent.start(kind, need().dir, apiKey)
  })
  ipcMain.handle('agent:status', () => agent.status)
  ipcMain.handle('agent:prompt', (_e, text: string, attachments: Attachment[]) =>
    agent.prompt(text, attachments)
  )
  ipcMain.handle('agent:cancel', () => agent.cancel())
  ipcMain.handle('agent:set-mode', (_e, id: string) => agent.setMode(id))
  ipcMain.handle('agent:permission-reply', (_e, requestId: string, optionId: string | null) =>
    agent.answerPermission(requestId, optionId)
  )
  ipcMain.handle('shell:open', (_e, url: string) => shell.openExternal(url))
  ipcMain.handle('shell:reveal', (_e, path: string) => shell.showItemInFolder(path))
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#ffffff',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  })
  win.on('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL'])
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(async () => {
  await loadShellPath()
  const s0 = await getSettings()
  if (s0.recent.length) {
    await migrateRecent(s0.recent)
    await setSettings({ recent: [] })
  }
  electronApp.setAppUserModelId('io.videodb.cutroom')
  app.on('browser-window-created', (_, w) => optimizer.watchWindowShortcuts(w))
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  agent.stop(false)
  project?.close()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
