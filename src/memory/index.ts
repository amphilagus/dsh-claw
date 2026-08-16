/**
 * Claw-memory plugin: selective turn-by-turn conversational memory for
 * claw agents. The turn listener extracts only direct user input and the
 * model's visible text output, embeds it with a local Ollama model, and
 * appends JSONL vector records under `$DSH_HOME/memories`. The `memory_search` tool
 * reads the same store through Ollama.
 * @module @deepseek-ai/dsh-claw/memory
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import {
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_OLLAMA_URL,
  MemoryStore,
  extractTurnConversation,
  memoryScopeForSession,
  resolveMemoryRoot,
  shouldRememberSession,
} from './memory.ts'
import { OllamaEmbedder } from './ollama.ts'
import { registerMemorySearchTool } from './tools.ts'

export {
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_OLLAMA_URL,
  MemoryStore,
  defaultMemoryRoot,
  extractTurnConversation,
  memoryFileFor,
  memoryScopeForSession,
  presetForSession,
  resolveMemoryRoot,
  shouldRememberSession,
} from './memory.ts'
export type {
  MemoryDraft,
  MemoryRecord,
  MemoryRole,
  MemorySearchHit,
  MemorySearchOutcome,
  MemoryStoreOptions,
  TextEmbedder,
} from './memory.ts'
export { OllamaEmbedder } from './ollama.ts'
export { registerMemorySearchTool } from './tools.ts'

/** Cordis function-plugin name. */
export const name = 'claw-memory'
/** Services required before the listener and per-agent tool can register. */
export const inject = ['agents', 'tools']

export interface Config {
  /** Memory root directory. Defaults to `$DSH_HOME/memories` (`~/.dsh/memories`). */
  root?: string
  /** Local Ollama base URL. Defaults to `http://127.0.0.1:11434`. */
  ollamaUrl?: string
  /** Ollama embedding model used for writes and searches. Defaults to `nomic-embed-text`. */
  embeddingModel?: string
  /** Preset-id prefix whose sessions are remembered. Defaults to `claw`; use `''` for all sessions. */
  prefix?: string
  /** Skip draft texts shorter than this many characters. Defaults to 1. */
  minChars?: number
  /** Milliseconds before one Ollama request is aborted. Defaults to 60000. */
  timeoutMs?: number
  /** Set to false to disable automatic turn ingestion without unloading the tool. */
  enabled?: boolean
}

/**
 * Install turn ingestion and `memory_search` only for root agents whose live
 * preset matches `prefix` (like claw-home's `claw*` gate). Blank `standard`
 * sessions that later select a matching preset are adopted through
 * `agent-preset/selected`. Turn ingestion is fire-and-forget: the hot session
 * append path is never blocked on Ollama or disk I/O.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const root = resolveMemoryRoot(config.root)
  const prefix = config.prefix ?? 'claw'
  const embeddingModel = config.embeddingModel ?? DEFAULT_EMBEDDING_MODEL
  const minChars = config.minChars ?? 1
  const store = new MemoryStore({
    root,
    embeddingModel,
    embedder: new OllamaEmbedder({
      baseUrl: config.ollamaUrl ?? DEFAULT_OLLAMA_URL,
      model: embeddingModel,
      ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
    }),
    onWarn: message => ctx.logger.warn(message),
  })
  const toolOwners = new WeakSet<Agent>()

  const installTool = (agent: Agent): void => {
    if (toolOwners.has(agent)
      || !ctx.agents.roots().includes(agent)
      || !shouldRememberSession(agent.session, prefix)) return
    toolOwners.add(agent)
    agent.ctx.effect(() => {
      const dispose = registerMemorySearchTool(agent.ctx, agent, store)
      return dispose
    }, 'claw-memory.memory_search()')
  }

  ctx.effect(() => {
    const stopCreated = ctx.on('agent/created', ({ agent }) => {
      installTool(agent)
    })
    const stopSessionEvents = ctx.on('session/event', (session, event) => {
      // The Web picker switches a blank session after publication: the header
      // stays `standard` while the live preset arrives as a logged
      // `agent-preset/selected`. Adopt it exactly like claw-home does.
      if (event.type === 'agent-preset/selected') {
        if (!shouldRememberSession(session, prefix)) return
        const agent = ctx.agents.get(session.id)
        if (agent !== undefined) installTool(agent)
        return
      }

      if (event.type === 'turn/end' && config.enabled !== false && shouldRememberSession(session, prefix)) {
        const drafts = extractTurnConversation(session.events, event.data.turn)
          .filter(draft => draft.text.length >= minChars)
        if (drafts.length === 0) return
        const scope = memoryScopeForSession(session)
        void store.remember(scope, session.id, event.data.turn, drafts).catch((error: unknown) => {
          ctx.logger.warn(`claw-memory: failed to remember session "${session.id}" turn ${event.data.turn}: ${
            error instanceof Error ? error.message : String(error)
          }`)
        })
      }
    })
    return () => {
      stopCreated()
      stopSessionEvents()
    }
  }, 'claw-memory.lifecycle()')
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'agent-preset/selected': { agentPreset: string }
  }
}
