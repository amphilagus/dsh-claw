/**
 * Persona-facing announcement of a claw agent's personal home.
 * @module @deepseek-ai/dsh-claw/home/prompt
 */

/**
 * Prompt variable interpolated into a claw preset's `deployment:persona`
 * section. Must match `systemPrompt.variable`'s `[a-z][a-z0-9_]*` rule.
 */
export const CLAW_HOME_VARIABLE = 'claw_home'

/**
 * The persona sentence that names the home. Presets that opt in splice this
 * into `deployment:persona` (with `{{claw_home}}`); the plugin registers the
 * variable so interpolation lands in the system prompt, not a session snapshot.
 * @returns the persona fragment; the variable is substituted at render.
 */
export function clawHomePersonaLine(): string {
  return `Your personal home directory is {{${CLAW_HOME_VARIABLE}}}. You may use bash commands to make any changes inside it and store your private assets there; it persists across your sessions.`
}

/**
 * Render the persona sentence with a concrete home path, for tests.
 * @param home - the agent's home directory path.
 * @returns the interpolated persona sentence.
 */
export function renderClawHomePrompt(home: string): string {
  return clawHomePersonaLine().replace(`{{${CLAW_HOME_VARIABLE}}}`, home)
}
