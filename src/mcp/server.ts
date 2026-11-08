// Stdio MCP server handed to the ACP agent via session/new. Runs under ELECTRON_RUN_AS_NODE.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { readAssets } from '@shared/project'
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
const apiKey = process.env.VIDEO_DB_API_KEY ?? ''

const server = new McpServer({ name: 'videodb', version: '0.1.0' })

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
const text = (v: unknown): { content: Content[] } => ({
  content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }]
})

async function guard<T>(fn: () => Promise<T>): Promise<T | { content: Content[]; isError: true }> {
  try {
    return await fn()
  } catch (e) {
    return {
      content: [{ type: 'text', text: `Error: ${(e as Error).message ?? e}` }],
      isError: true
    }
  }
}

server.registerTool(
  'list_media',
  {
    description:
      'List imported media: id, kind, name, duration (s), status, and whether transcripts/search are available.'
  },
  () =>
    guard(async () =>
      text(
        (await readAssets(dir)).media.map((m) => ({
          id: m.id,
          name: m.name,
          kind: m.kind,
          duration: m.duration,
          status: m.status,
          searchable: Object.keys(m.index_ids ?? {}),
          error: m.error
        }))
      )
    )
)

server.registerTool(
  'import_media',
  {
    description:
      'Bring media into this project: a local file path, a public URL (incl. YouTube) or an existing VideoDB video id. Cutroom uploads it, then transcribes and describes videos in the background. Returns the media id to use on the timeline.',
    inputSchema: {
      path: z.string().optional(),
      url: z.string().optional(),
      video_id: z.string().optional()
    }
  },
  ({ path, url, video_id }) =>
    guard(async () => {
      const source = path
        ? { filePath: path }
        : url
          ? { url }
          : video_id
            ? { videoId: video_id }
            : null
      if (!source) throw new Error('Give one of path, url or video_id.')
      const r = await requestImport(dir, source)
      if (!r.ok) throw new Error(r.error ?? 'import failed')
      return text({
        ...r.media,
        note:
          r.media?.kind === 'video'
            ? 'Transcript and scenes arrive in media/<id>/ when status is ready; it can go on the timeline now.'
            : undefined
      })
    })
)

server.registerTool(
  'search_footage',
  {
    description:
      'Semantic search across what is said (speech) and shown (visual) in the project footage. Returns source-time ranges per media id, best first.',
    inputSchema: {
      query: z.string(),
      kind: z.enum(['speech', 'visual', 'both']).optional(),
      media_id: z.string().optional(),
      top_k: z.number().int().min(1).max(20).optional()
    }
  },
  ({ query, kind, media_id, top_k }) =>
    guard(async () => {
      const hits = await searchFootage(dir, apiKey, query, { kind, mediaId: media_id, topK: top_k })
      return text(hits.length ? hits : 'No matches. Media may still be indexing (see list_media).')
    })
)

server.registerTool(
  'get_frames',
  {
    description:
      'Grab frames from a source video at the given source times (seconds). Returns the images and saves them to renders/frames/.',
    inputSchema: { media_id: z.string(), times: z.array(z.number().min(0)).min(1).max(12) }
  },
  ({ media_id, times }) =>
    guard(async () => {
      const frames = await getFrames(dir, apiKey, media_id, times)
      return {
        content: frames.flatMap((f): Content[] => [
          { type: 'text', text: `${media_id} @ ${f.time}s -> ${f.path}` },
          { type: 'image', data: f.data, mimeType: 'image/jpeg' }
        ])
      }
    })
)

server.registerTool(
  'validate_timeline',
  {
    description:
      'Check timeline.json against the schema and assets.json (unknown media, overlaps, clips past source end).'
  },
  () =>
    guard(async () => {
      const issues = await validateProject(dir)
      return text(issues.length ? issues : 'timeline.json is valid.')
    })
)

server.registerTool(
  'compile_timeline',
  {
    description:
      'Render timeline.json on VideoDB. Returns a playable HLS stream URL or the errors to fix.'
  },
  () => guard(async () => text(await compileProject(dir, apiKey)))
)

server.registerTool(
  'inspect_cuts',
  {
    description:
      'Frames just before and after every cut between consecutive video clips on a track (default: first track). Use to check cut quality.',
    inputSchema: {
      track: z.number().int().min(0).optional(),
      max_cuts: z.number().int().min(1).max(10).optional()
    }
  },
  ({ track, max_cuts }) =>
    guard(async () => {
      const cuts = await inspectCuts(dir, apiKey, track ?? 0, max_cuts ?? 6)
      if (!cuts.length) return text('No cuts between video clips on that track.')
      return {
        content: cuts.flatMap((c): Content[] => [
          { type: 'text', text: c.label },
          ...c.frames.map((f): Content => ({ type: 'image', data: f.data, mimeType: 'image/jpeg' }))
        ])
      }
    })
)

server.registerTool(
  'export_video',
  {
    description:
      'Compile and request an MP4 download of the current timeline. Returns the download info.'
  },
  () => guard(async () => text(await exportProject(dir, apiKey)))
)

void server.connect(new StdioServerTransport())
