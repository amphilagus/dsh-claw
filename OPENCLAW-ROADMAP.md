# OpenClaw 化路线图（DeepSeek Harness）

把 OpenClaw 的能力模型迁移到 DSH：**一个 agent = 一个 claw 开头的 preset**，在此基础上补齐个人空间、人设、记忆、跨 session、睡眠、定时器六项能力。本文档记录现状盘点、已完成工作、剩余工作与实施顺序。

## 1. 核心映射

| OpenClaw 概念 | DSH 对应物 | 状态 |
|---|---|---|
| 一个 agent | 一个 `claw*` 开头的 agent preset（`agent.cordis.yml`） | ✅ 已确立 |
| agent home（`$OPENCLAW_STATE_DIR/agents/<id>/`） | `~/.dsh/claw/<presetId>/` | ✅ v1 已实现 |
| AGENTS.md（人设） | preset 里的 `dsh-persona` 行 | ✅ 已实现 |
| 插件系统（cordis） | DSH 本身就是 cordis 插件树 | ✅ 天然具备 |

插件仓库：`/Users/amphilagusgu/dc-harness/claw-home/`（独立项目，不改 DSH 源码）。
当前部署：`@deepseek-ai/dsh-claw-home` 一个 2 合 1 bundle（主插件 + 沙箱 provider），已装入 **web profile**；`claw-personal` preset 在 `~/.dsh/.agent-presets/claw-personal/`。

## 2. 六项功能现状盘点

| # | 功能 | 现状 | 结论 |
|---|---|---|---|
| 1 | 独立个人空间 | home 目录自动创建 + system prompt 注入 + **bash 可写**（沙箱白名单）。**fs 工具不可写**（进程内 fs 栅栏未扩展）；**读不隔离**；无 per-agent settings | 🟡 主体完成，3 个缺口 |
| 2 | 人设文件 | `dsh-persona` 行 shadow 部署人设，`complete:true` 可独占 system prompt，模板变量 `{{model}}/{{cwd}}` | ✅ 完成 |
| 3 | 记忆系统 | 原生：session-query（SQLite FTS5，5 个模型工具）+ compaction 摘要写回 log。已补：`claw-memory`（Ollama 向量化 `memory_search`，`~/dsh/memories` 按 preset JSONL）。缺：长期事实存储、自动沉淀 | 🟢 语义检索已交付 |
| 4 | 跨 session 管理 | 原生：`session_search` / `session_event_search` / `session_trace` / `session_event_trace` / `session_event_read` 5 工具 + 跨 session `@提及` 快照注入；同 cwd 授权 | ✅ 完成（无需开发） |
| 5 | 睡眠系统（记忆沉淀） | **无任何现成机制**。积木齐全：schedule 定时唤醒 + compaction `compactNow()` 摘要 + session-query 读取 | ❌ 未开始（最重） |
| 6 | 定时器系统 | 原生 schedule 包：`after/at/every`（every ≥5 分钟），到点 `agent.followup()` 唤醒，仅对 live agent；**无 cron/日历语义、冷 session 不唤醒** | 🟡 半成品 |

## 3. 已完成工作与踩过的坑

### 3.1 已交付

- **`claw-home` 2 合 1 bundle**（`claw-home/claw-home/`）：
  - 主插件（`src/index.ts`）：`agent/created` 时按 `claw*` 前缀判定 → `mkdir` home + `ctx.clawHome` 服务；system prompt 动态注入英文 home 说明
  - 沙箱插件（`src/sandbox.ts`）：`ClawHomeSandboxProvider extends LocalSandboxProvider`，`confine` 时按方言注入 home 可写根（bwrap `--bind` / landlock `--rw` / seatbelt SBPL 片段）
  - 一个 `cordis.patch.yml`：`disabled` 系统 sandbox 行 + insert 两行插件
- **`claw-personal` preset**（`claw-home/examples/claw-personal/`，已装到 `~/.dsh/.agent-presets/`）
- **`claw-memory` 插件**（`claw-home/memory/`）：`turn/end` 监听器抽取对话文本 → Ollama embed → `~/dsh/memories` JSONL；`memory_search` 语义检索；13 个单元/集成测试
- 主包 22 个测试 + 记忆包 13 个测试，claw-home/memory 双包 typecheck 全绿

### 3.2 踩过的坑（开发备忘）

1. **Service 子类构造即注册**：`extends LocalSandboxProvider` 时构造函数已 `provide('sandbox')`，`apply` 里再手动 provide 会报 `service "sandbox" has been registered`。**只 new，不 provide**。
2. **patch 不能改名已有行**：按 id 覆盖时 name 必须一致，否则 `name mismatch ... skipping`。替换 provider 的正确姿势是 `disabled: true` + insert 新行。
3. **preset 组合配置必须完整**：`tool-todo` 缺 `allowParallelInProgress`、`plan-mode` 缺 `section` 都会导致整个 preset mount 失败（`recompose` 抛错）→ 前端 chip 弹回默认 preset。**任何 preset 行的必填 config 都要照 standard 抄全**。
4. **preset 裸包名解析**：用户 preset 目录（`~/.dsh/.agent-presets/`）下的组合行用包名（如 `@deepseek-ai/dsh-persona`），由 `PresetTree` 的 harnessBase 机制从 host（profile 目录）解析，实际落到 `~/.dsh/profiles/node_modules` 平坦回退目录（安装闭包）。**新插件包必须在该闭包内**（通过 bundle 依赖引入）才能被 preset 引用。
5. **TUI 无法选 preset**：agent-loop 配置的 agents 无 `agentPreset` 字段（启动即 standard）；TUI 里选不了 preset，只能 `--resume` 续跑 web 建的 claw session。
6. **session 的 preset 创建即锁死**：非 blank session 切换 preset 被 host 拒绝（`agent-preset-locked`）；选择必须在新建会话的 blank 阶段完成。

