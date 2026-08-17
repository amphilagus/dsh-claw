import { existsSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { writableRoots } from '@deepseek-ai/dsh-sandbox'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import * as uvSandbox from './index.ts'

describe('uv-sandbox plugin', () => {
  it('has the Loader-safe function-plugin export shape', () => {
    expect('default' in uvSandbox).toBe(false)
    expect(uvSandbox.name).toBe('uv-sandbox')
    expect(uvSandbox.inject).toEqual(['sandboxPolicy'])
  })

  it('grants configured cache and data dirs under workspace-write and creates them', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'uv-ws-'))
    const uvRoot = mkdtempSync(join(tmpdir(), 'uv-sandbox-'))
    const cacheDir = join(uvRoot, 'cache')
    const dataDir = join(uvRoot, 'data')
    const ctx = new Context()
    await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: workspace })
    await ctx.plugin(uvSandbox, { cacheDir, dataDir })
    expect(existsSync(cacheDir)).toBe(true)
    expect(existsSync(dataDir)).toBe(true)
    const extras = [realpathSync.native(cacheDir), realpathSync.native(dataDir)]
    const policy = ctx.sandboxPolicy.resolve()
    expect(policy.extraWriteRoots).toEqual(extras)
    expect(writableRoots(policy)).toEqual(expect.arrayContaining(extras))
  })

  it('does not stamp extras under read-only', async () => {
    const root = mkdtempSync(join(tmpdir(), 'uv-sandbox-ro-'))
    const ctx = new Context()
    await ctx.plugin(SandboxPolicyService, { mode: 'read-only', workspaceRoot: root })
    await ctx.plugin(uvSandbox, { cacheDir: join(root, 'cache'), dataDir: join(root, 'data'), ensure: false })
    expect(ctx.sandboxPolicy.resolve().extraWriteRoots).toBeUndefined()
  })
})
