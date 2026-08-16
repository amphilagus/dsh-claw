import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const exampleDir = join(dirname(fileURLToPath(import.meta.url)), '../../examples/claw-personal')
const composition = readFileSync(join(exampleDir, 'agent.cordis.yml'), 'utf8')

describe('claw-personal example preset', () => {
  it('keeps plan-mode behind an isolate realm so the roster will mount it', () => {
    expect(composition).toMatch(/isolate:\s*\n\s+planMode: true/)
    expect(composition).not.toMatch(/^- id: plan-mode$/m)
  })

  it('does not remount the host-plane dsh-claw bundle', () => {
    expect(composition).not.toMatch(/name:\s*'@deepseek-ai\/dsh-claw/)
  })

  it('splices {{claw_home}} into the persona, not a runtime-context row', () => {
    expect(composition).toMatch(/\{\{claw_home\}\}/)
    expect(composition).not.toMatch(/systemPrompt\.context|name:\s*claw:home/)
  })
})
