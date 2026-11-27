import { app as electronApp } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import { Readable, Writable } from 'stream'
import { join } from 'path'
import { randomUUID } from 'crypto'
import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type ClientConnection,
  type RequestPermissionRequest,
  type RequestPermissionResponse
} from '@agentclientprotocol/sdk'
import { promises as fs } from 'fs'
import type {
  AgentKind,
  AgentSnapshot,
  AgentStatus,
  Attachment,
  ConfigOption,
  PermissionAsk,
  SessionInfo
} from '@shared/ipc'
import { EMPTY_CHAT, reduceChat, type AgentEvent, type ChatState } from '@shared/chat'
import { readJson, writeJson } from '@shared/project'
import { getSettings, setSettings } from './settings'
import { LOGIN_COMMAND, otherVideoDbServers, signedIn, which } from './env'
import type { ContentBlock } from '@agentclientprotocol/sdk'

type Send = (channel: string, payload: unknown) => void

const ADAPTERS: Record<AgentKind, { pkg: string; label: string }> = {
  claude: { pkg: '@agentclientprotocol/claude-agent-acp/dist/index.js', label: 'Claude Code' },
  codex: { pkg: '@agentclientprotocol/codex-acp/dist/index.js', label: 'Codex' },
  pi: { pkg: 'pi-acp/dist/index.js', label: 'Pi' }
}

// ACP's authRequired error code.
const AUTH_REQUIRED = -32000
const isAuthError = (e: { code?: number; message?: string }): boolean =>
  e.code === AUTH_REQUIRED ||
  /auth(entication)? required|not (logged|signed) in/i.test(e.message ?? '')
const loginError = (kind: AgentKind): string =>
  kind === 'pi'
    ? 'Pi is not signed in. Run `pi` in a terminal and type /login, then retry.'
    : `${ADAPTERS[kind].label} CLI is not signed in on this computer. Run \`${LOGIN_COMMAND[kind]}\` in a terminal, complete the login, then retry. Signing into the ChatGPT or Claude web app alone is not enough. You can close the terminal after login succeeds.`

// Per project: which agent ran last and its session id per agent, so reopening resumes it.
type Saved = { last?: AgentKind; sessions?: Partial<Record<AgentKind, string>> }
const savedFile = (dir: string): string => join(dir, '.cutroom', 'session.json')
export const readSaved = (dir: string): Promise<Saved> => readJson<Saved>(savedFile(dir), {})

type Caps = { load: boolean; list: boolean; close: boolean; images: boolean; name: string }

// One ACP agent process per project. It outlives the project view while a turn is running.
// Adapters run under Electron's bundled Node.
export class AgentSession {
  private child?: ChildProcess
  private conn?: ClientConnection
  private sessionId?: string
  private pending = new Map<string, (r: RequestPermissionResponse) => void>()
  status: AgentStatus = { state: 'off' }
  private generation = 0
  private caps?: Caps
  private chat: ChatState = EMPTY_CHAT
  private seq = 0
  busy = false
  private apiKey = ''
  // Tool prefixes of the user's other VideoDB MCP servers, disallowed in Claude sessions.
  private blocked: string[] = []

  constructor(
    readonly dir: string,
    private send: Send,
    private onTurnEnd: (summary: string, stopReason: string) => void
  ) {}

  private setStatus(s: AgentStatus): void {
    this.status = s
    this.send('agent:status', s)
  }

  private emit(e: AgentEvent): void {
    this.chat = reduceChat(this.chat, e)
    this.send('agent:event', { ...e, seq: ++this.seq })
  }

  snapshot(): AgentSnapshot {
    return { status: this.status, chat: this.chat, seq: this.seq }
  }

  get alive(): boolean {
    return this.status.state === 'starting' || this.status.state === 'ready'
  }

  private mcpServers(apiKey: string) {
    return [
      {
        name: 'cutroom',
        command: process.execPath,
        args: [join(__dirname, 'mcp.js')],
        env: [
          { name: 'ELECTRON_RUN_AS_NODE', value: '1' },
          { name: 'VIDEO_DB_API_KEY', value: apiKey },
          { name: 'CUTROOM_PROJECT', value: this.dir }
        ]
      }
    ]
  }
  private async save(kind: AgentKind, sessionId: string): Promise<void> {
    const s = await readSaved(this.dir)
    await writeJson(savedFile(this.dir), {
      last: kind,
      sessions: { ...s.sessions, [kind]: sessionId }
    })
  }

