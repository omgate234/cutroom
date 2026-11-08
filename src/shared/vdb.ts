import { promises as fs } from 'fs'
import { join, basename } from 'path'
import { createHash, randomBytes } from 'crypto'
import { connect, Video, Audio, Image } from 'videodb'
import { MediaItem, Issue, SpriteManifest, toWire, validateTimeline } from './timeline'
import {
  paths,
  patchMedia,
  readAssets,
  readJson,
  readTimeline,
  updateAssets,
  writeJson
} from './project'

type Connection = ReturnType<typeof connect>
type Collection = Awaited<ReturnType<Connection['getCollection']>>

const API = 'https://api.videodb.io'

let cached: { key: string; conn: Connection; coll: Promise<Collection> } | null = null

function vdb(apiKey: string): { conn: Connection; coll: Promise<Collection> } {
  if (!apiKey) throw new Error('VideoDB API key is not set. Add it in Cutroom settings.')
  if (cached?.key !== apiKey) {
    const conn = connect({ apiKey })
    cached = { key: apiKey, conn, coll: conn.getCollection() }
  }
  return cached
}

export async function validateKey(
  apiKey: string
): Promise<{ ok: true; collection: string } | { ok: false; error: string }> {
  try {
    const coll = await connect({ apiKey }).getCollection()
    return { ok: true, collection: coll.name ?? coll.id }
  } catch (e) {
    const err = e as {
      response?: { status?: number; data?: { message?: string } }
      message?: string
    }
    if (err.response?.status === 401 || err.response?.status === 403)
      return { ok: false, error: 'That key was rejected.' }
    return {
      ok: false,
      error: err.response?.data?.message ?? err.message ?? 'Could not reach VideoDB.'
    }
  }
}

const getVideo = async (apiKey: string, id: string): Promise<Video> =>
  (await vdb(apiKey).coll).getVideo(id)

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : undefined
}

export type Source = { filePath: string } | { url: string } | { videoId: string }

export async function importMedia(dir: string, apiKey: string, src: Source): Promise<MediaItem> {
  const name = 'filePath' in src ? basename(src.filePath) : 'url' in src ? src.url : src.videoId
  const tempId = `pending-${randomBytes(3).toString('hex')}`
  await updateAssets(
    dir,
    (a) => void a.media.push({ id: tempId, name, kind: 'video', status: 'uploading' })
  )
  try {
    const coll = await vdb(apiKey).coll
    const obj =
      'videoId' in src
        ? await coll.getVideo(src.videoId)
        : 'filePath' in src
          ? await coll.uploadFile({ filePath: src.filePath })
          : await coll.uploadURL({ url: src.url })
    if (!obj) throw new Error('upload returned nothing')
    let item: MediaItem
    if (obj instanceof Video) {
      item = {
        id: obj.id,
        name: 'videoId' in src ? obj.name || name : name,
        kind: 'video',
        duration: num(obj.length),
        status: 'indexing',
        stream_url: obj.streamUrl,
        thumbnail: obj.thumbnail
      }
    } else if (obj instanceof Audio) {
      item = { id: obj.id, name, kind: 'audio', duration: num(obj.length), status: 'ready' }
    } else {
      const img = obj as Image
      item = { id: img.id, name, kind: 'image', status: 'ready', thumbnail: img.url }
    }
    await updateAssets(dir, (a) => {
      a.media = a.media.filter((m) => m.id !== tempId && m.id !== item.id)
      a.media.push(item)
    })
    if (item.kind === 'video') {
      void loadSprite(dir, apiKey, item.id)
      void understandVideo(dir, apiKey, item.id)
    }
    return item
  } catch (e) {
    await patchMedia(dir, tempId, { status: 'failed', error: String((e as Error).message ?? e) })
    throw e
  }
}

interface Segment {
  start: number
  end: number
  data?: {
    text?: string
    description?: string
    words?: { text: string; start: number; end: number; speaker?: string }[]
  }
}

const fmt = (n: number): string => n.toFixed(2)

