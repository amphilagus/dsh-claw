/**
 * Claw-home sandbox provider: grants a claw agent's personal home directory
 * as an extra writable root for confined shell executions.
 * @module @deepseek-ai/dsh-claw/sandbox
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import LocalSandboxProvider from '@deepseek-ai/dsh-sandbox-local'
import type { ClawHomeService } from '../home/index.ts'
import { injectWritableRoot } from './grant.ts'

export { injectWritableRoot } from './grant.ts'

/** Cordis function-plugin name. */
export const name = 'claw-home-sandbox'
/** Services required before claw agents can receive the widened sandbox. */
export const inject = ['clawHome']

export interface Config {
  /** Root directory holding one home per claw-* preset; must match the claw-home plugin. */
  root?: string
  /** Preset-id prefix that opts an agent into a personal home; must match the claw-home plugin. */
  prefix?: string
  /** Optional sandbox-local runner overrides, passed through unchanged. */
  runnerCommand?: string[]
  runnerFailureSignatures?: string[]
  probeTimeoutMs?: number
}

/**
 * Install the claw-home sandbox provider as `ctx.sandbox`, replacing the
 * plain local provider. Every confined execution by a tracked claw agent
 * additionally gains the agent's home directory as a writable root.
 * Construction registers the service (the Service base class provides it),
 * so no explicit `ctx.provide` follows.
 * @param ctx - the host context.
 * @param config - optional claw and sandbox-local overrides.
 */
export function apply(ctx: Context, config: Config = {}): void {
  new ClawHomeSandboxProvider(ctx, {
    runnerCommand: config.runnerCommand ?? [],
    runnerFailureSignatures: config.runnerFailureSignatures ?? [],
    probeTimeoutMs: config.probeTimeoutMs ?? 5_000,
  })
}

/** The local sandbox provider widened with the claw home writable root. */
export class ClawHomeSandboxProvider extends LocalSandboxProvider {
  private readonly clawHome: ClawHomeService | undefined

  constructor(ctx: Context, config: ConstructorParameters<typeof LocalSandboxProvider>[1]) {
    super(ctx, config)
    this.clawHome = ctx.get('clawHome' as never) as ClawHomeService | undefined
  }

  override confine(argv: readonly string[], policy: SandboxPolicy): ReturnType<LocalSandboxProvider['confine']> {
    const wrapped = super.confine(argv, policy)
    const home = this.clawHome?.homeForSession(policy.sessionId)
    if (home === undefined) return wrapped
    return { ...wrapped, argv: injectWritableRoot(wrapped.argv, home) }
  }
}
