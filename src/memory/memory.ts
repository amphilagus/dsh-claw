/**
 * JSONL vector memory for one agent scope, embedded through a local Ollama
 * model. The file format is deliberately boring: one JSON object per line so
 * it can be inspected, backed up, and repaired with ordinary tools.
 * @module @deepseek-ai/dsh-claw/memory/memory
 */

import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { expandHomePath } from '@deepseek-ai/dsh-home-paths'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

/** Default directory holding every scope's memory JSONL files. */
export function defaultMemoryRoot(): string {
  return join(homedir(), 'dsh', 'memories')
}

/**
 * Expand a configured memory root. Supports the same tilde forms as the rest
 * of DSH (`~`, `~/`, `~\`) and resolves relative paths against the cwd.
 * @param root - configured root; defaults to `~/dsh/memories`.
 */
export function resolveMemoryRoot(root?: string): string {
  return resolve(expandHomePath(root ?? defaultMemoryRoot()))
}

/** Default local Ollama base URL. */
export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434'

/** Default local Ollama embedding model. */
export const DEFAULT_EMBEDDING_MODEL = 'nomic-embed-text'

/** A role kept in the conversational memory store. */
export type MemoryRole = 'user' | 'assistant'

/** One text span selected from a finished turn. */
export interface MemoryDraft {
  readonly role: MemoryRole
  readonly text: string
}

/** One durable vector record appended to a scope's memory file. */
export interface MemoryRecord {
  readonly id: string
  readonly scope: string
  readonly sessionId: string
  readonly turn: number
  readonly role: MemoryRole
  readonly text: string
  readonly embedding: number[]
  readonly model: string
  readonly createdAt: number
}

/** One semantic hit returned by a memory query. */
export interface MemorySearchHit {
  readonly id: string
  readonly text: string
  readonly role: MemoryRole
  readonly score: number
  readonly turn: number
  readonly sessionId: string
  readonly createdAt: number
}

export type MemorySearchOutcome =
  | {
      readonly ok: true
      readonly query: string
      readonly model: string
      readonly count: number
      readonly results: MemorySearchHit[]
    }
  | {
      readonly ok: false
      readonly code: string
      readonly message: string
    }

/** Small seam for tests and for non-Ollama embedding providers. */
export interface TextEmbedder {
  embed(texts: readonly string[], signal?: AbortSignal): Promise<number[][]>
}

/** The normalized absolute file holding one scope's records. */
export function memoryFileFor(root: string, scope: string): string {
  const normalized = scope.trim()
  const fileName = normalized.length === 0 ? 'memory-default.jsonl' : `memory-${encodeURIComponent(normalized)}.jsonl`
  return join(root, fileName)
}

function textOf(blocks: readonly ContentBlock[]): string {
  let result = ''
  for (const block of blocks) {
    if (block.type !== 'text') continue
    result = result.length === 0 ? block.text : `${result}\n${block.text}`
  }
  return result.trim()
}

/**
 * Extract the conversational core of one turn from the session log.
 *
 * Only direct human `user/message`s (`source.kind === 'user'`) and text blocks
 * of the model's `assistant/message`s are kept. Tool calls/results, system
 * prompts, injected context, chunks, and boundary events are intentionally
 * skipped.
 */
export function extractTurnConversation(events: readonly SessionEvent[], turn: number): MemoryDraft[] {
  let turnEnd = -1
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'turn/end' && event.data.turn === turn) {
      turnEnd = index
      break
    }
  }
  if (turnEnd === -1) return []

  let turnStart = -1
  for (let index = turnEnd - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'turn/start' && event.data.turn === turn) {
      turnStart = index
      break
    }
  }
  if (turnStart === -1 || turnStart >= turnEnd) return []

  const drafts: MemoryDraft[] = []
  for (let index = turnStart + 1; index < turnEnd; index += 1) {
    const event = events[index]
    if (event === undefined) continue
    if (event.type === 'user/message') {
      if (event.data.source.kind !== 'user') continue
      const text = textOf(event.data.content)
      if (text.length > 0) drafts.push({ role: 'user', text })
      continue
    }
    if (event.type === 'assistant/message') {
      if (event.data.turn !== turn) continue
      const text = textOf(event.data.message.content)
      if (text.length > 0) drafts.push({ role: 'assistant', text })
    }
  }
  return drafts
}

