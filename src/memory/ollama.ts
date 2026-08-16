/**
 * Local Ollama embedding transport (`/api/embed`, with a legacy
 * `/api/embeddings` fallback for older Ollama installations).
 * @module @deepseek-ai/dsh-claw/memory/ollama
 */

import { DEFAULT_EMBEDDING_MODEL, DEFAULT_OLLAMA_URL, type TextEmbedder } from './memory.ts'

export interface OllamaEmbedderOptions {
  /** Ollama HTTP base URL, without a trailing slash. */
  readonly baseUrl?: string
  /** Embedding model tag. */
  readonly model?: string
  /** Request timeout in milliseconds. */
  readonly timeoutMs?: number
}

interface OllamaEmbedResponse {
  embeddings?: unknown
}

interface OllamaLegacyEmbeddingResponse {
  embedding?: unknown
}

function isFiniteVector(value: unknown): value is number[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every(item => typeof item === 'number' && Number.isFinite(item))
}

function timeoutSignal(timeoutMs: number, signal?: AbortSignal): { signal: AbortSignal; clear(): void } {
  if (signal?.aborted === true) return { signal, clear: () => {} }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`Ollama request timed out after ${timeoutMs} ms`)), timeoutMs)
  const onAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    },
  }
}

/**
 * Embed texts through a local Ollama server.
 *
 * The modern `/api/embed` endpoint accepts a string or an array of strings;
 * this client always sends an array so one turn is embedded in one request.
 */
export class OllamaEmbedder implements TextEmbedder {
  readonly #baseUrl: string
  readonly #model: string
  readonly #timeoutMs: number

  constructor(options: OllamaEmbedderOptions = {}) {
    this.#baseUrl = (options.baseUrl ?? DEFAULT_OLLAMA_URL).replace(/\/+$/, '')
    this.#model = options.model ?? DEFAULT_EMBEDDING_MODEL
    this.#timeoutMs = options.timeoutMs ?? 60_000
  }

  async embed(texts: readonly string[], signal?: AbortSignal): Promise<number[][]> {
    if (texts.length === 0) return []
    const batch = this.#timeoutSignal(signal)
    try {
      try {
        return await this.#embedBatch(texts, batch.signal)
      } catch (error: unknown) {
        if (!this.#isFallbackError(error)) throw error
        return await this.#embedLegacy(texts, batch.signal)
      }
    } finally {
      batch.clear()
    }
  }

  #timeoutSignal(signal?: AbortSignal): { signal: AbortSignal; clear(): void } {
    return timeoutSignal(this.#timeoutMs, signal)
  }

  async #embedBatch(texts: readonly string[], signal: AbortSignal): Promise<number[][]> {
    const response = await this.#request('/api/embed', {
      model: this.#model,
      input: texts,
    }, signal)
    const data = response as OllamaEmbedResponse
    if (!Array.isArray(data.embeddings) || data.embeddings.length !== texts.length
      || !data.embeddings.every(isFiniteVector)) {
      throw new Error('Ollama /api/embed returned an invalid or missing embeddings array')
    }
    return data.embeddings
  }

  async #embedLegacy(texts: readonly string[], signal: AbortSignal): Promise<number[][]> {
    const vectors: number[][] = []
    for (const text of texts) {
      signal.throwIfAborted()
      const data = await this.#request('/api/embeddings', {
        model: this.#model,
        prompt: text,
      }, signal) as OllamaLegacyEmbeddingResponse
      if (!isFiniteVector(data.embedding)) {
        throw new Error('Ollama /api/embeddings returned an invalid or missing embedding')
      }
      vectors.push(data.embedding)
    }
    return vectors
  }

  async #request(path: string, body: unknown, signal: AbortSignal): Promise<unknown> {
    let response: Response
    try {
      response = await fetch(`${this.#baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      })
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      throw new Error(`Cannot reach Ollama at ${this.#baseUrl}: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Ollama ${path} failed with HTTP ${response.status}${text.length > 0 ? `: ${text.slice(0, 200)}` : ''}`)
    }
    return response.json()
  }

  #isFallbackError(error: unknown): boolean {
    if (error instanceof Error && error.name === 'AbortError') return false
    if (error instanceof Error && /HTTP 404|missing embeddings/i.test(error.message)) return true
    return false
  }
}
