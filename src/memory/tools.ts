/**
 * The `memory_search` tool: semantic retrieval over the current agent's
 * JSONL vector memory.
 * @module @deepseek-ai/dsh-claw/memory/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import { memoryScopeForSession, type MemorySearchOutcome, type MemoryStore } from './memory.ts'

const SEARCH_DESCRIPTION =
  'Search the persistent semantic memory of the current agent. The query is embedded locally '
  + '(Ollama) and matched by cosine similarity against remembered user and assistant conversation '
  + 'text from previous turns. Use this to recall preferences, facts, decisions, and past context '
  + 'without re-reading session logs.'

const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    text: { type: 'string', required: true },
    role: { type: 'string', required: true, enum: ['user', 'assistant'] },
    score: { type: 'number', required: true },
    turn: { type: 'integer', required: true },
    sessionId: { type: 'string', required: true },
    createdAt: { type: 'integer', required: true },
  },
} as const

const SUCCESS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true, const: true },
    query: { type: 'string', required: true },
    model: { type: 'string', required: true },
    count: { type: 'integer', required: true },
    results: { type: 'array', required: true, items: RESULT_SCHEMA },
  },
} as const

const ERROR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true, const: false },
    code: { type: 'string', required: true },
    message: { type: 'string', required: true },
  },
} as const

const SEARCH_OUTPUT_SCHEMA = { oneOf: [SUCCESS_SCHEMA, ERROR_SCHEMA] } as const

/** Deterministic model-facing projection: the whole structured outcome as JSON. */
function renderSearchValue(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

/** Stable pending card for the UI. */
function presentSearchCall(query: string): GenericCallView {
  return { card: 'generic', title: 'Search memory', kind: 'read', rawInput: query }
}

function internalError(): Extract<MemorySearchOutcome, { ok: false }> {
  return { ok: false, code: 'internal_error', message: 'The memory search operation failed.' }
}

function validateLimit(value: number | undefined): Extract<MemorySearchOutcome, { ok: false }> | number {
  if (value === undefined) return 5
  if (!Number.isSafeInteger(value) || value < 1 || value > 50) {
    return { ok: false, code: 'invalid_limit', message: 'limit must be an integer between 1 and 50.' }
  }
  return value
}

/**
 * Register `memory_search` in one exact agent scope.
 * @param toolCtx - the agent-scoped context receiving the tool.
 * @param agent - the exact owner; the tool refuses calls routed to another agent.
 * @param store - the vector store shared by the listener and this tool.
 * @returns the idempotent registration disposer.
 */
export function registerMemorySearchTool(toolCtx: Context, agent: Agent, store: MemoryStore): () => void {
  return toolCtx.tools.register(defineTool({
    name: 'memory_search',
    description: SEARCH_DESCRIPTION,
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: 'Natural-language question or phrase to search for in past conversation memory.',
      },
      limit: {
        type: 'integer',
        description: 'Maximum number of results to return, between 1 and 50. Defaults to 5.',
      },
    },
    output: { schema: SEARCH_OUTPUT_SCHEMA, render: renderSearchValue },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (exec.agent !== agent) return internalError()
      const limit = validateLimit(args.limit)
      if (typeof limit !== 'number') return limit
      return store.search(memoryScopeForSession(agent.session), args.query, limit, exec.signal)
    },
    presentCall: args => presentSearchCall(args.query),
  }))
}
