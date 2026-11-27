import { existsSync, promises as fs } from 'fs'
import { basename, join } from 'path'
import { app } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import chokidar, { FSWatcher } from 'chokidar'
import { paths, readAssets, readTimeline, scaffoldProject, writeJson } from '@shared/project'
import {
  compileProject,
  importMedia,
  understandVideo,
  exportProject,
  loadSprite,
  Source
} from '@shared/vdb'
import type { Attachment, Checkpoint, CompileState, ProjectMeta, ProjectState } from '@shared/ipc'
import { inboxDir, ImportRequest, ImportResult } from '@shared/inbox'
import { readJson } from '@shared/project'
import { ensureMeta, readMeta, touchMeta, updateMeta } from './projects'
import type { Timeline } from '@shared/timeline'
import { getSettings } from './settings'

const exec = promisify(execFile)
type Send = (channel: string, payload: unknown) => void

export class Project {
  private watcher?: FSWatcher
  private inbox?: FSWatcher
  private compileTimer?: NodeJS.Timeout
  private manualTimer?: NodeJS.Timeout
  private compileSeq = 0
  private understanding = new Set<string>()
  lastCompile: CompileState = { state: 'idle' }

  constructor(
    readonly dir: string,
    private send: Send
  ) {}

  // History is git; without git installed the project still works, just without checkpoints.
  private noGit = false
  private git = (...args: string[]): Promise<{ stdout: string }> =>
    exec('git', ['-c', 'user.name=Cutroom', '-c', 'user.email=cutroom@local', ...args], {
      cwd: this.dir,
      windowsHide: true
    }).catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') this.noGit = true
      throw e
    })

  async open(): Promise<ProjectState> {
    await scaffoldProject(this.dir)
    if (!existsSync(join(this.dir, '.git'))) {
      try {
        await this.git('init', '-q')
        await this.checkpoint('New project')
      } catch (e) {
        console.error('git unavailable, history disabled:', (e as Error).message)
      }
    }
    this.watcher = chokidar.watch([paths(this.dir).timeline, paths(this.dir).assets], {
      ignoreInitial: true
    })
    this.watcher.on('all', (_e, file) => void this.onChange(file))
    await fs.mkdir(inboxDir(this.dir), { recursive: true })
    this.inbox = chokidar.watch(inboxDir(this.dir), { ignoreInitial: false, depth: 0 })
    this.inbox.on('add', (file) => void this.onInbox(file))
    await ensureMeta(this.dir)
    await this.writeCli()
    void this.resumeIndexing()
    this.scheduleCompile(0)
    return this.state()
  }

  async state(): Promise<ProjectState> {
    return {
      dir: this.dir,
      name: (await readMeta(this.dir)).name || basename(this.dir),
      meta: await readMeta(this.dir),
      timeline: await readTimeline(this.dir),
      assets: await readAssets(this.dir)
    }
  }

  close(): void {
    void this.watcher?.close()
    void this.inbox?.close()
    clearTimeout(this.compileTimer)
    clearTimeout(this.manualTimer)
  }

  private async onChange(file: string): Promise<void> {
    if (basename(file) === 'timeline.json') {
      this.send('project:timeline', await readTimeline(this.dir))
      this.scheduleCompile(600)
    } else {
      this.send('project:assets', await readAssets(this.dir))
    }
  }

  private async onInbox(file: string): Promise<void> {
    if (!file.endsWith('.json') || file.endsWith('.done.json') || file.includes('.tmp')) return
    const req = await readJson<ImportRequest | null>(file, null)
    if (!req?.id) return
    await fs.rm(file, { force: true })
    let result: ImportResult
    try {
      const { apiKey } = await getSettings()
      if (!apiKey) throw new Error('Sign in with VideoDB in Settings first.')
      const m = await importMedia(this.dir, apiKey, req.source)
      result = {
        id: req.id,
        ok: true,
        media: { id: m.id, name: m.name, kind: m.kind, duration: m.duration, status: m.status }
      }
    } catch (e) {
      result = { id: req.id, ok: false, error: (e as Error).message ?? String(e) }
    }
    await writeJson(join(inboxDir(this.dir), `${req.id}.done.json`), result)
  }

  async rename(patch: Partial<Pick<ProjectMeta, 'name' | 'description'>>): Promise<ProjectMeta> {
    return updateMeta(this.dir, patch)
  }

  // Pasted image data has no path; keep it in the project so the agent can open it.
  async saveAttachment(name: string, bytes: Uint8Array, mime: string): Promise<Attachment> {
    const dir = join(this.dir, 'attachments')
    await fs.mkdir(dir, { recursive: true })
    const safe = name.replace(/[^\w.-]+/g, '_') || 'pasted'
    const path = join(dir, `${Date.now().toString(36)}-${safe}`)
    await fs.writeFile(path, bytes)
    return { path, name, size: bytes.byteLength, mime }
  }

  // .cutroom/bin/vdb: the VideoDB tools as a shell command, for agents without MCP (Pi).
  // Windows gets vdb.cmd too; the sh script still works under Git Bash, where `pwd -W` gives a
  // Windows path that the bundled Node understands.
  private async writeCli(): Promise<void> {
    const bin = join(this.dir, '.cutroom', 'bin')
    await fs.mkdir(bin, { recursive: true })
    const settings = join(app.getPath('userData'), 'settings.json')
    const cli = join(__dirname, 'cli.js')
    const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`
    const script = [
      '#!/bin/sh',
      'CUTROOM_PROJECT="$(cd "$(dirname "$0")/../.." && (pwd -W 2>/dev/null || pwd))" \\',
      `CUTROOM_SETTINGS=${q(settings)} \\`,
      `ELECTRON_RUN_AS_NODE=1 exec ${q(process.execPath)} ${q(cli)} "$@"`,
      ''
    ].join('\n')
    await fs.writeFile(join(bin, 'vdb'), script, { mode: 0o755 })
    if (process.platform !== 'win32') return
    const cmd = [
      '@echo off',
      'setlocal',
      'for %%I in ("%~dp0..\\..") do set "CUTROOM_PROJECT=%%~fI"',
      `set "CUTROOM_SETTINGS=${settings}"`,
      'set "ELECTRON_RUN_AS_NODE=1"',
      `"${process.execPath}" "${cli}" %*`,
      ''
    ].join('\r\n')
    await fs.writeFile(join(bin, 'vdb.cmd'), cmd)
  }

  // Media left mid-indexing by a previous run gets picked up again; sprites back-filled.
  private async resumeIndexing(): Promise<void> {
    const { apiKey } = await getSettings()
    if (!apiKey) return
    for (const m of (await readAssets(this.dir)).media) {
      if (m.kind === 'video' && !m.sprite && !m.id.startsWith('pending-'))
        void loadSprite(this.dir, apiKey, m.id)
      if (m.status === 'indexing' && !this.understanding.has(m.id)) {
        this.understanding.add(m.id)
        void understandVideo(this.dir, apiKey, m.id).finally(() => this.understanding.delete(m.id))
      }
    }
  }

  resetConnection(): void {
    this.compileSeq++
    this.lastCompile = { state: 'idle', clear: true }
    this.send('project:compile', this.lastCompile)
    this.scheduleCompile(0)
  }

  scheduleCompile(delay: number): void {
    clearTimeout(this.compileTimer)
    this.compileTimer = setTimeout(() => void this.compile(), delay)
  }

  async compile(): Promise<CompileState> {
    const seq = ++this.compileSeq
    const { apiKey } = await getSettings()
    let state: CompileState
    if (!apiKey)
      state = { state: 'error', error: 'Sign in with VideoDB in Settings to render previews.' }
    else {
      this.lastCompile = { state: 'compiling' }
      this.send('project:compile', this.lastCompile)
      const r = await compileProject(this.dir, apiKey)
      if (r.ok && r.stream_url)
        state = { state: 'ok', stream_url: r.stream_url, player_url: r.player_url }
      else if (r.issues.length) state = { state: 'invalid', issues: r.issues }
      else if (r.error === 'timeline is empty') state = { state: 'idle' }
      else state = { state: 'error', error: r.error ?? 'compile failed' }
    }
    if (seq === this.compileSeq) {
      this.lastCompile = state
      this.send('project:compile', state)
    }
    return state
  }

  async importMedia(sources: Source[]): Promise<void> {
    const { apiKey } = await getSettings()
    if (!apiKey) throw new Error('Sign in with VideoDB in Settings first.')
    await Promise.allSettled(sources.map((s) => importMedia(this.dir, apiKey, s)))
  }

  async writeTimeline(t: Timeline): Promise<void> {
    await writeJson(paths(this.dir).timeline, t)
    clearTimeout(this.manualTimer)
    this.manualTimer = setTimeout(() => void this.checkpoint('Manual edit'), 2000)
  }

  async checkpoint(message: string): Promise<boolean> {
    if (this.noGit) return false
    try {
      const { stdout } = await this.git('status', '--porcelain')
      if (!stdout.trim()) return false
      await touchMeta(this.dir)
      await this.git('add', '-A')
      await this.git('commit', '-q', '-m', message)
    } catch (e) {
      console.error('checkpoint failed:', (e as Error).message)
      return false
    }
    this.send('project:history', await this.history())
    return true
  }

  async history(): Promise<Checkpoint[]> {
    try {
      const { stdout } = await this.git(
        'log',
        '-40',
        '--format=%h%x1f%s%x1f%cI',
        '--',
        'timeline.json'
      )
      return stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          const [hash, message, date] = l.split('\x1f')
          return { hash, message, date }
        })
    } catch {
      return []
    }
  }

  // Non-destructive: brings back an old timeline.json as a new checkpoint.
  async restore(hash: string): Promise<void> {
    if (this.noGit)
      throw new Error('Version history needs git. Install Git, then reopen the project.')
    const { stdout } = await this.git('show', `${hash}:timeline.json`)
    await fs.writeFile(paths(this.dir).timeline, stdout)
    await this.checkpoint(`Restore ${hash}`)
  }

  async undo(): Promise<void> {
    await this.checkpoint('Edit')
    const h = await this.history()
    if (h.length > 1) await this.restore(h[1].hash)
  }

  async export(): Promise<Record<string, unknown>> {
    const { apiKey } = await getSettings()
    return exportProject(this.dir, apiKey)
  }
}
