import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clawHomeFor, defaultClawRoot, ensureClawHome, isClawPreset, presetFromSession } from './home.ts'

describe('isClawPreset', () => {
  it('accepts claw-prefixed presets', () => {
    expect(isClawPreset('claw-personal')).toBe(true)
    expect(isClawPreset('claw')).toBe(true)
    expect(isClawPreset('claw-1')).toBe(true)
  })

  it('rejects non-claw presets and missing presets', () => {
    expect(isClawPreset('standard')).toBe(false)
    expect(isClawPreset('crawfish')).toBe(false)
    expect(isClawPreset(undefined)).toBe(false)
  })

  it('honors a custom prefix', () => {
    expect(isClawPreset('lobster-1', 'lobster')).toBe(true)
    expect(isClawPreset('claw-1', 'lobster')).toBe(false)
  })
})

describe('clawHomeFor', () => {
  it('joins the root and preset id', () => {
    expect(clawHomeFor('claw-personal', '/x')).toBe(join('/x', 'claw-personal'))
  })
})

describe('defaultClawRoot', () => {
  it('resolves under DSH_HOME when set', () => {
    expect(defaultClawRoot({ DSH_HOME: '/custom' })).toBe(join('/custom', 'claw'))
  })

  it('resolves under the OS home default otherwise', () => {
    expect(defaultClawRoot({}).endsWith(join('.dsh', 'claw'))).toBe(true)
  })
})

describe('presetFromSession', () => {
  it('reads the creation header when nothing was selected later', () => {
    expect(presetFromSession({ header: { agentPreset: 'standard' }, events: [] })).toBe('standard')
  })

  it('lets a later selection win over the frozen header', () => {
    expect(presetFromSession({
      header: { agentPreset: 'standard' },
      events: [{ type: 'agent-preset/selected', data: { agentPreset: 'claw-personal' } }],
    })).toBe('claw-personal')
  })

  it('uses the newest selection', () => {
    expect(presetFromSession({
      header: { agentPreset: 'standard' },
      events: [
        { type: 'agent-preset/selected', data: { agentPreset: 'claw-personal' } },
        { type: 'user/message', data: {} },
        { type: 'agent-preset/selected', data: { agentPreset: 'claw-other' } },
      ],
    })).toBe('claw-other')
  })
})

describe('ensureClawHome', () => {
  it('creates the home directory and returns its path', () => {
    const root = mkdtempSync(join(tmpdir(), 'claw-home-'))
    const home = ensureClawHome('claw-personal', root)
    expect(home).toBe(join(root, 'claw-personal'))
    expect(existsSync(home)).toBe(true)
  })

  it('is idempotent for the same home', () => {
    const root = mkdtempSync(join(tmpdir(), 'claw-home-'))
    expect(ensureClawHome('claw-personal', root)).toBe(ensureClawHome('claw-personal', root))
  })
})