  // Starts the agent and resumes this project's last session for it when the agent can load one.
  async start(kind: AgentKind, apiKey: string): Promise<void> {
    this.stop()
    const dir = this.dir
    this.apiKey = apiKey
    this.chat = EMPTY_CHAT
    this.emit({ kind: 'reset' })
    const gen = ++this.generation
    const stale = (): boolean => gen !== this.generation
    this.setStatus({ state: 'starting', kind })
    if ((await signedIn(kind)) === false) {
      if (stale()) return
      this.setStatus({ state: 'error', kind, error: loginError(kind), needsLogin: true })
      return
    }
    if (stale()) return
    this.blocked = kind === 'claude' ? await otherVideoDbServers(dir) : []
    if (stale()) return
    // Cutroom's key is the only VideoDB account here: set both names the SDK and the videodb CLI
    // read, and drop anything that would point them at a stored profile or another server.
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      VIDEO_DB_API_KEY: apiKey,
      VIDEODB_API_KEY: apiKey
    }
    for (const k of ['VIDEODB_PROFILE', 'VIDEODB_BASE_URL', 'VIDEO_DB_BASE_URL']) delete env[k]
    // Drive the user's own installed CLIs (same login, same version they use) instead of bundled copies.
    if (kind === 'claude') env.CLAUDE_CODE_EXECUTABLE ??= await which('claude')
    if (kind === 'codex') env.CODEX_PATH ??= await which('codex')
    if (stale()) return
    const child = spawn(process.execPath, [require.resolve(ADAPTERS[kind].pkg)], {
      cwd: dir,
      env,
      stdio: 'pipe'
    })
    this.child = child
    let stderr = ''
    child.stderr?.on('data', (d) => {
      stderr = (stderr + d.toString()).slice(-4000)
      console.error(`[${kind}]`, d.toString().trimEnd())
    })
    child.on('exit', (code) => {
      if (this.child !== child) return
      this.child = undefined
      this.setStatus({
        state: 'error',
        kind,
        error: `Agent exited (code ${code}). ${stderr.slice(-600)}`
      })
    })

    const app = client({ name: 'cutroom' })
      .onRequest(methods.client.session.requestPermission, ({ params }) =>
        this.askPermission(params)
      )
      .onNotification(methods.client.session.update, ({ params }) => {
        if (params.sessionId !== this.sessionId) return
        const u = params.update as { sessionUpdate: string; configOptions?: unknown[] }
        if (u.sessionUpdate === 'config_option_update' && this.status.state === 'ready')
          this.setStatus({ ...this.status, config: normalizeConfig(u.configOptions) })
        this.emit({ kind: 'update', update: params.update as Record<string, any> })
      })

