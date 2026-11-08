// Import requests from the agent (MCP tool / vdb CLI) land in .cutroom/inbox/; the app performs them
// so uploads and indexing outlive the agent process.
import { existsSync, promises as fs } from 'fs'
import { join } from 'path'
import { randomBytes } from 'crypto'
import { readJson, writeJson } from './project'

export interface ImportRequest {
  id: string
  source: { filePath: string } | { url: string } | { videoId: string }
}

export interface ImportResult {
  id: string
  ok: boolean
  media?: { id: string; name: string; kind: string; duration?: number; status: string }
  error?: string
}

export const inboxDir = (dir: string): string => join(dir, '.cutroom', 'inbox')

export async function requestImport(
  dir: string,
  source: ImportRequest['source'],
  timeoutMs = 15 * 60_000
): Promise<ImportResult> {
  const id = randomBytes(6).toString('hex')
  await writeJson(join(inboxDir(dir), `${id}.json`), { id, source })
  const done = join(inboxDir(dir), `${id}.done.json`)
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (existsSync(done)) {
      const r = await readJson<ImportResult | null>(done, null)
      if (r) {
        await fs.rm(done, { force: true })
        return r
      }
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  return {
    id,
    ok: false,
    error: 'Timed out waiting for Cutroom to import. Is the app open on this project?'
  }
}