/** The newest `agent-preset/selected` wins; otherwise the creation header. */
export function presetForSession(session: Pick<Session, 'events' | 'header'>): string | undefined {
  for (let index = session.events.length - 1; index >= 0; index -= 1) {
    const event = session.events[index]
    if (event?.type !== 'agent-preset/selected') continue
    const data = event.data
    if (typeof data === 'object' && data !== null && 'agentPreset' in data
      && typeof data.agentPreset === 'string') {
      return data.agentPreset
    }
  }
  return session.header.agentPreset
}

/** The memory scope is the session's live agent preset. */
export function memoryScopeForSession(session: Pick<Session, 'events' | 'header'>): string {
  return presetForSession(session)?.trim() || 'default'
}

/** Whether a session opts into memory with the configured preset-id prefix. */
export function shouldRememberSession(
  session: Pick<Session, 'events' | 'header'>,
  prefix: string,
): boolean {
  if (prefix.trim().length === 0) return true
  const preset = presetForSession(session)
  return preset !== undefined && preset.startsWith(prefix)
}

function isFiniteVector(value: unknown): value is number[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every(item => typeof item === 'number' && Number.isFinite(item))
}

function isMemoryRecord(value: unknown): value is MemoryRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'string'
    && typeof record.scope === 'string'
    && typeof record.sessionId === 'string'
    && typeof record.turn === 'number' && Number.isSafeInteger(record.turn)
    && (record.role === 'user' || record.role === 'assistant')
    && typeof record.text === 'string'
    && isFiniteVector(record.embedding)
    && typeof record.model === 'string'
    && typeof record.createdAt === 'number' && Number.isSafeInteger(record.createdAt)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function cosineSimilarity(left: number[], right: number[]): number {
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0
    const b = right[index] ?? 0
    dot += a * b
    leftNorm += a * a
    rightNorm += b * b
  }
  if (leftNorm === 0 || rightNorm === 0) return 0
  return dot / Math.sqrt(leftNorm * rightNorm)
}

export interface MemoryStoreOptions {
  /** Absolute memory root; use {@link resolveMemoryRoot} for configured paths. */
  readonly root: string
  /** Ollama embedding model used for new records and for queries. */
  readonly embeddingModel: string
  /** Embedding transport. */
  readonly embedder: TextEmbedder
  /** Optional diagnostics sink (malformed JSONL lines, queue failures). */
  readonly onWarn?: (message: string) => void
}

/**
 * Append-only vector memory. Writes to one scope's file are serialized so the
 * turn listener and a concurrent `memory_search` never observe a torn line.
 */
export class MemoryStore {
  readonly #root: string
  readonly #embeddingModel: string
  readonly #embedder: TextEmbedder
  readonly #onWarn: ((message: string) => void) | undefined
  readonly #queues = new Map<string, Promise<void>>()

  constructor(options: MemoryStoreOptions) {
    this.#root = options.root
    this.#embeddingModel = options.embeddingModel
    this.#embedder = options.embedder
    this.#onWarn = options.onWarn
  }

