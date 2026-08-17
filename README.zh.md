# dsh-claw — DeepSeek Harness 的 claw 宿主 bundle

树外 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件包 `@deepseek-ai/dsh-claw`。给所有 `claw*` preset 的 agent 提供个人主目录、沙箱 extra 可写根（含 uv cache），以及本地 Ollama 向量记忆（`memory_search`）。

Profile 只装这一行依赖；三个插件由本仓库的 `cordis.patch.yml` 一次插入。

```
dsh-claw/
├── package.json           # 唯一 npm 包 + dsh.bundle.patch
├── cordis.patch.yml       # 插入 home / uv / memory
├── src/index.ts           # bundle stub（无运行时 API）
├── src/home/              # 个人主目录 + {{claw_home}} + sandboxPolicy.grant
├── src/uv/                # uv cache/data extra writable roots
├── src/memory/            # 对话记忆 + memory_search
├── examples/claw-personal/
└── scripts/link-dsh.sh
```

Cordis 通过 subpath 加载插件，不必再装第二个包：

```yaml
- insert:
    - id: claw-home
      name: '@deepseek-ai/dsh-claw/home'
    - id: uv-sandbox
      name: '@deepseek-ai/dsh-claw/uv'
    - id: claw-memory
      name: '@deepseek-ai/dsh-claw/memory'
```

系统 `sandbox-local` 保留。`claw-home` 和 `uv-sandbox` 通过 `sandboxPolicy.grant()` 把 extra writable roots 加进 `workspace-write`。`memory` 只要在 host 的 `agents` / `tools` 之后即可。插件 Cordis `name`（`claw-home`、`uv-sandbox`、`claw-memory`）和 id 保持稳定，profile 里按 id 做 overlay 仍然有效。

**不要**在 agent preset 里再挂这些插件。preset 平面挂载会把服务漏进进程全局 realm，花名册会拒载，选择器会掉回默认 preset。

## 三个插件

### `claw-home`（`ctx.clawHome`）

- 在 `agent/created` 以及之后的 `agent-preset/selected` 上：若 live preset id 以 `claw` 开头，则在 `$DSH_HOME/claw/<presetId>` 创建主目录（可用 `root` / `prefix` 覆盖）并跟踪该 session。Web 选预设时 header 仍是创建时的 `standard`，真正生效的是日志里最后一条 `agent-preset/selected`。
- 通过 `systemPrompt.variable('claw_home')` 发布 `{{claw_home}}`，由 preset 的 persona 拼进系统提示，而不是写成 session 里的 runtime snapshot。
- 对外提供 `homeForPreset` / `homeForSession`，并调用 `sandboxPolicy.grant({ name: 'claw-home' })`，把被跟踪 session 的主目录盖进 `extraWriteRoots`。bash / terminal / fs 围栏以及 Windows ACL 都从这份策略取可写根；默认 `sandbox-local` 不用替换。

### `uv-sandbox`

- 对**所有** session 生效（uv 是宿主工具，不跟 `claw*` preset 绑定）。
- 调用 `sandboxPolicy.grant({ name: 'uv' })`，把 uv 的 cache 和 data 目录盖进 `workspace-write` 的 extra writable roots。默认路径跟 uv 自己一致：`UV_CACHE_DIR` / `$XDG_CACHE_HOME/uv` / `~/.cache/uv`（macOS 也是 `.cache`，不是 `Library/Caches`），以及 `$XDG_DATA_HOME/uv` / `~/.local/share/uv`。
- 启动时 `mkdir` 这两处目录，避免 bwrap `--bind` 绑到不存在的路径。
- `read-only` 不会盖戳。路径级授权，不是「只给 uv 命令」；配置可用 `cacheDir` / `dataDir` / `ensure` 覆盖。

### `claw-memory`（`memory_search`）

- 监听 `session/event`。每个 `claw*` session 的 `turn/end` 只抽取对话正文：
  - 用户直发（`user/message` 且 `source.kind === 'user'`）
  - 模型可见的 `assistant/message` 文本块
  - 工具调用/结果、系统提示、注入上下文、chunk、边界事件一律不存