    const stream = ndJsonStream(
      Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>
    )
    const conn = app.connect(stream)
    this.conn = conn
    try {
      const init = await conn.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: 'cutroom', version: electronApp.getVersion() }
      })
      if (stale()) return
      const ac = init.agentCapabilities
      this.caps = {
        load: !!ac?.loadSession,
        list: !!ac?.sessionCapabilities?.list,
        close: !!ac?.sessionCapabilities?.close,
        images: !!ac?.promptCapabilities?.image,
        name: init.agentInfo?.title ?? init.agentInfo?.name ?? ADAPTERS[kind].label
      }
      const resume = (await readSaved(dir)).sessions?.[kind]
      if (resume && this.caps.load) {
        try {
          await this.openSession(kind, resume)
        } catch (e) {
          console.error(`[${kind}] could not load session ${resume}:`, (e as Error).message)
          if (stale()) return
          await this.openSession(kind)
        }
      } else await this.openSession(kind)
      if (stale()) return
      await this.applySaved(kind)
    } catch (e) {
      if (stale()) return
      const err = e as { message?: string; code?: number }
      this.setStatus(
        isAuthError(err)
          ? { state: 'error', kind, error: loginError(kind), needsLogin: true }
          : { state: 'error', kind, error: err.message ?? String(e) }
      )
      this.stop(false)
    }
  }

  // session/new, or session/load (which replays the old transcript as session/update notifications).
  private async openSession(kind: AgentKind, loadId?: string): Promise<void> {
    if (!this.conn || !this.caps) throw new Error('Agent is not running')
    const conn = this.conn
    const caps = this.caps
    const generation = this.generation
    const prev = this.sessionId
    this.chat = EMPTY_CHAT
    this.emit({ kind: 'reset' })
    // Set before the request: the replay arrives before session/load returns.
    this.sessionId = loadId
    const params = {
      cwd: this.dir,
      mcpServers: this.mcpServers(this.apiKey),
      ...(this.blocked.length && {
        _meta: { claudeCode: { options: { disallowedTools: this.blocked } } }
      })
    }
    const session = loadId
      ? await conn.agent.request(methods.agent.session.load, { ...params, sessionId: loadId })
      : await conn.agent.request(methods.agent.session.new, params)
    if (generation !== this.generation || conn !== this.conn) return
    const sessionId = loadId ?? (session as { sessionId: string }).sessionId
    this.sessionId = sessionId
    if (prev && prev !== sessionId && this.caps.close)
      void this.conn.agent
        .request(methods.agent.session.close, { sessionId: prev })
        .catch(() => undefined)
    const s = session as { modes?: any; configOptions?: unknown[] }
    this.setStatus({
      state: 'ready',
      kind,
      name: caps.name,
      modes: s.modes?.availableModes ?? [],
      currentMode: s.modes?.currentModeId,
      images: caps.images,
      config: normalizeConfig(s.configOptions),
      sessionId,
      canList: caps.list,
      canLoad: caps.load
    })
    await this.save(kind, sessionId)
  }

  async newSession(): Promise<void> {
    if (this.status.state !== 'ready' || this.busy) return
    await this.openSession(this.status.kind)
    await this.applySaved(this.status.kind)
  }

  async loadSession(sessionId: string): Promise<void> {
    if (this.status.state !== 'ready' || this.busy || !this.caps?.load) return
    if (sessionId === this.sessionId) return
    const kind = this.status.kind
    try {
      await this.openSession(kind, sessionId)
    } catch (e) {
      this.emit({ kind: 'stop', error: `Could not open that session: ${(e as Error).message}` })
      await this.openSession(kind)
    }
  }

  async listSessions(): Promise<SessionInfo[]> {
    if (!this.conn || !this.caps?.list) return []
    const out: SessionInfo[] = []
    let cursor: string | undefined
    for (let page = 0; page < 5; page++) {
      const res = (await this.conn.agent.request(methods.agent.session.list, {
        cwd: this.dir,
        ...(cursor ? { cursor } : {})
      })) as { sessions?: SessionInfo[]; nextCursor?: string | null }
      for (const x of res.sessions ?? [])
        out.push({ sessionId: x.sessionId, title: x.title, updatedAt: x.updatedAt })
      cursor = res.nextCursor ?? undefined
      if (!cursor) break
    }
    return out
  }

  async prompt(text: string, attachments: Attachment[] = []): Promise<void> {
    if (!this.conn || !this.sessionId) throw new Error('Agent is not running')
    if (this.busy) throw new Error('The agent is still working on the last message')
    const conn = this.conn
    const sessionId = this.sessionId
    const generation = this.generation
    const kind = this.status.state === 'ready' ? this.status.kind : undefined
    this.busy = true
    this.emit({ kind: 'user', text, files: attachments })
    let stopReason = 'error'
    try {
      const res = await conn.agent.request(methods.agent.session.prompt, {
        sessionId,
        prompt: await this.blocks(text, attachments)
      })
      if (generation !== this.generation) return
      stopReason = res.stopReason
      this.emit({ kind: 'stop' })
    } catch (e) {
      if (generation !== this.generation) return
      const err = e as { message?: string; code?: number; data?: { message?: string } }
      if (isAuthError(err) && kind) {
        // Login expired mid-session: the chat shows the sign-in card; retry starts a fresh agent.
        this.emit({ kind: 'stop', error: loginError(kind) })
        this.stop(false)
        this.setStatus({ state: 'error', kind, error: loginError(kind), needsLogin: true })
      } else this.emit({ kind: 'stop', error: err.data?.message ?? err.message ?? String(e) })
    } finally {
      if (generation === this.generation) {
        this.busy = false
        this.onTurnEnd(text, stopReason)
      }
    }
  }

  // Every attachment is announced by path so the agent can decide; images also go inline when supported.
  private async blocks(text: string, attachments: Attachment[]): Promise<ContentBlock[]> {
    const out: ContentBlock[] = [
      {
        type: 'text',
        text: 'Cutroom session: use the VideoDB account connected in this app. Read AGENTS.md. Other VideoDB skills are documentation only; their credentials, login profiles and MCP connectors must not override this account. Use cutroom tools or the supplied environment credentials. Never display credentials. Understand the content and choose a coherent editing direction. For subtitles, use caption_presets from the DirectorFE catalog and adapt them to the content and frame. Inspect the rendered output, including visible captions during speech, and fix visual problems before presenting the edit as finished.'
      }
    ]
    const lines = attachments.map(
      (a) => `- ${a.path} (${a.mime || 'file'}, ${(a.size / 1e6).toFixed(1)} MB)`
    )
    out.push({
      type: 'text',
      text: lines.length ? `${text}\n\nAttached files:\n${lines.join('\n')}` : text
    })
    const images = this.status.state === 'ready' && this.status.images
    for (const a of attachments) {
      if (images && a.mime.startsWith('image/') && a.size < 8e6) {
        const data = (await fs.readFile(a.path)).toString('base64')
        out.push({ type: 'image', data, mimeType: a.mime })
      }
    }
    return out
  }

  cancel(): void {
    if (this.conn && this.sessionId)
      void this.conn.agent
        .notify(methods.agent.session.cancel, { sessionId: this.sessionId })
        .catch(() => undefined)
    for (const [requestId, resolve] of this.pending) {
      resolve({ outcome: { outcome: 'cancelled' } })
      this.emit({ kind: 'answer', requestId, answer: 'Cancelled' })
    }
    this.pending.clear()
  }

  // Re-apply the user's last model / thinking level / toggles for this agent, where still valid.
  private async applySaved(kind: AgentKind): Promise<void> {
    const saved = (await getSettings()).agentConfig?.[kind] ?? {}
    for (const [id, value] of Object.entries(saved)) {
      if (this.status.state !== 'ready') return
      const opt = this.status.config.find((o) => o.id === id)
      if (!opt || opt.currentValue === value) continue
      if (opt.type === 'select' && !opt.options.some((c) => c.value === value)) continue
      await this.setConfig(id, value, false).catch(() => undefined)
    }
  }

  async setConfig(configId: string, value: string | boolean, remember = true): Promise<void> {
    if (!this.conn || !this.sessionId || this.status.state !== 'ready') return
    const kind = this.status.kind
    const res = await this.conn.agent.request(
      methods.agent.session.setConfigOption,
      (typeof value === 'boolean'
        ? { sessionId: this.sessionId, configId, type: 'boolean', value }
        : { sessionId: this.sessionId, configId, value }) as never
    )
    if (this.status.state === 'ready') {
      const config = normalizeConfig((res as { configOptions?: unknown[] }).configOptions)
      const mode = config.find((o) => o.category === 'mode')
      this.setStatus({
        ...this.status,
        config: config.length ? config : this.status.config,
        currentMode:
          typeof mode?.currentValue === 'string' ? mode.currentValue : this.status.currentMode
      })
    }
    if (!remember) return
    const s = await getSettings()
    await setSettings({
      agentConfig: { ...s.agentConfig, [kind]: { ...s.agentConfig?.[kind], [configId]: value } }
    })
  }

  async setMode(modeId: string): Promise<void> {
    if (!this.conn || !this.sessionId || this.status.state !== 'ready') return
    await this.conn.agent.request(methods.agent.session.setMode, {
      sessionId: this.sessionId,
      modeId
    })
    this.setStatus({ ...this.status, currentMode: modeId })
  }

  private askPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const requestId = randomUUID()
    const ask: PermissionAsk = {
      requestId,
      title: params.toolCall.title ?? 'Tool call',
      kind: params.toolCall.kind,
      rawInput: params.toolCall.rawInput,
      options: params.options.map((o) => ({ optionId: o.optionId, name: o.name, kind: o.kind }))
    }
    this.emit({ kind: 'permission', ask })
    return new Promise((resolve) => this.pending.set(requestId, resolve))
  }

  answerPermission(requestId: string, optionId: string | null): void {
    const resolve = this.pending.get(requestId)
    if (!resolve) return
    this.pending.delete(requestId)
    const ask = this.chat.items.find(
      (x) => x.type === 'permission' && x.ask.requestId === requestId
    ) as { ask: PermissionAsk } | undefined
    this.emit({
      kind: 'answer',
      requestId,
      answer: optionId
        ? (ask?.ask.options.find((o) => o.optionId === optionId)?.name ?? optionId)
        : 'Denied'
    })
    resolve({ outcome: optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' } })
  }

  stop(report = true): void {
    this.generation++
    this.busy = false
    this.cancel()
    this.conn?.close()
    this.conn = undefined
    this.sessionId = undefined
    const child = this.child
    this.child = undefined
    child?.kill()
    if (report) this.setStatus({ state: 'off' })
  }
}

type RawChoice = {
  value?: string
  name?: string
  description?: string | null
  options?: RawChoice[]
}

function normalizeConfig(raw: unknown): ConfigOption[] {
  if (!Array.isArray(raw)) return []
  return raw.map((o) => {
    const opt = o as ConfigOption & { options?: RawChoice[] }
    // Select options may come grouped; flatten them.
    const options = (opt.options ?? []).flatMap((c: RawChoice) =>
      Array.isArray(c.options) ? c.options : [c]
    )
    return {
      id: opt.id,
      name: opt.name,
      description: opt.description,
      category: opt.category,
      type: opt.type === 'boolean' ? 'boolean' : 'select',
      currentValue: opt.currentValue,
      options: options
        .filter((c) => typeof c.value === 'string')
        .map((c) => ({ value: c.value!, name: c.name ?? c.value!, description: c.description }))
    }
  })
}
