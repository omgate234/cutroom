import { execFile } from 'child_process'
import { promisify } from 'util'
import type { AgentInfo, AgentKind } from '@shared/ipc'

const exec = promisify(execFile)

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

export async function detectAgents(): Promise<AgentInfo[]> {
  return Promise.all(
    AGENTS.map(async (a): Promise<AgentInfo> => {
      try {
        const { stdout, stderr } = await exec(a.bin, ['--version'], { timeout: 8000 })
        const out = `${stdout}\n${stderr}`
        const version = out.match(/\d+\.\d+\.\d+/)?.[0] ?? out.trim()
        const outdated = !!a.minVersion && older(version, a.minVersion)
        return {
          kind: a.kind,
          name: a.name,
          installed: true,
          version,
          note: outdated ? `Needs ${a.minVersion}+ for ACP. Update: ${a.install}` : undefined,
          usable: !outdated
        }
      } catch {
        return { kind: a.kind, name: a.name, installed: false, usable: false, note: a.install }
      }
    })
  )
}

// Full path of an installed CLI on the user's PATH, or undefined.
export async function which(bin: string): Promise<string | undefined> {
  try {
    const { stdout } = await exec('/usr/bin/which', [bin], { timeout: 4000 })
    return stdout.trim() || undefined
  } catch {
    return undefined
  }
}
