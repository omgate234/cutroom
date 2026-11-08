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
import type { AgentKind, AgentStatus, Attachment, PermissionAsk } from '@shared/ipc'
import { which } from './env'
import type { ContentBlock } from '@agentclientprotocol/sdk'

type Send = (channel: string, payload: unknown) => void

const ADAPTERS: Record<AgentKind, { pkg: string; label: string; login: string }> = {
  claude: {
    pkg: '@agentclientprotocol/claude-agent-acp/dist/index.js',
    label: 'Claude Code',
    login: 'claude'
  },
  codex: {
    pkg: '@agentclientprotocol/codex-acp/dist/index.js',
    label: 'Codex',
    login: 'codex login'
  },
  pi: { pkg: 'pi-acp/dist/index.js', label: 'Pi', login: 'pi' }
}

// One ACP agent process per open project. Adapters run under Electron's bundled Node.
export class AgentSession {
  private child?: ChildProcess
  private conn?: ClientConnection
  private sessionId?: string
  private pending = new Map<string, (r: RequestPermissionResponse) => void>()
  status: AgentStatus = { state: 'off' }
  private generation = 0

  constructor(
    private send: Send,
    private onTurnEnd: (summary: string) => void
  ) {}

  private setStatus(s: AgentStatus): void {
    this.status = s
    this.send('agent:status', s)
  }

  async start(kind: AgentKind, dir: string, apiKey: string): Promise<void> {
    this.stop()
    const gen = ++this.generation
    const stale = (): boolean => gen !== this.generation
    this.setStatus({ state: 'starting', kind })
    // The agent may use VideoDB directly (skills / SDK scripts), so it gets the user's key too.
    const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1', VIDEO_DB_API_KEY: apiKey }
    // Drive the user's own installed CLIs (same login, same version they use) instead of bundled copies.
    if (kind === 'claude') env.CLAUDE_CODE_EXECUTABLE ??= await which('claude')
    if (kind === 'codex') env.CODEX_PATH ??= await which('codex')
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
        if (params.sessionId === this.sessionId) this.send('agent:update', params.update)
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
        clientInfo: { name: 'cutroom', version: '0.1.0' }
      })
      const session = await conn.agent.request(methods.agent.session.new, {
        cwd: dir,
        mcpServers: [
          {
            name: 'videodb',
            command: process.execPath,
            args: [join(__dirname, 'mcp.js')],
            env: [
              { name: 'ELECTRON_RUN_AS_NODE', value: '1' },
              { name: 'VIDEO_DB_API_KEY', value: apiKey },
              { name: 'CUTROOM_PROJECT', value: dir }
            ]
          }
        ]
      })
      if (stale()) return
      this.sessionId = session.sessionId
      this.setStatus({
        state: 'ready',
        kind,
        name: init.agentInfo?.title ?? init.agentInfo?.name ?? ADAPTERS[kind].label,
        modes: session.modes?.availableModes ?? [],
        currentMode: session.modes?.currentModeId,
        images: !!init.agentCapabilities?.promptCapabilities?.image
      })
    } catch (e) {
      if (stale()) return
      const err = e as { message?: string; code?: number }
      const auth = err.code === -32000 || /auth/i.test(err.message ?? '')
      this.setStatus({
        state: 'error',
        kind,
        error: auth
          ? `${ADAPTERS[kind].label} is not signed in. Run \`${ADAPTERS[kind].login}\` in a terminal, then restart the agent.`
          : (err.message ?? String(e))
      })
      this.stop(false)
    }
  }

  async prompt(text: string, attachments: Attachment[] = []): Promise<void> {
    if (!this.conn || !this.sessionId) throw new Error('Agent is not running')
    try {
      const res = await this.conn.agent.request(methods.agent.session.prompt, {
        sessionId: this.sessionId,
        prompt: await this.blocks(text, attachments)
      })
      this.send('agent:stop', { stopReason: res.stopReason })
    } catch (e) {
      const err = e as { message?: string; data?: { message?: string } }
      this.send('agent:stop', {
        stopReason: 'error',
        error: err.data?.message ?? err.message ?? String(e)
      })
    } finally {
      this.onTurnEnd(text)
    }
  }

  // Every attachment is announced by path so the agent can decide; images also go inline when supported.
  private async blocks(text: string, attachments: Attachment[]): Promise<ContentBlock[]> {
    const out: ContentBlock[] = []
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
      void this.conn.agent.notify(methods.agent.session.cancel, { sessionId: this.sessionId })
    for (const resolve of this.pending.values()) resolve({ outcome: { outcome: 'cancelled' } })
    this.pending.clear()
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
    this.send('agent:permission', ask)
    return new Promise((resolve) => this.pending.set(requestId, resolve))
  }

  answerPermission(requestId: string, optionId: string | null): void {
    const resolve = this.pending.get(requestId)
    if (!resolve) return
    this.pending.delete(requestId)
    resolve({ outcome: optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' } })
  }

  stop(report = true): void {
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
