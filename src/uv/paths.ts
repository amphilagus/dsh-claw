/**
 * uv cache and data directory resolution, matching uv's XDG-first layout.
 * @module @deepseek-ai/dsh-claw/uv/paths
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

/** Inputs that select uv's host storage, injectable in tests. */
export interface UvPathEnv {
  /** `UV_CACHE_DIR` override. */
  UV_CACHE_DIR?: string
  /** `XDG_CACHE_HOME` — when set, cache is `$XDG_CACHE_HOME/uv`. */
  XDG_CACHE_HOME?: string
  /** `XDG_DATA_HOME` — when set, data is `$XDG_DATA_HOME/uv`. */
  XDG_DATA_HOME?: string
  /** Windows `%LOCALAPPDATA%`. */
  LOCALAPPDATA?: string
}

/**
 * Resolve uv's cache directory the way current uv does: `UV_CACHE_DIR`, else
 * `$XDG_CACHE_HOME/uv`, else `~/.cache/uv` on POSIX and `%LOCALAPPDATA%\uv\cache`
 * on Windows. macOS uses `~/.cache/uv`, not `~/Library/Caches/uv`.
 * @param env - process env, or a test double.
 * @param platform - `process.platform`, or a test double.
 * @param home - user home, or a test double.
 */
export function defaultUvCacheDir(
  env: UvPathEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  if (env.UV_CACHE_DIR !== undefined && env.UV_CACHE_DIR.length > 0) return env.UV_CACHE_DIR
  if (env.XDG_CACHE_HOME !== undefined && env.XDG_CACHE_HOME.length > 0) return join(env.XDG_CACHE_HOME, 'uv')
  if (platform === 'win32') return join(env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'uv', 'cache')
  return join(home, '.cache', 'uv')
}

/**
 * Resolve uv's persistent data directory (`python/`, `tools/`): `XDG_DATA_HOME/uv`
 * or `~/.local/share/uv` on POSIX, `%LOCALAPPDATA%\uv` on Windows.
 * @param env - process env, or a test double.
 * @param platform - `process.platform`, or a test double.
 * @param home - user home, or a test double.
 */
export function defaultUvDataDir(
  env: UvPathEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  if (env.XDG_DATA_HOME !== undefined && env.XDG_DATA_HOME.length > 0) return join(env.XDG_DATA_HOME, 'uv')
  if (platform === 'win32') return join(env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'uv')
  return join(home, '.local', 'share', 'uv')
}
