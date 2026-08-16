# claw-home — OpenClaw-style personal home for DSH claw agents

Out-of-tree [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugins that give every agent on a `claw*` preset a persistent personal home directory — created automatically at session start, announced in the system prompt, and writable from bash alongside the user's workspace.

```
dc-harness/claw-home/
├── claw-home/   @deepseek-ai/dsh-claw-home          (main plugin: home creation + prompt)
├── memory/      @deepseek-ai/dsh-claw-memory        (Ollama-backed conversational vector memory)
├── sandbox/     @deepseek-ai/dsh-claw-home-sandbox   (sandbox provider: home in writable roots)
└── examples/    claw-personal preset template
```

## What each package does

### `claw-home` (function plugin, `ctx.clawHome`)

- On `agent/created`, if the agent's preset id starts with `claw`, creates its home at `$DSH_HOME/claw/<presetId>` (default root; override with `root` config, prefix with `prefix` config) and tracks the session.
- Registers a dynamic system-prompt context that tells claw agents (English):

  > Your personal home directory is `$DSH_HOME/claw/<presetId>`. You may use bash commands to make any changes inside it and store your private assets there; it persists across your sessions.

- Exposes `ctx.clawHome` (`homeForPreset` / `homeForSession`) for the sandbox provider.

### `claw-home-sandbox` (function plugin, replaces `ctx.sandbox`)

- Subclasses `LocalSandboxProvider`; for every confined execution by a tracked claw agent, injects the agent's home as an extra writable root before the `--` separator:
  - bubblewrap: `--bind <home> <home>`
  - Landlock launcher: `--rw <home>`
  - seatbelt (macOS): `(allow file-write* (subpath "<home>"))` appended to the SBPL profile
- Unknown dialects (e.g. Windows ACL) are left unchanged; non-claw and agentless calls are unchanged.

### `claw-memory` (function plugin, `memory_search`)

- Listens to `session/event`; at every `turn/end` of a `claw*` session it extracts **only** the conversational core:
  - direct user input (`user/message` with `source.kind === 'user'`), and
  - the model's visible `text` blocks from `assistant/message`.
  - Tool calls/results, system prompts, injected context, chunks, and boundary events are never stored.
- Embeds each selected text through a local Ollama embedding model (`/api/embed` with a legacy `/api/embeddings` fallback) and appends one JSONL vector record per message.
- Persists per preset at `~/dsh/memories/memory-<preset>.jsonl` (override with `root`; see Config below).
- Registers `memory_search` only on root agents whose live preset matches `prefix` (default `claw*`), including blank `standard` sessions later switched to a claw preset; the query is embedded with the same Ollama model and matched by cosine similarity.
- Config: `root` (default `~/dsh/memories`), `ollamaUrl` (default `http://127.0.0.1:11434`), `embeddingModel` (default `nomic-embed-text`), `prefix` (default `claw`; `''` remembers all sessions), `minChars`, `timeoutMs`, `enabled`.

## Requirements

- A DSH installation whose profile can load the plugins (see Deploy below). All runtime `@deepseek-ai/*` imports resolve from the DSH installation, never from this repo.
- A running local [Ollama](https://ollama.com) with the configured embedding model pulled, e.g. `ollama pull nomic-embed-text`.
- The DSH checkout at `../deepseek-harness` is used only for development (typecheck/tests via `node_modules` symlinks and tsconfig paths) — the plugin source itself is fully independent.

## Development

```sh
pnpm install        # in claw-home/, memory/, and sandbox/ (dev deps only)
pnpm build          # tsdown -> lib/*.mjs + *.d.mts
pnpm typecheck
pnpm test           # vitest
```

The symlinks under each package's `node_modules/@deepseek-ai/` point into the sibling DSH checkout and are needed for typecheck/tests. Recreate after a `pnpm install` with the script in `scripts/link-dsh.sh`.

## Deploy

1. **Build** the packages (`pnpm build` in each).
2. **Add to your profile** — edit `~/.dsh/profiles/<profile>/package.json`:

   ```json
   {
     "dependencies": {
       "@deepseek-ai/dsh-claw-home": "file:/absolute/path/to/claw-home/claw-home",
       "@deepseek-ai/dsh-claw-home-sandbox": "file:/absolute/path/to/claw-home/sandbox",
       "@deepseek-ai/dsh-claw-memory": "file:/absolute/path/to/claw-home/memory"
     }
   }
   ```

   then run `pnpm install` inside the profile directory.
3. **Patch the composition** — append to `~/.dsh/profiles/<profile>/cordis.patch.yml`:

   ```yaml
   - id: claw-home
     name: '@deepseek-ai/dsh-claw-home'
   - id: sandbox
     name: '@deepseek-ai/dsh-claw-home-sandbox'
   - id: claw-memory
     name: '@deepseek-ai/dsh-claw-memory'
   ```

   The `sandbox` id targets the shipped `dsh-sandbox-local` row (replacing its name); the others insert new plugins. Restart the DSH process.
4. **Create a claw preset** — copy `examples/claw-personal/` to `~/.dsh/.agent-presets/claw-personal/` (see [agent-presets](../../deepseek-harness/packages/preset/README.md)). Any preset whose id starts with `claw` opts in; non-`claw` presets are untouched.

## Known Limitations and Deferred Work

- **fs tools cannot write the home** — only bash/terminal executions gain the home writable root (the in-process fs fence still checks `writableRoots(policy)`, which v1 does not extend). Prompts steer agents to bash for home writes. A `writeRoots` field on `SandboxExecutionPolicy` would close this in a small core patch.
- **No read isolation** — all confined executions still read everything (`readOnly: ['/']` / `--ro-bind / /`). Homes of other claw agents are readable but not writable.
- **No per-session homes** — the home is per preset (`$DSH_HOME/claw/<presetId>`), so every session of the same claw preset shares one home (this is what makes it a persistent personal space across sessions).
- **Memory is append-only per preset** — changing `embeddingModel` later makes old vectors incompatible; `memory_search` reports a dimension mismatch instead of silently mixing models.
- **Windows** — the grant injection is dialect-detected; the Windows ACL runner has no `--` argv dialect, so no home grant is added there yet.