// Transcript + scene descriptions land in media/<id>/ so the agent can read them as files.
export async function understandVideo(dir: string, apiKey: string, id: string): Promise<void> {
  try {
    const video = await getVideo(apiKey, id)
    if (!video.thumbnail) {
      const thumb = await video.generateThumbnail().catch(() => undefined)
      if (typeof thumb === 'string') await patchMedia(dir, id, { thumbnail: thumb })
    }
    const u = await video.understand(
      [
        { type: 'spoken_words', name: 'transcript' },
        {
          type: 'vlm',
          name: 'scene',
          config: {
            prompt:
              'Describe the shot for a video editor: framing, subject, action, on-screen text.',
            schema: { description: 'string' }
          }
        }
      ],
      { segmentation: { type: 'time', seconds: 4 } }
    )
    await u.waitUntilComplete(60 * 60 * 1000, 5000)
    const out = join(paths(dir).media(id))
    await fs.mkdir(out, { recursive: true })

    const index_ids: Record<string, string> = {}
    for (const [name, field] of [
      ['transcript', 'text'],
      ['scene', 'description']
    ] as const) {
      const analyzer = await u.getAnalyzer(name).catch(() => undefined)
      if (!analyzer) continue
      const output = (await analyzer.getOutput()) as { scenes?: Segment[] }
      const scenes = (output?.scenes ?? []).sort((a, b) => a.start - b.start)
      const lines = scenes
        .map((s) => [s, (s.data?.[field] ?? '').trim()] as const)
        .filter(([, t]) => t && t !== '-')
        .map(([s, t]) => `[${fmt(s.start)}-${fmt(s.end)}] ${t}`)
      await fs.writeFile(
        join(out, name === 'transcript' ? 'transcript.txt' : 'scenes.txt'),
        lines.join('\n') + '\n'
      )
      if (name === 'transcript') {
        const words = scenes.flatMap((s) => s.data?.words ?? []).sort((a, b) => a.start - b.start)
        await writeJson(join(out, 'words.json'), words)
      }
      if (!lines.length) continue
      const idx = await video.index(analyzer, {
        name,
        useFor: ['semantic'],
        fields: { semantic: [field] }
      })
      if (idx?.indexId) {
        await idx.waitUntilComplete(30 * 60 * 1000, 5000)
        index_ids[name] = idx.indexId
      }
    }
    await patchMedia(dir, id, { status: 'ready', index_ids, error: undefined })
  } catch (e) {
    // Media stays usable on the timeline; only transcripts/search are missing.
    await patchMedia(dir, id, {
      status: 'ready',
      error: `understanding failed: ${(e as Error).message ?? e}`
    })
  }
}

export interface Hit {
  media_id: string
  name: string
  kind: 'speech' | 'visual'
  start: number
  end: number
  text?: string
  score?: number
}

export async function searchFootage(
  dir: string,
  apiKey: string,
  query: string,
  opts: { mediaId?: string; kind?: 'speech' | 'visual' | 'both'; topK?: number } = {}
): Promise<Hit[]> {
  const assets = await readAssets(dir)
  const kind = opts.kind ?? 'both'
  const targets = assets.media.filter(
    (m) => m.kind === 'video' && m.index_ids && (!opts.mediaId || m.id === opts.mediaId)
  )
  const hits: Hit[] = []
  for (const m of targets) {
    const video = await getVideo(apiKey, m.id)
    for (const [name, hitKind] of [
      ['transcript', 'speech'],
      ['scene', 'visual']
    ] as const) {
      const indexId = m.index_ids?.[name]
      if (!indexId || (kind !== 'both' && kind !== hitKind)) continue
      const res = await video.semanticSearch(query, { indexIds: [indexId], topK: opts.topK ?? 5 })
      for (const s of res.getShots())
        hits.push({
          media_id: m.id,
          name: m.name,
          kind: hitKind,
          start: s.start,
          end: s.end,
          text: s.text,
          score: s.searchScore
        })
    }
  }
  return hits.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
}

export async function getFrames(
  dir: string,
  apiKey: string,
  mediaId: string,
  times: number[]
): Promise<{ time: number; path: string; data: string }[]> {
  const video = await getVideo(apiKey, mediaId)
  await fs.mkdir(paths(dir).frames, { recursive: true })
  return Promise.all(
    times.map(async (time) => {
      const img = await video.generateThumbnail(Math.max(0, time))
      const url = typeof img === 'string' ? img : img.url
      if (!url) throw new Error(`no frame at ${time}s`)
      const buf = Buffer.from(await (await fetch(url)).arrayBuffer())
      const path = join(paths(dir).frames, `${mediaId}_${time.toFixed(2)}.jpg`)
      await fs.writeFile(path, buf)
      return { time, path, data: buf.toString('base64') }
    })
  )
}

export interface CompileResult {
  ok: boolean
  issues: Issue[]
  stream_url?: string
  player_url?: string
  error?: string
  hash?: string
}

export async function validateProject(dir: string): Promise<Issue[]> {
  const raw = await readJson<unknown>(paths(dir).timeline, null)
  if (raw === null) return [{ path: '', message: 'timeline.json is missing or not valid JSON' }]
  return validateTimeline(raw, await readAssets(dir))
}

