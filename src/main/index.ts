import { app, shell, BrowserWindow, ipcMain, dialog, nativeTheme, Notification } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { Project } from './project'
import { AgentSession, readSaved } from './agent'
import { loginVideoDb, cancelVideoDbLogin } from './videodb-login'
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
import { detectAgents, loadShellPath, openLogin, signedIn } from './env'
import { importLut, validateKey } from '@shared/vdb'
import type { AgentKind, Attachment, ProjectMeta, Settings } from '@shared/ipc'
import type { Timeline } from '@shared/timeline'

let win: BrowserWindow | null = null
const TRASH = process.platform === 'win32' ? 'Recycle Bin' : 'Trash'

const send = (channel: string, payload: unknown): void => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

// Every project folder gets its own Project and AgentSession. Only the one on screen talks to the
// window; a project left while its agent is mid-turn keeps working and is released when it finishes.
let active: string | null = null
const projects = new Map<string, Project>()
const agents = new Map<string, AgentSession>()

const scoped =
  (dir: string) =>
  (channel: string, payload: unknown): void => {
    if (dir === active) send(channel, payload)
  }

const busyDirs = (): string[] => [...agents.values()].filter((a) => a.busy).map((a) => a.dir)
const announceBusy = (): void => send('agents:busy', busyDirs())

function agentFor(dir: string): AgentSession {
  let a = agents.get(dir)
  if (!a) {
    a = new AgentSession(dir, scoped(dir), (prompt, stopReason) => {
      void (async () => {
        await projects.get(dir)?.checkpoint(`Agent: ${prompt.replace(/\s+/g, ' ').slice(0, 72)}`)
        announceBusy()
        if (dir === active) return
        const name = (await projects.get(dir)?.state())?.name ?? dir
        send('agent:background-done', { dir, name, stopReason })
        if (Notification.isSupported() && !win?.isFocused())
          new Notification({ title: `Cutroom · ${name}`, body: 'The agent finished.' }).show()
        release(dir)
      })()
    })
    agents.set(dir, a)
  }
  return a
}

// Stop and forget a project that is neither on screen nor running a turn. Its session is saved, so
// opening it again reloads the conversation.
function release(dir: string, force = false): void {
  if (!force && (dir === active || agents.get(dir)?.busy)) return
  agents.get(dir)?.stop(false)
  agents.delete(dir)
  projects.get(dir)?.close()
  projects.delete(dir)
}

const need = (): Project => {
  const p = active && projects.get(active)
  if (!p) throw new Error('No project open')
  return p
}

async function openProject(dir: string) {
  const prev = active
  active = dir
  if (prev && prev !== dir) release(prev)
  let project = projects.get(dir)
  const fresh = !project
  if (!project) {
    project = new Project(dir, scoped(dir))
    projects.set(dir, project)
  }
  const state = fresh ? await project.open() : await project.state()
  await rememberExternal(dir)
  return { state, history: await project.history(), compile: project.lastCompile }
}