- 用本地 Ollama（`/api/embed`，旧版回退 `/api/embeddings`）把文本编成向量，按行追加到 `$DSH_HOME/memories/memory-<preset>.jsonl`。同一 preset 的所有 session 共用一个文件，磁盘顺序就是写入先后；`sessionId` 只是记录字段，不是分库键。
- 每条记录同时保存原文 `text` 和向量 `embedding`。检索时模型只编码当前 query，再和库里已有向量算余弦相似度，按分数从高到低返回（同分则新的在前）。
- 只在 live preset 匹配 `prefix`（默认 `claw*`）的 **root** agent 上注册 `memory_search`；空白 `standard` session 后来切到 claw preset 也会被收养。
- 配置：`root`（默认 `$DSH_HOME/memories`，即 `~/.dsh/memories`）、`ollamaUrl`（默认 `http://127.0.0.1:11434`）、`embeddingModel`（默认 `nomic-embed-text`）、`prefix`（默认 `claw`；`''` 表示记住所有 session）、`minChars`、`timeoutMs`、`enabled`。

## 依赖

- 能加载 profile bundle 的 DSH 安装。运行时 `@deepseek-ai/*` 一律从 DSH 解析，不从本仓库再装一份。
- 本地 [Ollama](https://ollama.com) 已拉取嵌入模型，例如 `ollama pull nomic-embed-text`。
- 开发时假定旁边有 `../deepseek-harness`（typecheck / 测试用 symlink）。插件源码本身不依赖那份 checkout 才能运行。

## 开发

```sh
pnpm install
bash scripts/link-dsh.sh   # pnpm install 清掉 node_modules 后需要重做
pnpm build                 # tsdown → lib/**/*.mjs + *.d.mts
pnpm typecheck
pnpm test
```

`scripts/link-dsh.sh` 只给仓库根上的 `node_modules/@deepseek-ai/` 链到旁边的 DSH checkout。

## 部署

1. **构建**：在本仓库根目录 `pnpm build`。
2. **写入 profile** — 编辑 `~/.dsh/profiles/<profile>/package.json`，只留这一项（排在 `dsh-base` / `dsh-web-app` 之后）：

   ```json
   {
     "dependencies": {
       "@deepseek-ai/dsh-claw": "link:/absolute/path/to/dsh-claw"
     },
     "dsh": {
       "profile": {
         "bundles": [
           "@deepseek-ai/dsh-base",
           "@deepseek-ai/dsh-web-app",
           "@deepseek-ai/dsh-claw"
         ]
       }
     }
   }
   ```

   然后在该 profile 目录执行 `pnpm install`。bundle 自带 `cordis.patch.yml`，不必再手写那两段插件名。
3. **准备 claw preset**：把 `examples/claw-personal/` 拷到 `~/.dsh/.agent-presets/claw-personal/`。id 以 `claw` 开头的 preset 会自动启用本 bundle；其它 preset 不受影响。preset YAML 里不要再挂 `@deepseek-ai/dsh-claw`。
4. 重启 DSH。

按 id 覆盖记忆配置时，写在 **profile** 的 `cordis.patch.yml` 里，例如：

```yaml
- id: claw-memory
  config:
    root: '~/.dsh/memories'
```

## 已知限制

- **没有读隔离**：confined 执行仍然可读全盘（`readOnly: ['/']`）。其它 claw agent 的 home 可读但不可写。
- **home 按 preset 共享**：路径是 `$DSH_HOME/claw/<presetId>`，同一 preset 的所有 session 共用一个主目录（这样才能跨会话持久）。
- **记忆按 preset 追加**：换 `embeddingModel` 后旧向量维度对不上，`memory_search` 会报错而不是混用两套向量。
- **Windows ACE 按 workspace SID 共享**：extra roots 复用 workspace write SID 的 standing ACE；共享同一 workspace 的 session 会共享这些 ACE。
- **`read-only` 不会打开 home**：extra roots 只在 `workspace-write` 下盖戳。
