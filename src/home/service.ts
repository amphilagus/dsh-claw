/**
 * The claw-home resolution service consumed by the sandbox provider.
 * @module @deepseek-ai/dsh-claw/home/service
 */

import type { Context } from '@deepseek-ai/cordis'
import { clawHomeFor, isClawPreset } from './home.ts'

/** Home resolution for claw agents, keyed by preset or by live session. */
export interface ClawHomeService {
  /** The claw-homes root directory this process serves. */
  readonly root: string
  /** The preset-id prefix that opts an agent into a personal home. */
  readonly prefix: string
  /**
   * Resolve the home for one preset id.
   * @param presetId - the session's agent preset id.
   * @returns the home directory, or undefined when the preset is not a claw preset.
   */
  homeForPreset(presetId: string | undefined): string | undefined
  /**
   * Resolve the home for one live session.
   * @param sessionId - the session id of a published agent.
   * @returns the home directory, or undefined when the session is untracked or not a claw agent.
   */
  homeForSession(sessionId: string | undefined): string | undefined
}

/** Tracks claw agents published on the context and resolves their homes. */
export class ClawHomeServiceImpl implements ClawHomeService {
  readonly root: string
  readonly prefix: string
  private readonly sessionPresets = new Map<string, string>()

  constructor(_ctx: Context, root: string, prefix: string) {
    this.root = root
    this.prefix = prefix
  }

  homeForPreset(presetId: string | undefined): string | undefined {
    return isClawPreset(presetId, this.prefix) ? clawHomeFor(presetId, this.root) : undefined
  }

  homeForSession(sessionId: string | undefined): string | undefined {
    if (sessionId === undefined) return undefined
    const preset = this.sessionPresets.get(sessionId)
    return preset === undefined ? undefined : clawHomeFor(preset, this.root)
  }

  /**
   * Record a published agent's preset under its session id.
   * A non-claw (or missing) preset forgets the session, so a blank-session
   * switch away from a claw preset drops the sandbox home grant.
   * @param sessionId - the agent's session id.
   * @param presetId - the agent's live preset id.
   */
  track(sessionId: string, presetId: string | undefined): void {
    if (isClawPreset(presetId, this.prefix)) this.sessionPresets.set(sessionId, presetId)
    else this.sessionPresets.delete(sessionId)
  }

  /** Forget a disposed agent's session id. */
  untrack(sessionId: string): void {
    this.sessionPresets.delete(sessionId)
  }
}
