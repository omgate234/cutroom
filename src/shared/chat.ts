// Chat transcript as a reducer over agent events. The main process keeps the reduced state per
// project so a reopened project (or a reloaded window) picks the conversation up where it is.
import type { Attachment, PermissionAsk } from './ipc'

export type Block = { type: string; text?: string; data?: string; mimeType?: string }
export type ToolContent =
  | { type: 'content'; content: Block }
  | { type: 'diff'; path: string; oldText?: string | null; newText: string }
  | { type: 'terminal'; terminalId: string }

export interface ToolItem {
  type: 'tool'
  id: string
  title: string
  kind?: string | null
  status?: string | null
  rawInput?: unknown
  content: ToolContent[]
}

export type ChatItem =
  | { type: 'user'; text: string; files?: Attachment[] }
  | { type: 'agent'; text: string }
  | { type: 'thought'; text: string }
  | ToolItem
  | { type: 'plan'; entries: { content: string; status: string }[] }
  | { type: 'permission'; ask: PermissionAsk; answer?: string }
  | { type: 'error'; text: string }

export type AgentEvent =
  | { kind: 'update'; update: Record<string, any> }
  | { kind: 'user'; text: string; files: Attachment[] }
  | { kind: 'permission'; ask: PermissionAsk }
  | { kind: 'answer'; requestId: string; answer: string }
  | { kind: 'stop'; error?: string }
  | { kind: 'reset' }

export type SeqEvent = AgentEvent & { seq: number }

export interface ChatState {
  items: ChatItem[]
  running: boolean
}

export const EMPTY_CHAT: ChatState = { items: [], running: false }

export const isStep = (i: ChatItem): boolean =>
  ['tool', 'thought', 'plan', 'permission'].includes(i.type)

function applyUpdate(items: ChatItem[], u: Record<string, any>): ChatItem[] {
  const next = [...items]
  const last = next[next.length - 1]
  switch (u.sessionUpdate) {
    case 'user_message_chunk':
    case 'agent_message_chunk':
    case 'agent_thought_chunk': {
      const kind =
        u.sessionUpdate === 'user_message_chunk'
          ? 'user'
          : u.sessionUpdate === 'agent_message_chunk'
            ? 'agent'
            : 'thought'
      const text = u.content?.type === 'text' ? u.content.text : ''
      if (!text) return items
      if (last?.type === kind) next[next.length - 1] = { ...last, text: last.text + text }
      else next.push({ type: kind, text })
      return next
    }
    case 'tool_call': {
      const tool: ToolItem = {
        type: 'tool',
        id: u.toolCallId,
        title: u.title ?? 'Tool',
        kind: u.kind,
        status: u.status,
        rawInput: u.rawInput,
        content: u.content ?? []
      }
      // A replayed history can repeat a call; keep one row per id.
      const i = next.findIndex((x) => x.type === 'tool' && x.id === u.toolCallId)
      if (i >= 0) next[i] = tool
      else next.push(tool)
      return next
    }
    case 'tool_call_update': {
      const i = next.findIndex((x) => x.type === 'tool' && x.id === u.toolCallId)
      if (i < 0) return items
      const t = next[i] as ToolItem
      next[i] = {
        ...t,
        title: u.title ?? t.title,
        kind: u.kind ?? t.kind,
        status: u.status ?? t.status,
        rawInput: u.rawInput ?? t.rawInput,
        content: u.content ?? t.content
      }
      return next
    }
    case 'plan': {
      const plan: ChatItem = { type: 'plan', entries: u.entries ?? [] }
      const i = next.findLastIndex((x) => x.type === 'plan')
      if (i >= 0 && next.slice(i + 1).every(isStep)) next[i] = plan
      else next.push(plan)
      return next
    }
    default:
      return items
  }
}

export function reduceChat(s: ChatState, e: AgentEvent): ChatState {
  switch (e.kind) {
    case 'reset':
      return EMPTY_CHAT
    case 'update':
      return { ...s, items: applyUpdate(s.items, e.update) }
    case 'user':
      return {
        running: true,
        items: [
          ...s.items,
          { type: 'user', text: e.text, files: e.files.length ? e.files : undefined }
        ]
      }
    case 'permission':
      return { ...s, items: [...s.items, { type: 'permission', ask: e.ask }] }
    case 'answer':
      return {
        ...s,
        items: s.items.map((x) =>
          x.type === 'permission' && x.ask.requestId === e.requestId
            ? { ...x, answer: e.answer }
            : x
        )
      }
    case 'stop':
      return {
        running: false,
        items: e.error ? [...s.items, { type: 'error', text: e.error }] : s.items
      }
  }
}
