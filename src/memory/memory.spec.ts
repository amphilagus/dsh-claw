import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { CallId, createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import {
  MemoryStore,
  defaultMemoryRoot,
  extractTurnConversation,
  memoryFileFor,
  memoryScopeForSession,
  presetForSession,
  resolveMemoryRoot,
  shouldRememberSession,
  type TextEmbedder,
} from './memory.ts'

function makeSession(): Session {
  return Session.create(SessionId('unit-session'), [], {
    version: SESSION_FORMAT_VERSION,
    id: SessionId('unit-session'),
    createdAt: 0,
    agentPreset: 'claw-personal',
  })
}

function appendTurn(session: Session): void {
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    source: { kind: 'user' },
    content: [{ type: 'text', text: '  What is my favorite color?  ' }],
  }), { surfaceOp: 'append' })
  session.append('user/message', createUserMessage({
    source: { kind: 'plugin', plugin: 'test' },
    content: [{ type: 'text', text: 'INJECTED CONTEXT THAT MUST BE IGNORED' }],
  }), { surfaceOp: 'append' })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      source: { provider: 'test', model: 'test' },
      content: [
        { type: 'text', text: 'Your favorite color is teal.' },
        { type: 'tool-call', id: CallId('call-1'), name: 'memory_search', arguments: '{}' },
      ],
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [] })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
}

describe('extractTurnConversation', () => {
  it('keeps only direct user text and visible assistant text', () => {
    const session = makeSession()
    appendTurn(session)
    const drafts = extractTurnConversation(session.events, 1)
    expect(drafts).toEqual([
      { role: 'user', text: 'What is my favorite color?' },
      { role: 'assistant', text: 'Your favorite color is teal.' },
    ])
  })

  it('returns nothing for an unknown or incomplete turn', () => {
    const session = makeSession()
    session.append('turn/start', { turn: 7 })
    session.append('user/message', createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'unfinished' }],
    }), { surfaceOp: 'append' })
    expect(extractTurnConversation(session.events, 7)).toEqual([])
    expect(extractTurnConversation(session.events, 99)).toEqual([])
  })
})

describe('preset and scope helpers', () => {
  it('prefers the newest agent-preset/selected event over the header', () => {
    const session = makeSession()
    session.append('agent-preset/selected', { agentPreset: 'claw-other' })
    expect(presetForSession(session)).toBe('claw-other')
    expect(memoryScopeForSession(session)).toBe('claw-other')
  })

  it('matches the configured prefix and supports all sessions with an empty prefix', () => {
    expect(shouldRememberSession(makeSession(), 'claw')).toBe(true)
    expect(shouldRememberSession(makeSession(), 'standard')).toBe(false)
    expect(shouldRememberSession(makeSession(), '')).toBe(true)
  })
})

describe('memory roots and files', () => {
  it('defaults to $DSH_HOME/memories', () => {
    expect(defaultMemoryRoot({ DSH_HOME: '/custom' })).toBe(join('/custom', 'memories'))
    expect(defaultMemoryRoot({}).endsWith(join('.dsh', 'memories'))).toBe(true)
  })

  it('expands tilde and encodes scopes in file names', () => {
    expect(resolveMemoryRoot('~/.dsh/memories')).toBe(resolve(join(homedir(), '.dsh', 'memories')))
    expect(memoryFileFor('/root/memory', 'claw-personal')).toBe(join('/root/memory', 'memory-claw-personal.jsonl'))
    expect(memoryFileFor('/root/memory', 'a/b')).toBe(join('/root/memory', `memory-${encodeURIComponent('a/b')}.jsonl`))
  })
})

const STATIC_EMBEDDER: TextEmbedder = {
  async embed(texts) {
    return texts.map(text => text.includes('apples') ? [1, 1, 0] : [1, 0, 1])
  },
}

describe('MemoryStore', () => {
  it('embeds drafts, appends JSONL records, and searches by cosine similarity', async () => {
    const root = mkdtempSync(join(tmpdir(), 'claw-memory-store-'))
    const store = new MemoryStore({ root, embeddingModel: 'fake', embedder: STATIC_EMBEDDER })

    await store.remember('claw-personal', 'session-1', 1, [
      { role: 'user', text: 'I like apples' },
      { role: 'assistant', text: 'I will remember apples' },
    ])
    await store.remember('claw-personal', 'session-1', 2, [
      { role: 'user', text: 'I like oranges' },
    ])

    const file = memoryFileFor(root, 'claw-personal')
    const lines = readFileSync(file, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(3)

    const records = await store.records('claw-personal')
    expect(records.map(record => record.text)).toEqual(['I like apples', 'I will remember apples', 'I like oranges'])

    const outcome = await store.search('claw-personal', 'apples please', 2)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.count).toBe(2)
    expect(outcome.results[0]?.text).toBe('I like apples')
    expect(outcome.results[0]?.score).toBeGreaterThanOrEqual(outcome.results[1]!.score)
  })

  it('returns an empty success before any records exist', async () => {
    const root = mkdtempSync(join(tmpdir(), 'claw-memory-empty-'))
    const store = new MemoryStore({ root, embeddingModel: 'fake', embedder: STATIC_EMBEDDER })
    const outcome = await store.search('claw-personal', 'anything')
    expect(outcome).toEqual({ ok: true, query: 'anything', model: 'fake', count: 0, results: [] })
  })

  it('reports a dimension mismatch when the embedding model changed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'claw-memory-dim-'))
    const store = new MemoryStore({
      root,
      embeddingModel: 'fake',
      embedder: {
        async embed(texts) {
          return texts.map(text => text === 'query' ? [1, 0, 0] : [1, 0])
        },
      },
    })
    await store.remember('claw-personal', 'session-1', 1, [{ role: 'user', text: 'two dimensions' }])
    const outcome = await store.search('claw-personal', 'query')
    expect(outcome).toMatchObject({ ok: false, code: 'embedding_dimension_mismatch' })
  })

  it('skips malformed JSONL lines instead of failing the whole read', async () => {
    const root = mkdtempSync(join(tmpdir(), 'claw-memory-malformed-'))
    const store = new MemoryStore({ root, embeddingModel: 'fake', embedder: STATIC_EMBEDDER })
    const file = memoryFileFor(root, 'claw-personal')
    writeFileSync(file, '{broken\n', { encoding: 'utf8' })
    expect(await store.records('claw-personal')).toEqual([])
  })
})
