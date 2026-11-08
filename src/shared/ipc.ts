import type { AssetsFile, Issue, SpriteManifest, Timeline } from './timeline'

export type AgentKind = 'claude' | 'codex' | 'pi'

export interface Settings {
  apiKey: string
  agent: AgentKind
  recent: string[]
  onboarded: boolean
}

export interface AgentInfo {
  kind: AgentKind
  name: string
  installed: boolean
  usable: boolean
  version?: string
  note?: string
}

export type KeyCheck = { ok: true; collection: string } | { ok: false; error: string }

export interface ProjectMeta {
  id: string
  name: string
  description: string
  created: string
  updated: string
}

export interface ProjectSummary extends ProjectMeta {
  dir: string
  owned: boolean
  duration: number
  mediaCount: number
  cover?: { thumbnail?: string; sprite?: SpriteManifest; duration?: number }
}

export type SkillScope = { agent: AgentKind; installed: string[]; missing: string[]; dir: string }

export interface Attachment {
  path: string
  name: string
  size: number
  mime: string
}

export interface ProjectState {
  dir: string
  name: string
  meta: ProjectMeta
  timeline: Timeline
  assets: AssetsFile
}

export type CompileState =
  | { state: 'idle' }
  | { state: 'compiling' }
  | { state: 'ok'; stream_url: string; player_url?: string }
  | { state: 'invalid'; issues: Issue[] }
  | { state: 'error'; error: string }

export interface Checkpoint {
  hash: string
  message: string
  date: string
}

export interface AgentMode {
  id: string
  name: string
  description?: string | null
}

export type AgentStatus =
  | { state: 'off' }
  | { state: 'starting'; kind: AgentKind }
  | {
      state: 'ready'
      kind: AgentKind
      name: string
      modes: AgentMode[]
      currentMode?: string
      images: boolean
    }
  | { state: 'error'; kind: AgentKind; error: string }

export interface PermissionAsk {
  requestId: string
  title: string
  kind?: string | null
  rawInput?: unknown
  options: { optionId: string; name: string; kind: string }[]
}