function closeProject(): void {
  const prev = active
  active = null
  if (prev) release(prev)
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
  const publicSettings = (s: Settings): Settings => ({ ...s, apiKey: '' })
  ipcMain.handle('settings:get', async () => publicSettings(await getSettings()))
  ipcMain.handle('settings:set', async (_e, patch: Partial<Settings>) => {
    if ('apiKey' in patch || 'videoDbAuth' in patch)
      throw new Error('Connect your VideoDB account using browser sign-in.')
    if (patch.onboarded && !(await getSettings()).apiKey)
      throw new Error('Sign in with VideoDB before completing setup.')
    return publicSettings(await setSettings(patch))
  })
  ipcMain.handle('settings:login', async () => {
    if (busyDirs().length)
      throw new Error('Wait for active edits to finish before changing VideoDB accounts.')
    const apiKey = await loginVideoDb()
    const check = await validateKey(apiKey)
    if (!check.ok) throw new Error(check.error)
    if (busyDirs().length)
      throw new Error('An edit started during sign-in. Finish it, then sign in again.')
    for (const agent of agents.values()) agent.stop()
    await setSettings({ apiKey, videoDbAuth: 'sso' })
    for (const project of projects.values()) project.resetConnection()
    return { connected: true }
  })
  ipcMain.handle('settings:cancel-login', () => cancelVideoDbLogin())
  ipcMain.handle('project:import-lut', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Import colour grade',
      filters: [{ name: '3D LUT', extensions: ['cube'] }],
      properties: ['openFile']
    })
    if (r.canceled || !r.filePaths[0]) return null
    return importLut((await getSettings()).apiKey, r.filePaths[0])
  })
  ipcMain.handle('agents:detect', () => detectAgents())
  ipcMain.handle('agents:signed-in', (_e, kind: AgentKind) => signedIn(kind))
  ipcMain.handle('agents:login', (_e, kind: AgentKind) => openLogin(kind))
  ipcMain.handle('theme:set', (_e, theme: 'light' | 'dark' | 'system') => {
    nativeTheme.themeSource = theme
    paintTitleBar()
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
      buttons: [owned ? `Move to ${TRASH}` : 'Remove from list', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: owned ? `Move “${name}” to the ${TRASH}?` : `Remove “${name}” from Cutroom?`,
      detail: owned
        ? `The project folder goes to the ${TRASH}; you can restore it from there. Media stays in your VideoDB account.`
        : 'The folder itself is not touched.'
    })
    if (r.response !== 0) return false
    if (active === dir) active = null
    release(dir, true)
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
  ipcMain.handle('project:close', () => closeProject())
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

  const agent = (): AgentSession => agentFor(need().dir)
  // The chat panel calls this on mount: reuse a running agent, otherwise start one that resumes
  // this project's last session.
  ipcMain.handle('agent:attach', async () => {
    const a = agent()
    if (!a.alive) {
      const [{ apiKey, agent: preferred }, saved] = await Promise.all([
        getSettings(),
        readSaved(a.dir)
      ])
      void a.start(saved.last ?? preferred, apiKey)
    }
    return a.snapshot()
  })
  ipcMain.handle('agent:start', async (_e, kind: AgentKind) => {
    const { apiKey } = await getSettings()
    await setSettings({ agent: kind })
    await agent().start(kind, apiKey)
  })
  ipcMain.handle('agent:new-session', () => agent().newSession())
  ipcMain.handle('agent:list-sessions', () => agent().listSessions())
  ipcMain.handle('agent:load-session', (_e, id: string) => agent().loadSession(id))
  ipcMain.handle('agent:prompt', async (_e, text: string, attachments: Attachment[]) => {
    const a = agent()
    const run = a.prompt(text, attachments)
    announceBusy()
    await run
  })
  ipcMain.handle('agent:cancel', () => agent().cancel())
  ipcMain.handle('agent:set-mode', (_e, id: string) => agent().setMode(id))
  ipcMain.handle('agent:set-config', (_e, id: string, value: string | boolean) =>
    agent().setConfig(id, value)
  )
  ipcMain.handle('agent:permission-reply', (_e, requestId: string, optionId: string | null) =>
    agent().answerPermission(requestId, optionId)
  )
  ipcMain.handle('agents:busy', () => busyDirs())
  ipcMain.handle('shell:open', (_e, url: string) => shell.openExternal(url))
  ipcMain.handle('shell:reveal', (_e, path: string) => shell.showItemInFolder(path))
}

const WIN = process.platform === 'win32'
const TITLE_BAR_H = 44
const chrome = (): { color: string; symbolColor: string; height: number } =>
  nativeTheme.shouldUseDarkColors
    ? { color: '#0a0a0a', symbolColor: '#e5e5e5', height: TITLE_BAR_H }
    : { color: '#ffffff', symbolColor: '#171717', height: TITLE_BAR_H }

// Windows draws its own caption buttons over the top bar; keep them in the page's colours.
function paintTitleBar(): void {
  if (WIN && win && !win.isDestroyed()) win.setTitleBarOverlay(chrome())
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#ffffff',
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 14 } }
      : WIN
        ? { titleBarStyle: 'hidden' as const, titleBarOverlay: chrome() }
        : {}),
    autoHideMenuBar: true,
    ...(process.platform !== 'darwin' ? { icon } : {}),
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
  // Must match electron-builder's appId, or Windows drops notifications from the installed app.
  electronApp.setAppUserModelId('app.cutroom.desktop')
  nativeTheme.on('updated', paintTitleBar)
  app.on('browser-window-created', (_, w) => optimizer.watchWindowShortcuts(w))
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', (e) => {
  const busy = busyDirs()
  if (busy.length && win && !win.isDestroyed()) {
    const r = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Quit anyway', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: `The agent is still working in ${busy.length === 1 ? 'a project' : `${busy.length} projects`}.`,
      detail:
        'Quitting stops the current turn. The conversation so far is saved and comes back when you reopen the project.'
    })
    if (r === 1) return e.preventDefault()
  }
  for (const dir of [...agents.keys(), ...projects.keys()]) release(dir, true)
})

app.on('window-all-closed', () => {
  cancelVideoDbLogin()
  if (process.platform !== 'darwin') app.quit()
})
