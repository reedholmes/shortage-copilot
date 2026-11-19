/**
 * Shapes shared by the agent (server) and the Agent screen (browser).
 * The server streams these events one per line while the agent works.
 */
import type { Routing } from './approvals'

export interface NoteDraft {
  subject: string
  body: string
  summary: string
}

export interface TraceTable {
  columns: string[]
  rows: (string | number)[][]
}

export interface TraceStep {
  n: number
  tool: string
  /** The agent's own one-sentence reason for calling this tool. */
  reason: string
  input: Record<string, unknown>
  /** One-line plain-English result. */
  summary: string
  table?: TraceTable
  note?: { marketId: string; title: string; draft: NoteDraft; source: 'ai' | 'cache' | 'template' }
  isError?: boolean
}

/** Tokens used by the agent's own turns (note drafting is counted separately). */
export interface RunUsage {
  inputTokens: number
  outputTokens: number
  turns: number
}

/** Where a run came from. */
export type RunSource = 'ai' | 'cache' | 'scripted'
export type RunFallbackReason = 'rate_limited' | 'daily_cap' | 'not_configured' | 'ai_unavailable'

export type AgentEvent =
  | { type: 'start'; source: RunSource; reason?: RunFallbackReason; customerId: string; skuId: string }
  | { type: 'step'; step: TraceStep }
  /** The live AI run failed part way; the screen clears and a scripted run follows. */
  | { type: 'reset'; reason: RunFallbackReason }
  | { type: 'done'; summary: string; routing: Routing; model?: string; usage?: RunUsage }
  | { type: 'error'; message: string }

/** A finished run, as saved for replay. */
export interface SavedRun {
  steps: TraceStep[]
  summary: string
  routing: Routing
  model?: string
  usage?: RunUsage
}