  /** Serialize one operation per scope file and settle the map with a non-rejecting tail. */
  #enqueue<T>(scope: string, task: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(scope) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(task)
    this.#queues.set(scope, run.then(() => undefined, () => undefined))
    return run
  }

  /** Await any already-enqueued write for a scope (failures included). */
  #settle(scope: string): Promise<void> {
    return this.#queues.get(scope)?.catch(() => undefined) ?? Promise.resolve()
  }

  async #append(scope: string, records: readonly MemoryRecord[]): Promise<void> {
    if (records.length === 0) return
    await this.#enqueue(scope, async () => {
      await mkdir(this.#root, { recursive: true })
      const file = memoryFileFor(this.#root, scope)
      const body = records.map(record => `${JSON.stringify(record)}\n`).join('')
      await appendFile(file, body, 'utf8')
    })
  }

  /**
   * Embed and append one finished turn's selected conversational text.
   * @returns the records that were durably appended.
   */
  async remember(
    scope: string,
    sessionId: string,
    turn: number,
    drafts: readonly MemoryDraft[],
  ): Promise<MemoryRecord[]> {
    const clean: Array<{ role: MemoryRole; text: string }> = []
    for (const draft of drafts) {
      const text = draft.text.trim()
      if (text.length > 0) clean.push({ role: draft.role, text })
    }
    if (clean.length === 0) return []

    const embeddings = await this.#embedder.embed(clean.map(draft => draft.text))
    if (embeddings.length !== clean.length) {
      throw new Error(`embedding model "${this.#embeddingModel}" returned ${embeddings.length} vectors for ${clean.length} inputs`)
    }
    const now = Date.now()
    const records: MemoryRecord[] = clean.map((draft, index) => {
      const embedding = embeddings[index]
      if (!isFiniteVector(embedding)) {
        throw new Error(`embedding model "${this.#embeddingModel}" returned a non-finite vector at index ${index}`)
      }
      return {
        id: randomUUID(),
        scope,
        sessionId,
        turn,
        role: draft.role,
        text: draft.text,
        embedding,
        model: this.#embeddingModel,
        createdAt: now,
      }
    })
    await this.#append(scope, records)
    return records
  }

  async #read(scope: string): Promise<MemoryRecord[]> {
    await this.#settle(scope)
    const file = memoryFileFor(this.#root, scope)
    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }

    const records: MemoryRecord[] = []
    const lines = text.split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]?.trim()
      if (line === undefined || line.length === 0) continue
      try {
        const value: unknown = JSON.parse(line)
        if (isMemoryRecord(value)) records.push(value)
        else this.#warn(`memory: malformed record skipped at ${file}:${index + 1}`)
      } catch {
        this.#warn(`memory: unparsable JSON line skipped at ${file}:${index + 1}`)
      }
    }
    return records
  }

  #warn(message: string): void {
    this.#onWarn?.(message)
  }

  /**
   * Embed a query with the same Ollama model and return the top semantic
   * matches for one scope.
   */
  async search(
    scope: string,
    query: string,
    limit = 5,
    signal?: AbortSignal,
  ): Promise<MemorySearchOutcome> {
    const normalizedQuery = query.trim()
    if (normalizedQuery.length === 0) {
      return { ok: false, code: 'invalid_query', message: 'memory_search query must be non-empty.' }
    }
    if (!Number.isSafeInteger(limit) || limit < 1) {
      return { ok: false, code: 'invalid_limit', message: 'memory_search limit must be a positive safe integer.' }
    }

    let queryVector: number[]
    try {
      const vectors = await this.#embedder.embed([normalizedQuery], signal)
      const first = vectors[0]
      if (!isFiniteVector(first)) {
        throw new Error(`embedding model "${this.#embeddingModel}" returned a non-finite query vector`)
      }
      queryVector = first
    } catch (error: unknown) {
      if (isAbortError(error) || signal?.aborted === true) {
        return { ok: false, code: 'aborted', message: 'memory_search was cancelled.' }
      }
      return { ok: false, code: 'embedding_failed', message: errorMessage(error) }
    }

    let records: MemoryRecord[]
    try {
      records = await this.#read(scope)
    } catch (error: unknown) {
      return { ok: false, code: 'memory_read_failed', message: errorMessage(error) }
    }

    if (records.length === 0) {
      return { ok: true, query: normalizedQuery, model: this.#embeddingModel, count: 0, results: [] }
    }

    const compatible = records.filter(record => record.embedding.length === queryVector.length)
    if (compatible.length === 0) {
      const stored = [...new Set(records.map(record => record.embedding.length))].join(', ')
      return {
        ok: false,
        code: 'embedding_dimension_mismatch',
        message: `Stored vectors have dimension(s) ${stored}, but model "${this.#embeddingModel}" returned ${queryVector.length}. Use the same embedding model for search and ingestion.`,
      }
    }

    const scored = compatible.map(record => ({
      id: record.id,
      text: record.text,
      role: record.role,
      score: cosineSimilarity(queryVector, record.embedding),
      turn: record.turn,
      sessionId: record.sessionId,
      createdAt: record.createdAt,
    }))
    scored.sort((left, right) => right.score - left.score || right.createdAt - left.createdAt)
    const results = scored.slice(0, Math.min(limit, scored.length))
    return {
      ok: true,
      query: normalizedQuery,
      model: this.#embeddingModel,
      count: results.length,
      results,
    }
  }

  /** Exposed for tests and diagnostics: read one scope without embedding. */
  async records(scope: string): Promise<MemoryRecord[]> {
    return this.#read(scope)
  }
}