## 4. 剩余工作清单

### P0 — 让 v1 完整（1–2 天）

| # | 工作 | 说明 | 工作量 |
|---|---|---|---|
| A | fs 工具可写 home | 给 `SandboxExecutionPolicy` 加 `writeRoots?: readonly string[]`（`sandbox/src/index.ts` + `roots.ts` 的 `writableRoots` 展开），`sandbox-policy` resolve 时把 claw home 塞入；Seatbelt + fs 栅栏自动同步，bwrap/landlock 各补几行。属 DSH 核心小补丁，可提上游 PR | 0.5–1 天 |
| B | 读隔离（可选） | `readRoots` 裁剪三平台 profile（landlock `readOnly: ['/']` → 白名单）；注意自己的 home 必须在读白名单内 | 1–2 天 |

### P1 — OpenClaw 核心能力（1–2 周）

| # | 工作 | 说明 | 工作量 |
|---|---|---|---|
| C | 全局调度器 + cron | 新插件：枚举持久化 session → fold 求最早 due → 到点 `ctx.agents.resume()` 冷装载 → `agent.followup()` 唤醒 → 回合后 dispose。补 cron/日历表达式（现有 `every` 下限 5 分钟）；多进程防重。复用 schedule 的到期分发逻辑 | 3–5 天 |
| D | 睡眠系统（记忆沉淀） | 站在 C 之上：夜间/空闲触发 → session-query 拉当日 surface → LLM 总结 → 写回（session log 事件或 `ctx.storage` KV）→ 注入后续会话。遵守 "Model-visible ⟺ logged" 不变量 | 3–5 天 |
| E | TUI 支持 preset | 给 agent-loop 的 agents 配置加 `agentPreset` 字段（schema 一行 + create meta 透传），TUI 配置行直接写 `agentPreset: claw-personal` | 0.5 天 |

### P2 — 记忆升级与打磨（1–2 周）

| # | 工作 | 说明 | 工作量 |
|---|---|---|---|
| F | 语义检索 | ✅ 已交付为独立 `@deepseek-ai/dsh-claw-memory`：`turn/end` 监听器只抽取 user 直发文本 + assistant 文本块，经本地 Ollama 向量化后写入 `~/dsh/memories/memory-<preset>.jsonl`；`memory_search` 同模型查询余弦相似度 | 已完成 |
| G | 长期事实存储 | 沉淀出的"事实/偏好/资产清单"落 `ctx.storage`（sqlite/json），按 agent（preset）分域；工具读改写 | 2–3 天 |
| H | per-agent settings | settings 文档按 agent 分命名空间（设计问题，v1 未做） | 1–2 天 |
| I | Windows 支持 | ACL runner 无 `--` argv 方言，home grant 未注入；需单独实现 | 1–2 天 |

### 清理项（5 分钟）

- `~/.dsh/profiles/tui/` 里残留旧版 `@deepseek-ai/dsh-claw-home-sandbox`（2 包时代）依赖：`dsh plugin --profile tui remove @deepseek-ai/dsh-claw-home-sandbox`，然后按需 `add` 新版 2 合 1 bundle
- `~/.dsh/profiles/clawtest/` 临时 profile（半装状态）：`rm -rf ~/.dsh/profiles/clawtest`

## 5. 架构约束备忘

- **Model-visible ⟺ logged**：任何模型可见的输入必须能由 session log 重建；记忆沉淀不能走旁路数据库硬塞上下文。
- **注册都是 effect**：插件卸载时自动回收；新注册走 `ctx.effect()`/`ctx.on()`。
- **seam 三件套**：新能力 = Service Definition + Provider + Consumer（工具），如 compaction/session-query 的范式。
- **预设组合不发布全局服务**：preset 行发布服务必须进 `isolate` realm，否则 mount 被 `leakedServices` 审计拒绝。
- **唤醒只有 followup**：`agent.followup()` 是唯一真正唤醒 agent 的入口（真实 `llm.stream`）；`inject()` 不唤醒。
- **改 DSH 核心包 = fork 维护**：A/B/E 三项是核心小补丁（每处 1–10 行），可合并为一个 PR 提上游；其余全是独立插件。

## 6. 建议实施顺序

1. **P0-A（fs 写 home）**：先补核心补丁，把 v1 语义闭合（bash + fs 都能写 home）
2. **P1-E（TUI preset）**：0.5 天，让 TUI 也能开 claw agent
3. **P1-C（全局调度器）**：定时器升级，睡眠系统的地基
4. **P1-D（睡眠系统）**：站在 C 上做记忆沉淀闭环
5. **P2-F/G（语义记忆）**：记忆系统升级，OpenClaw "长期记忆"的最终形态
6. **P2-H/I**：打磨项，按需

总计：P0+P1 约 2 周，P2 约 1–2 周，全部完成后 OpenClaw 六项能力在 DSH 上闭环。
