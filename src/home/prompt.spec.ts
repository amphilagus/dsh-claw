import { describe, expect, it } from 'vitest'
import { CLAW_HOME_VARIABLE, clawHomePersonaLine, renderClawHomePrompt } from './prompt.ts'

describe('claw-home persona line', () => {
  it('names the home through the persona variable, not a runtime snapshot', () => {
    expect(CLAW_HOME_VARIABLE).toBe('claw_home')
    expect(clawHomePersonaLine()).toContain('{{claw_home}}')
    expect(clawHomePersonaLine()).toContain('bash')
    expect(clawHomePersonaLine()).toContain('private assets')
  })

  it('renders the persona sentence with a concrete home path', () => {
    const text = renderClawHomePrompt('/Users/me/.dsh/claw/claw-personal')
    expect(text).toContain('/Users/me/.dsh/claw/claw-personal')
    expect(text).not.toContain('{{')
  })
})
