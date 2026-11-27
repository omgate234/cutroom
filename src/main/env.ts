import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { existsSync, promises as fs } from 'fs'
import { homedir } from 'os'
import { dirname, extname, join, sep } from 'path'
import type { AgentInfo, AgentKind } from '@shared/ipc'
import { readJson } from '@shared/project'

const exec = promisify(execFile)
const WIN = process.platform === 'win32'

// GUI launches get a bare PATH; adapters need the user's shell PATH to find claude/codex/pi.
export async function loadShellPath(): Promise<void> {
  if (process.platform === 'win32') return
  try {
    const shell = process.env.SHELL || '/bin/zsh'
    const { stdout } = await exec(shell, ['-ilc', 'printf "__P__%s__P__" "$PATH"'], {
      timeout: 5000
    })
    const m = stdout.match(/__P__(.*)__P__/)
    if (m?.[1]) process.env.PATH = m[1]
  } catch {
    /* keep the inherited PATH */
  }
}

const AGENTS: {
  kind: AgentKind
  name: string
  bin: string
  install: string
  minVersion?: string
}[] = [
  {
    kind: 'claude',
    name: 'Claude Code',
    bin: 'claude',
    install: 'npm i -g @anthropic-ai/claude-code'
  },
  { kind: 'codex', name: 'Codex', bin: 'codex', install: 'npm i -g @openai/codex' },
  {
    kind: 'pi',
    name: 'Pi',
    bin: 'pi',
    install: 'npm i -g @earendil-works/pi-coding-agent',
    minVersion: '0.81.0'
  }
]

const semver = (s: string): number[] =>
  (s.match(/\d+\.\d+\.\d+/)?.[0] ?? '0.0.0').split('.').map(Number)
const older = (a: string, b: string): boolean => {
  const [x, y] = [semver(a), semver(b)]
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i]
  return false
}

// Command that signs the user in, run in a terminal window.
export const LOGIN_COMMAND: Record<AgentKind, string> = {
  claude: 'claude auth login',
  codex: 'codex login',
  pi: 'pi'
}

// From the CLI's own status command. undefined when there is none (Pi) or it could not run.
export async function signedIn(kind: AgentKind): Promise<boolean | undefined> {
  const opts = { timeout: 10000, shell: WIN }
  try {
    if (kind === 'claude') {
      const { stdout } = await exec('claude', ['auth', 'status', '--json'], opts)
      return JSON.parse(stdout).loggedIn === true
    }
    if (kind === 'codex') {
      await exec('codex', ['login', 'status'], opts)
      return true
    }
  } catch (e) {
    // Both exit 1 when signed out; claude still prints its JSON.
    const err = e as { code?: number | string; stdout?: string }
    if (err.code !== 1) return undefined
    if (kind === 'codex') return false
    try {
      return JSON.parse(err.stdout ?? '').loggedIn === true
    } catch {
      return false
    }
  }
  return undefined
}

export async function openLogin(kind: AgentKind): Promise<void> {
  const cmd = LOGIN_COMMAND[kind]
  if (process.platform === 'darwin') {
    await exec('osascript', [
      '-e',
      `tell application "Terminal" to do script "${cmd}"`,
      '-e',
      'tell application "Terminal" to activate'
    ])
  } else if (WIN) {
    spawn('cmd.exe', ['/c', `start "" cmd /k ${cmd}`], {
      detached: true,
      windowsVerbatimArguments: true,
      stdio: 'ignore'
    }).unref()
  } else {
    spawn('x-terminal-emulator', ['-e', `sh -c '${cmd}; exec sh'`], {
      detached: true,
      stdio: 'ignore'
    }).unref()
  }
}

