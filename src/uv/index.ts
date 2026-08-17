/**
 * uv sandbox grant: extra writable roots for uv's cache and data directories.
 * @module @deepseek-ai/dsh-claw/uv
 */

import { mkdirSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { defaultUvCacheDir, defaultUvDataDir } from './paths.ts'

export { defaultUvCacheDir, defaultUvDataDir } from './paths.ts'
export type { UvPathEnv } from './paths.ts'

/** Cordis function-plugin name. */
export const name = 'uv-sandbox'
/** Services required before the uv cache grant can register. */
export const inject = ['sandboxPolicy']

export interface Config {
  /** Override uv's cache directory. Defaults to uv's own cache-dir resolution. */
  cacheDir?: string
  /** Override uv's data directory (`python/`, `tools/`). Defaults to uv's data-dir resolution. */
  dataDir?: string
  /** Create the granted directories if missing so bwrap can bind them. Default true. */
  ensure?: boolean
}

/**
 * Register uv cache and data directories as `workspace-write` extra roots.
 * Applies to every session — uv is a host tool, not a claw-preset concern.
 * @param ctx - the host context.
 * @param config - optional cache/data path overrides.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const cacheDir = config.cacheDir ?? defaultUvCacheDir()
  const dataDir = config.dataDir ?? defaultUvDataDir()
  const roots = cacheDir === dataDir ? [cacheDir] : [cacheDir, dataDir]
  if (config.ensure ?? true) {
    for (const dir of roots) {
      try {
        mkdirSync(dir, { recursive: true })
      } catch (error) {
        ctx.logger.warn(`uv-sandbox: failed to create "${dir}": ${String(error)}`)
      }
    }
  }
  ctx.sandboxPolicy.grant({
    name: 'uv',
    roots: () => roots,
  })
}