// Content-hash cache shared by the app and the MCP server, so one save compiles once.
export async function compileProject(dir: string, apiKey: string): Promise<CompileResult> {
  const issues = await validateProject(dir)
  if (issues.length) return { ok: false, issues }
  const timeline = await readTimeline(dir)
  if (!timeline.tracks.some((t) => t.clips.length))
    return { ok: false, issues: [], error: 'timeline is empty' }
  const body = toWire(timeline)
  const hash = createHash('sha1').update(JSON.stringify(body)).digest('hex')
  const cache = await readJson<Record<string, { stream_url: string; player_url?: string }>>(
    paths(dir).cache,
    {}
  )
  if (cache[hash]) return { ok: true, issues: [], ...cache[hash], hash }
  try {
    const res = await vdb(apiKey).conn.vhttp.post<
      { streamUrl?: string; playerUrl?: string },
      object
    >(['editor'], body)
    const stream_url = res.data?.streamUrl
    if (!stream_url) return { ok: false, issues: [], error: 'VideoDB returned no stream URL' }
    cache[hash] = { stream_url, player_url: res.data?.playerUrl }
    await writeJson(paths(dir).cache, cache)
    return { ok: true, issues: [], stream_url, player_url: res.data?.playerUrl, hash }
  } catch (e) {
    const err = e as { response?: { data?: { message?: string } }; message?: string }
    return { ok: false, issues: [], error: err.response?.data?.message ?? err.message ?? String(e) }
  }
}

export async function exportProject(dir: string, apiKey: string): Promise<Record<string, unknown>> {
  const c = await compileProject(dir, apiKey)
  if (!c.ok || !c.stream_url)
    throw new Error(c.error ?? c.issues.map((i) => `${i.path}: ${i.message}`).join('; '))
  const res = await vdb(apiKey).conn.vhttp.post<Record<string, unknown>, object>(
    ['editor', 'download'],
    {
      stream_url: c.stream_url
    }
  )
  return { stream_url: c.stream_url, ...res.data }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function getJson(url: string, apiKey: string): Promise<Record<string, any>> {
  const res = await fetch(url, { headers: { 'x-access-token': apiKey } })
  return (await res.json().catch(() => ({}))) as Record<string, any>
}

// Filmstrip sheets for timeline tiles and hover-scrub. Async on the server: 202 + output_url to poll.
export async function loadSprite(
  dir: string,
  apiKey: string,
  id: string
): Promise<SpriteManifest | null> {
  try {
    const body = await getJson(`${API}/video/${id}/sprite/`, apiKey)
    let manifest: SpriteManifest | undefined = body.status === 'ready' ? body.data : undefined
    const outputUrl: string | undefined = body.data?.output_url
    for (let i = 0; !manifest && outputUrl && i < 90; i++) {
      await sleep(2000)
      const job = await getJson(outputUrl, apiKey)
      if (job.status === 'processing') continue
      manifest = job.response?.data
      break
    }
    if (!manifest?.sheets?.length) return null
    const { interval, grid, thumbnail, thumbnail_count, sheets, duration } = manifest
    const sprite = { interval, grid, thumbnail, thumbnail_count, sheets, duration }
    await patchMedia(dir, id, { sprite })
    return sprite
  } catch {
    return null
  }
}

export interface CutFrames {
  label: string
  frames: { path: string; data: string }[]
}

export async function inspectCuts(
  dir: string,
  apiKey: string,
  track = 0,
  maxCuts = 6
): Promise<CutFrames[]> {
  const t = await readTimeline(dir)
  const clips = [...(t.tracks[track]?.clips ?? [])]
    .filter((c) => c.clip.asset.type === 'video')
    .sort((a, b) => a.start - b.start)
  const out: CutFrames[] = []
  for (let i = 1; i < clips.length && out.length < maxCuts; i++) {
    const [a, b] = [clips[i - 1], clips[i]]
    const outT = (a.clip.asset.start ?? 0) + a.clip.duration - 0.05
    const inT = b.clip.asset.start ?? 0
    const [fa] = await getFrames(dir, apiKey, a.clip.asset.id!, [outT])
    const [fb] = await getFrames(dir, apiKey, b.clip.asset.id!, [inT])
    out.push({
      label: `Cut at ${b.start.toFixed(2)}s: "${a.id}" out (src ${outT.toFixed(2)}s) -> "${b.id}" in (src ${inT.toFixed(2)}s)`,
      frames: [fa, fb]
    })
  }
  return out
}
