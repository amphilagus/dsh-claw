/**
 * Claw-home plugin: per-agent personal home directories for claw-* presets.
 * @module @deepseek-ai/dsh-claw/home
 */

import type { Context } from '@deepseek-ai/cordis'
// Side-effect type imports: pull the agent event declarations and the
// systemPrompt / sandboxPolicy service types into this program.
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { clawHomeFor, defaultClawRoot, ensureClawHome, isClawPreset, presetFromSession } from './home.ts'
import { CLAW_HOME_VARIABLE } from './prompt.ts'
import { ClawHomeServiceImpl, type ClawHomeService } from './service.ts'

export { clawHomeFor, defaultClawRoot, ensureClawHome, isClawPreset, presetFromSession } from './home.ts'
export type { PresetBearingSession } from './home.ts'
export { CLAW_HOME_VARIABLE, clawHomePersonaLine, renderClawHomePrompt } from './prompt.ts'
export { ClawHomeServiceImpl } from './service.ts'
export type { ClawHomeService } from './service.ts'

/** Cordis function-plugin name. */
export const name = 'claw-home'
/** Services required before claw agents can receive homes and extra write roots. */
export const inject = ['agents', 'sandboxPolicy']

export interface Config {
  /** Root directory holding one home per claw-* preset. Defaults to `$DSH_HOME/claw`. */
  root?: string
  /** Preset-id prefix that opts an agent into a personal home. Defaults to `claw`. */
  prefix?: string
}

/**
 * Install claw-home for agents published after this plugin loads: create the
 * home directory when a claw preset is joined (at publication or on a later
 * blank-session switch), publish `{{claw_home}}` for the preset persona, and
 * register the home as a sandbox-policy extra writable root.
 * @param ctx - the host context.
 * @param config - optional root and prefix overrides.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const root = config.root ?? defaultClawRoot()
  const prefix = config.prefix ?? 'claw'
  const service = new ClawHomeServiceImpl(ctx, root, prefix)
  ctx.provide('clawHome', service)
  ctx.sandboxPolicy.grant({
    name: 'claw-home',
    roots: ({ session }) => {
      const home = service.homeForSession(session?.id)
      return home === undefined ? [] : [home]
    },
  })

  const adopt = (sessionId: string, preset: string | undefined): void => {
    service.track(sessionId, preset)
    if (!isClawPreset(preset, prefix)) return
    try {
      ensureClawHome(preset, root)
    } catch (error) {
      ctx.logger.warn(`claw-home: failed to create home for preset "${preset}": ${String(error)}`)
    }
  }

  ctx.effect(() => {
    const stopCreated = ctx.on('agent/created', ({ agent }) => {
      adopt(agent.id, presetFromSession(agent.session))
    })
    // The Web picker switches a blank session after publication: the header
    // stays on the creation default (`standard`) and the live preset is a
    // logged `agent-preset/selected`. Without this listener the home is never
    // created for the path users actually take.
    const stopSelected = ctx.on('session/event', (session, event) => {
      if (event.type !== 'agent-preset/selected') return
      const data = event.data
      const preset = typeof data === 'object' && data !== null && 'agentPreset' in data
        && typeof data.agentPreset === 'string'
        ? data.agentPreset
        : undefined
      adopt(session.id, preset)
    })
    const stopDisposed = ctx.on('agent/disposed', ({ agent }) => {
      service.untrack(agent.id)
    })
    return () => {
      stopCreated()
      stopSelected()
      stopDisposed()
    }
  })

  ctx.inject(['systemPrompt'], (scope) => {
    // A `context()` contribution becomes a durable user-role runtime snapshot
    // in the session log. The home path belongs in the system prompt, so it
    // is a persona variable — the same slot as `{{model}}` and `{{cwd}}` —
    // and claw presets splice `{{claw_home}}` into `deployment:persona`.
    scope.systemPrompt.variable(CLAW_HOME_VARIABLE, (context) => {
      const agent = context.agent
      if (agent === undefined) return undefined
      const preset = presetFromSession(agent.session)
      if (!isClawPreset(preset, prefix)) return undefined
      adopt(agent.id, preset)
      return clawHomeFor(preset, root)
    })
  })
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    clawHome: ClawHomeService
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'agent-preset/selected': { agentPreset: string }
  }
}
