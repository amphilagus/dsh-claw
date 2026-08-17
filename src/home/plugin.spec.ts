import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { assembleContextFor } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { writableRoots } from '@deepseek-ai/dsh-sandbox'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import { SessionId } from '@deepseek-ai/dsh-session'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import * as clawHome from './index.ts'

async function harness(root: string, prefix?: string): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write' })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(clawHome, { root, ...prefix === undefined ? {} : { prefix } })
  return ctx
}

describe('claw-home plugin', () => {
  it('has the Loader-safe function-plugin export shape', () => {
    expect('default' in clawHome).toBe(false)
    expect(clawHome.name).toBe('claw-home')
    expect(clawHome.inject).toEqual(['agents', 'sandboxPolicy'])
  })

  it('creates the home at publication and resolves it per session', async () => {
    const root = mkdtempSync(join(tmpdir(), 'claw-home-plugin-'))
    const ctx = await harness(root)
    const handle = await ctx.agents.create({
      sessionId: SessionId('claw-session-1'),
      meta: { cwd: process.cwd(), agentPreset: 'claw-personal' },
    })
    expect(existsSync(join(root, 'claw-personal'))).toBe(true)
    expect(ctx.clawHome.homeForSession('claw-session-1')).toBe(join(root, 'claw-personal'))
    expect(ctx.clawHome.homeForPreset('claw-personal')).toBe(join(root, 'claw-personal'))
    expect(ctx.clawHome.homeForPreset('standard')).toBeUndefined()
    expect(ctx.clawHome.homeForSession('untracked')).toBeUndefined()

    await handle.dispose()
    expect(ctx.clawHome.homeForSession('claw-session-1')).toBeUndefined()
  })

  it('grants the claw home as an extra writable root for workspace-write', async () => {
    const root = mkdtempSync(join(tmpdir(), 'claw-home-plugin-'))
    const ctx = await harness(root)
    const handle = await ctx.agents.create({
      sessionId: SessionId('claw-grant-session'),
      meta: { cwd: process.cwd(), agentPreset: 'claw-personal' },
    })
    const home = realpathSync.native(join(root, 'claw-personal'))
    const policy = ctx.sandboxPolicy.resolve({ session: handle.agent.session })
    expect(policy.extraWriteRoots).toEqual([home])
    expect(writableRoots(policy)).toContain(home)

    const plain = await ctx.agents.create({
      sessionId: SessionId('plain-grant-session'),
      meta: { cwd: process.cwd(), agentPreset: 'standard' },
    })
    expect(ctx.sandboxPolicy.resolve({ session: plain.agent.session }).extraWriteRoots).toBeUndefined()
    await handle.dispose()
  })

  it('ignores non-claw presets', async () => {
    const root = mkdtempSync(join(tmpdir(), 'claw-home-plugin-'))
    const ctx = await harness(root)
    await ctx.agents.create({
      sessionId: SessionId('plain-session'),
      meta: { cwd: process.cwd(), agentPreset: 'standard' },
    })
    expect(existsSync(join(root, 'standard'))).toBe(false)
    expect(ctx.clawHome.homeForSession('plain-session')).toBeUndefined()
  })

  it('honors a custom prefix from config', async () => {
    const root = mkdtempSync(join(tmpdir(), 'claw-home-plugin-'))
    const ctx = await harness(root, 'lobster')
    const handle = await ctx.agents.create({
      sessionId: SessionId('lobster-session'),
      meta: { cwd: process.cwd(), agentPreset: 'lobster-personal' },
    })
    expect(existsSync(join(root, 'lobster-personal'))).toBe(true)
    expect(ctx.clawHome.homeForSession('lobster-session')).toBe(join(root, 'lobster-personal'))
    await handle.dispose()
  })

  it('adopts a claw preset switched onto a session that started as standard', async () => {
    const root = mkdtempSync(join(tmpdir(), 'claw-home-plugin-'))
    const ctx = await harness(root)
    const handle = await ctx.agents.create({
      sessionId: SessionId('switched-session'),
      meta: { cwd: process.cwd(), agentPreset: 'standard' },
    })
    expect(existsSync(join(root, 'claw-personal'))).toBe(false)
    expect(ctx.clawHome.homeForSession('switched-session')).toBeUndefined()

    handle.agent.session.append('agent-preset/selected', { agentPreset: 'claw-personal' })
    expect(existsSync(join(root, 'claw-personal'))).toBe(true)
    expect(ctx.clawHome.homeForSession('switched-session')).toBe(join(root, 'claw-personal'))
    await handle.dispose()
  })

  it('publishes claw_home as a persona variable from the live selection', async () => {
    const root = mkdtempSync(join(tmpdir(), 'claw-home-plugin-'))
    const ctx = await harness(root)
    const handle = await ctx.agents.create({
      sessionId: SessionId('prompt-session'),
      meta: { cwd: process.cwd(), agentPreset: 'standard' },
    })
    const before = await ctx.systemPrompt.assemble(assembleContextFor(handle.agent))
    expect(before.variables.claw_home).toBeUndefined()
    expect(before.contexts.find(item => item.name === 'claw:home')).toBeUndefined()

    handle.agent.session.append('agent-preset/selected', { agentPreset: 'claw-personal' })
    ctx.systemPrompt.section({
      name: 'claw-persona-probe',
      order: 50,
      text: clawHome.clawHomePersonaLine(),
    })
    const after = await ctx.systemPrompt.assemble(assembleContextFor(handle.agent))
    expect(after.variables.claw_home).toBe(join(root, 'claw-personal'))
    expect(renderPrompt(after)).toContain(join(root, 'claw-personal'))
    expect(after.contexts.find(item => item.name === 'claw:home')).toBeUndefined()
    await handle.dispose()
  })
})
