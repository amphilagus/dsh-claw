import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { CallId, createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import * as clawMemory from './index.ts'
import { memoryFileFor } from './memory.ts'

interface FakeOllama {
  readonly url: string
  close(): Promise<void>
}

function vectorFor(text: string): number[] {
  const normalized = text.toLowerCase()
  if (normalized === 'favorite color') return [1, 0, 0]
  if (normalized.includes('teal')) return [1, 0.1, 0]
  if (normalized.includes('what is my favorite')) return [0.5, 1, 0]
  return [0, 1, 0]
}

async function startFakeOllama(): Promise<FakeOllama> {
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { input?: unknown; prompt?: unknown }
      const texts = Array.isArray(body.input)
        ? body.input.map(item => String(item))
        : [typeof body.input === 'string' ? body.input : String(body.prompt ?? '')]
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ model: 'fake-embed', embeddings: texts.map(vectorFor) }))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('fake Ollama did not bind')
  return {
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => {
        server.close(error => error === undefined ? resolve() : reject(error))
      })
    },
  }
}

async function harness(root: string, ollamaUrl: string): Promise<{ ctx: Context; dispose(): Promise<void> }> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(clawMemory, {
    root,
    ollamaUrl,
    embeddingModel: 'fake-embed',
    prefix: 'claw',
  })
  return {
    ctx,
    async dispose() {
      await ctx.fiber.dispose()
    },
  }
}

function appendTurn(session: import('@deepseek-ai/dsh-session').Session, turn: number): void {
  session.append('turn/start', { turn })
  session.append('user/message', createUserMessage({
    source: { kind: 'user' },
    content: [{ type: 'text', text: 'What is my favorite color?' }],
  }), { surfaceOp: 'append' })
  session.append('user/message', createUserMessage({
    source: { kind: 'plugin', plugin: 'probe' },
    content: [{ type: 'text', text: 'PLUGIN CONTEXT MUST NOT BE STORED' }],
  }), { surfaceOp: 'append' })
  session.append('step/start', { turn, step: 1 })
  session.append('assistant/message', {
    turn,
    step: 1,
    message: createAssistantMessage({
      source: { provider: 'fake', model: 'fake' },
      content: [
        { type: 'text', text: 'Your favorite color is teal.' },
        { type: 'tool-call', id: CallId(`call-${turn}`), name: 'probe', arguments: '{}' },
      ],
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [] })
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

describe('claw-memory plugin', () => {
  it('has the Loader-safe function-plugin export shape', () => {
    expect('default' in clawMemory).toBe(false)
    expect(clawMemory.name).toBe('claw-memory')
    expect(clawMemory.inject).toEqual(['agents', 'tools'])
  })

  it('ingests a finished claw turn and exposes memory_search on the agent', async () => {
    const ollama = await startFakeOllama()
    const root = mkdtempSync(join(tmpdir(), 'claw-memory-plugin-'))
    const harnessed = await harness(root, ollama.url)
    try {
      const handle = await harnessed.ctx.agents.create({
        sessionId: SessionId('claw-memory-session'),
        meta: { cwd: process.cwd(), agentPreset: 'claw-personal' },
      })

      appendTurn(handle.agent.session, 1)

      const file = memoryFileFor(root, 'claw-personal')
      await vi.waitFor(() => {
        expect(existsSync(file)).toBe(true)
        const records = readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line))
        expect(records).toHaveLength(2)
      })

      const records = readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line)) as Array<{
        role: string
        text: string
        model: string
        turn: number
      }>
      expect(records.map(record => [record.role, record.text])).toEqual([
        ['user', 'What is my favorite color?'],
        ['assistant', 'Your favorite color is teal.'],
      ])
      expect(records.every(record => record.model === 'fake-embed' && record.turn === 1)).toBe(true)

      const result = await harnessed.ctx.tools.execute({
        callId: CallId('search-call'),
        name: 'memory_search',
        arguments: { query: 'favorite color', limit: 1 },
        agent: handle.agent,
        signal: new AbortController().signal,
      })
      expect(result.isError).toBe(false)
      const textBlock = result.content.find(block => block.type === 'text')
      expect(textBlock).toBeDefined()
      const outcome = JSON.parse(textBlock!.text) as { ok: boolean; count: number; results: Array<{ role: string; text: string }> }
      expect(outcome.ok).toBe(true)
      expect(outcome.count).toBe(1)
      expect(outcome.results[0]).toMatchObject({ role: 'assistant', text: 'Your favorite color is teal.' })

      await handle.dispose()
    } finally {
      await harnessed.dispose()
      await ollama.close()
    }
  })

  it('does not activate non-claw sessions and adopts a later claw preset switch', async () => {
    const ollama = await startFakeOllama()
    const root = mkdtempSync(join(tmpdir(), 'claw-memory-plugin-skip-'))
    const harnessed = await harness(root, ollama.url)
    try {
      const handle = await harnessed.ctx.agents.create({
        sessionId: SessionId('standard-session'),
        meta: { cwd: process.cwd(), agentPreset: 'standard' },
      })

      expect(harnessed.ctx.tools.get('memory_search', handle.agent)).toBeUndefined()
      appendTurn(handle.agent.session, 1)
      await new Promise(resolve => setTimeout(resolve, 150))
      expect(existsSync(memoryFileFor(root, 'standard'))).toBe(false)

      handle.agent.session.append('agent-preset/selected', { agentPreset: 'claw-personal' })
      await vi.waitFor(() => {
        expect(harnessed.ctx.tools.get('memory_search', handle.agent)).toBeDefined()
      })

      appendTurn(handle.agent.session, 2)
      const file = memoryFileFor(root, 'claw-personal')
      await vi.waitFor(() => {
        expect(existsSync(file)).toBe(true)
        const records = readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line))
        expect(records).toHaveLength(2)
      })

      await handle.dispose()
    } finally {
      await harnessed.dispose()
      await ollama.close()
    }
  })
})