// Claude Code tool-name prefixes (mcp__<server>) of VideoDB MCP servers the user set up outside
// Cutroom: their own config, plugins, claude.ai connectors. They may be another VideoDB account,
// so Cutroom sessions block them and all VideoDB work goes through Cutroom's key.
export async function otherVideoDbServers(dir: string): Promise<string[]> {
  const home = homedir()
  const cfg = await readJson<{
    mcpServers?: Record<string, unknown>
    projects?: Record<string, { mcpServers?: Record<string, unknown> }>
    claudeAiMcpEverConnected?: string[]
  }>(join(home, '.claude.json'), {})
  // Per-folder servers count for the project folder and every folder above it.
  const inherited = Object.entries(cfg.projects ?? {})
    .filter(([p]) => dir === p || dir.startsWith(p.endsWith(sep) ? p : p + sep))
    .flatMap(([, v]) => Object.keys(v.mcpServers ?? {}))
  const local = await readJson<{ mcpServers?: Record<string, unknown> }>(join(dir, '.mcp.json'), {})
  const names = new Set<string>([
    ...Object.keys(cfg.mcpServers ?? {}),
    ...inherited,
    ...Object.keys(local.mcpServers ?? {}),
    ...(cfg.claudeAiMcpEverConnected ?? [])
  ])
  const installed = await readJson<{
    plugins?: Record<string, { installPath: string }[]>
  }>(join(home, '.claude', 'plugins', 'installed_plugins.json'), {})
  for (const [id, installs] of Object.entries(installed.plugins ?? {})) {
    const plugin = id.split('@')[0]
    for (const { installPath } of installs) {
      const mcp = await readJson<Record<string, unknown>>(join(installPath, '.mcp.json'), {})
      const servers = (mcp.mcpServers as Record<string, unknown> | undefined) ?? mcp
      for (const s of Object.keys(servers)) names.add(`plugin:${plugin}:${s}`)
    }
  }
  const clean = (s: string): string => s.replace(/[^a-zA-Z0-9_-]/g, '_')
  const prefix = (n: string): string =>
    n.startsWith('claude.ai ')
      ? `claude_ai_${clean(n.slice('claude.ai '.length))}`
      : n.startsWith('plugin:')
        ? `plugin_${n.split(':').slice(1).map(clean).join('_')}`
        : clean(n)
  return [...names]
    .filter((n) => /video.?db/i.test(n))
    .map((n) => `mcp__${prefix(n)}`)
    .filter((p) => p !== 'mcp__cutroom')
}

export async function detectAgents(): Promise<AgentInfo[]> {
  return Promise.all(
    AGENTS.map(async (a): Promise<AgentInfo> => {
      try {
        // npm installs CLIs on Windows as .cmd shims, which only run through a shell.
        const { stdout, stderr } = await exec(a.bin, ['--version'], { timeout: 8000, shell: WIN })
        const out = `${stdout}\n${stderr}`
        const version = out.match(/\d+\.\d+\.\d+/)?.[0] ?? out.trim()
        const outdated = !!a.minVersion && older(version, a.minVersion)
        return {
          kind: a.kind,
          name: a.name,
          installed: true,
          version,
          signedIn: await signedIn(a.kind),
          login: LOGIN_COMMAND[a.kind],
          note: outdated ? `Needs ${a.minVersion}+ for ACP. Update: ${a.install}` : undefined,
          usable: !outdated
        }
      } catch {
        return { kind: a.kind, name: a.name, installed: false, usable: false, note: a.install }
      }
    })
  )
}

// Full path of an installed CLI on the user's PATH, or undefined. On Windows this is a file that
// can be spawned directly: a .exe, or the script an npm .cmd shim points at.
export async function which(bin: string): Promise<string | undefined> {
  try {
    if (!WIN) {
      const { stdout } = await exec('/usr/bin/which', [bin], { timeout: 4000 })
      return stdout.trim() || undefined
    }
    const { stdout } = await exec('where.exe', [bin], { timeout: 4000 })
    const hits = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    const exe = hits.find((h) => extname(h).toLowerCase() === '.exe')
    if (exe) return exe
    for (const h of hits.filter((h) => extname(h).toLowerCase() === '.cmd')) {
      const target = await shimTarget(h)
      if (target) return target
    }
    return undefined
  } catch {
    return undefined
  }
}

// npm's .cmd shims end in a line like: "%dp0%\node_modules\pkg\cli.js" %*  (or a .exe).
async function shimTarget(cmd: string): Promise<string | undefined> {
  const text = await fs.readFile(cmd, 'utf8').catch(() => '')
  const m = [...text.matchAll(/"%(?:~)?dp0%?\\([^"]+?\.(?:js|mjs|cjs|exe))"/gi)].pop()
  const target = m && join(dirname(cmd), m[1])
  return target && existsSync(target) ? target : undefined
}
