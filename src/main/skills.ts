// Global VideoDB skills from github.com/video-db/skills, installed the way Vercel's `skills` CLI does:
// each skill is copied to ~/.agents/skills/<name> (read by Codex and Pi) and linked into
// ~/.claude/skills/<name> for Claude Code. We fetch the repo tarball ourselves; nothing is executed.
import { existsSync, readdirSync, promises as fs } from 'fs'
import { homedir, tmpdir } from 'os'
import { join, relative, dirname } from 'path'
import { randomBytes } from 'crypto'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { AgentKind, SkillScope } from '@shared/ipc'

const exec = promisify(execFile)
const TARBALL = 'https://codeload.github.com/video-db/skills/tar.gz/refs/heads/main'
const IS_VIDEODB = /^(videodb|video-[\w-]+|get-started)$/

const home = homedir()
const agentsDir = join(home, '.agents', 'skills')
const claudeDir = join(process.env.CLAUDE_CONFIG_DIR?.trim() || join(home, '.claude'), 'skills')
const codexHome = process.env.CODEX_HOME?.trim() || join(home, '.codex')

const DIRS: Record<AgentKind, string[]> = {
  claude: [claudeDir],
  codex: [agentsDir, join(codexHome, 'skills')],
  pi: [agentsDir, join(home, '.pi', 'agent', 'skills')]
}

export function skillStatus(): SkillScope[] {
  return (Object.keys(DIRS) as AgentKind[]).map((agent) => {
    const dirs = DIRS[agent]
    const found = new Set<string>()
    for (const d of dirs) {
      if (!existsSync(d)) continue
      for (const name of readdirSync(d))
        if (IS_VIDEODB.test(name) && existsSync(join(d, name, 'SKILL.md'))) found.add(name)
    }
    const installed = [...found].sort()
    return {
      agent,
      dir: dirs[0].replace(home, '~'),
      installed,
      missing: found.has('videodb') ? [] : ['videodb']
    }
  })
}

async function findSkills(root: string, depth = 0): Promise<{ name: string; dir: string }[]> {
  if (depth > 3) return []
  const entries = await fs.readdir(root, { withFileTypes: true })
  const skillMd = entries.find((e) => e.isFile() && e.name === 'SKILL.md')
  if (skillMd) {
    const text = await fs.readFile(join(root, 'SKILL.md'), 'utf8')
    const name = text.match(/^---[\s\S]*?^name:\s*["']?([\w-]+)["']?\s*$/m)?.[1]
    return name ? [{ name, dir: root }] : []
  }
  const nested = await Promise.all(
    entries
      .filter(
        (e) =>
          e.isDirectory() &&
          !e.name.startsWith('.') &&
          !/^(evals?|tests?|node_modules)/.test(e.name)
      )
      .map((e) => findSkills(join(root, e.name), depth + 1))
  )
  return nested.flat()
}

export async function installSkills(agents: AgentKind[]): Promise<{ ok: boolean; output: string }> {
  const work = join(tmpdir(), `cutroom-skills-${randomBytes(4).toString('hex')}`)
  try {
    await fs.mkdir(work, { recursive: true })
    const res = await fetch(TARBALL)
    if (!res.ok) throw new Error(`GitHub returned ${res.status}`)
    const tgz = join(work, 'skills.tgz')
    await fs.writeFile(tgz, Buffer.from(await res.arrayBuffer()))
    await exec('tar', ['-xzf', tgz, '-C', work])
    const root = (await fs.readdir(work, { withFileTypes: true })).find((e) => e.isDirectory())
    if (!root) throw new Error('empty archive')
    const skills = await findSkills(join(work, root.name))
    if (!skills.length) throw new Error('no SKILL.md found in the repository')

    await fs.mkdir(agentsDir, { recursive: true })
    for (const s of skills) {
      const dest = join(agentsDir, s.name)
      await fs.rm(dest, { recursive: true, force: true })
      await fs.cp(s.dir, dest, { recursive: true })
      if (agents.includes('claude')) {
        const link = join(claudeDir, s.name)
        await fs.mkdir(dirname(link), { recursive: true })
        await fs.rm(link, { recursive: true, force: true })
        await fs.symlink(relative(dirname(link), dest), link, 'dir')
      }
    }
    return { ok: true, output: `Installed ${skills.map((s) => s.name).join(', ')}` }
  } catch (e) {
    return { ok: false, output: (e as Error).message ?? String(e) }
  } finally {
    await fs.rm(work, { recursive: true, force: true })
  }
}
