// `vdb` CLI: the MCP tools for agents without MCP (Pi) or for scripts. Wrapper lives at .cutroom/bin/vdb.
import { readAssets } from '@shared/project'
import { readJson } from '@shared/project'
import { requestImport } from '@shared/inbox'
import {
  compileProject,
  exportProject,
  getFrames,
  inspectCuts,
  searchFootage,
  validateProject
} from '@shared/vdb'

const dir = process.env.CUTROOM_PROJECT ?? process.cwd()

const USAGE = `vdb <command>

  list                              media ids, durations, status
  import <path | url | m-videoid>   bring media into the project, print its id
  search "<query>" [--kind speech|visual|both] [--media <id>] [--top <n>]
  frames <media_id> <t1> [t2 ...]   save frames (source seconds) to renders/frames, print paths
  validate                          check timeline.json
  compile                           render timeline.json, print stream url
  cuts [--track <n>]                frames either side of each cut, print paths
  export                            mp4 download for the current timeline`

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args.splice(i, 2)[1] : undefined
}

const print = (v: unknown): void =>
  console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2))

async function main(): Promise<void> {
  const settings = await readJson<{ apiKey?: string }>(process.env.CUTROOM_SETTINGS ?? '', {})
  const apiKey = process.env.VIDEO_DB_API_KEY || settings.apiKey || ''
  const [cmd, ...args] = process.argv.slice(2)
  switch (cmd) {
    case 'list':
      return print((await readAssets(dir)).media.map(({ sprite: _s, ...m }) => m))
    case 'import': {
      const v = args[0] ?? ''
      const source = /^https?:\/\//.test(v)
        ? { url: v }
        : /^m-[\w-]+$/.test(v)
          ? { videoId: v }
          : { filePath: v }
      const r = await requestImport(dir, source)
      if (!r.ok) throw new Error(r.error)
      return print(r.media)
    }
    case 'search': {
      const kind = flag(args, 'kind') as 'speech' | 'visual' | 'both' | undefined
      const mediaId = flag(args, 'media')
      const topK = Number(flag(args, 'top') ?? 5)
      return print(await searchFootage(dir, apiKey, args.join(' '), { kind, mediaId, topK }))
    }
    case 'frames': {
      const [id, ...times] = args
      const frames = await getFrames(dir, apiKey, id, times.map(Number))
      return print(frames.map((f) => `${id} @ ${f.time}s -> ${f.path}`).join('\n'))
    }
    case 'validate': {
      const issues = await validateProject(dir)
      return print(issues.length ? issues : 'timeline.json is valid.')
    }
    case 'compile':
      return print(await compileProject(dir, apiKey))
    case 'cuts': {
      const cuts = await inspectCuts(dir, apiKey, Number(flag(args, 'track') ?? 0))
      return print(
        cuts.length
          ? cuts.map((c) => `${c.label}\n  ${c.frames.map((f) => f.path).join('\n  ')}`).join('\n')
          : 'No cuts.'
      )
    }
    case 'export':
      return print(await exportProject(dir, apiKey))
    default:
      print(USAGE)
  }
}

main().catch((e) => {
  console.error(`vdb: ${(e as Error).message ?? e}`)
  process.exit(1)
})
