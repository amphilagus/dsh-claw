/**
 * Deterministic claw-home path derivation and creation.
 * @module @deepseek-ai/dsh-claw/home/home
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** Default preset-id prefix that opts an agent into a personal home. */
export const DEFAULT_CLAW_PREFIX = 'claw'

/**
 * Decide whether a preset id opts its agents into a personal home.
 * @param presetId - the session's agent preset id, or undefined for presets-less sessions.
 * @param prefix - the id prefix that opts in; defaults to {@link DEFAULT_CLAW_PREFIX}.
 * @returns true when the preset id is defined and starts with the prefix.
 */
export function isClawPreset(presetId: string | undefined, prefix = DEFAULT_CLAW_PREFIX): presetId is string {
  return presetId !== undefined && presetId.startsWith(prefix)
}

/** The minimum a caller must supply to resolve a session's live preset. */
export interface PresetBearingSession {
  /** Creation header; `agentPreset` is what the session STARTED with. */
  readonly header: { readonly agentPreset?: string }
  /** Event log, oldest first; a later `agent-preset/selected` wins. */
  readonly events: readonly { readonly type: string; readonly data: unknown }[]
}

/**
 * The preset a session actually runs, newest selection winning.
 *
 * The creation header is frozen; the Web picker switches a blank session by
 * appending `agent-preset/selected` rather than rewriting it. Reading the
 * header alone treats a claw session as still `standard`.
 * @param session - the session's header and event log.
 * @returns the preset id, or undefined when none was recorded.
 */
export function presetFromSession(session: PresetBearingSession): string | undefined {
  for (let index = session.events.length - 1; index >= 0; index -= 1) {
    const event = session.events[index]
    if (event?.type !== 'agent-preset/selected') continue
    const data = event.data
    if (typeof data === 'object' && data !== null && 'agentPreset' in data && typeof data.agentPreset === 'string') {
      return data.agentPreset
    }
  }
  return session.header.agentPreset
}

/**
 * The deterministic home directory for one claw preset.
 * @param presetId - a preset id already accepted by {@link isClawPreset}.
 * @param root - the claw-homes root directory.
 * @returns the preset's home directory under the root.
 */
export function clawHomeFor(presetId: string, root: string): string {
  return join(root, presetId)
}

/**
 * Resolve the default claw-homes root under the harness home.
 * @param env - environment to read `DSH_HOME` from; defaults to `process.env`.
 * @returns `$DSH_HOME/claw` (or `~/.dsh/claw` without the variable).
 */
export function defaultClawRoot(env: Record<string, string | undefined> = process.env): string {
  return join(resolveDshHome(undefined, env), 'claw')
}

const ensuredHomes = new Set<string>()

/**
 * Create a preset's home directory once per process and return its path.
 * Deterministic and idempotent: repeated calls for the same home skip the
 * filesystem after the first successful creation.
 * @param presetId - a preset id already accepted by {@link isClawPreset}.
 * @param root - the claw-homes root directory.
 * @returns the created home directory path.
 */
export function ensureClawHome(presetId: string, root: string): string {
  const home = clawHomeFor(presetId, root)
  if (!ensuredHomes.has(home)) {
    mkdirSync(home, { recursive: true })
    ensuredHomes.add(home)
  }
  return home
}
