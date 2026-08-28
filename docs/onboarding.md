# Pi 开发者接手指南

> 面向需要快速上手本仓库的开发者。目标是让你理解 pi 的设计、仓库结构、关键数据流和日常工作流。
> 本文档基于 `main` 分支（版本 `0.84.x`，锁步版本）整理。

## 1. 这是什么

Pi 是一个**最小终端编码 harness**：一个交互式编码 agent CLI，通过终端与 LLM 协作完成代码任务。

设计的核心哲学（见 `packages/coding-agent/README.md` 的 Philosophy 一节）：

- **核心保持小**。不内置 subagents、plan mode 等高级功能。
- **扩展驱动**。通过 TypeScript 扩展（extensions）、技能（skills）、提示词模板（prompt templates）、主题（themes）和 pi 包（pi packages）适配任何工作流，而不需要 fork 修改内部。
- **四种运行模式**：交互式（interactive）、单次打印（print / JSON 事件流）、RPC（进程集成）、SDK（嵌入应用）。

Pi 自身**没有内置权限系统**，默认以启动它的用户权限运行；需要隔离时通过容器化（Gondolin 扩展、Docker、OpenShell）实现。这是一个重要的安全边界设计，不是缺陷。

## 2. 仓库结构

npm workspaces monorepo，所有包共享同一个版本号（锁步发布，只升 patch/minor，不升 major）。

```
packages/
  telemetry/         @earendil-works/pi-telemetry          厂商中立的遥测契约（最底层，无依赖）
  ai/                @earendil-works/pi-ai                 统一多 provider LLM API
  agent/             @earendil-works/pi-agent-core         agent 循环：工具调用 + 事件流 + 状态
  tui/               @earendil-works/pi-tui                终端 UI 框架（差分渲染）
  coding-agent/      @earendil-works/pi-coding-agent       CLI：交互模式、扩展、会话（bin: pi）
  protocol/          @earendil-works/pi-protocol           实验性 RPC 协议：CBOR 编解码 + 帧（v1）
  server/            @earendil-works/pi-server             实验性：会话服务器（Unix socket）
  client/            @earendil-works/pi-client             实验性：传输无关的远程会话客户端
  session-backends/
    sqlite-node/     @earendil-works/pi-session-backend-sqlite-node  node:sqlite 会话后端
  evals/             @earendil-works/pi-evals              基于 vitest-evals 的行为评估
```

### 依赖方向

```
telemetry ──> ai ──> agent ──┐
               │             ├──> coding-agent
               │        tui ─┘
               │
server ──> protocol <── client ──> coding-agent
```

即：

- `telemetry` 无内部依赖；`ai` 依赖 telemetry；`agent` 依赖 ai + telemetry；`tui` 无内部依赖。
- `protocol` 无内部依赖，是协议基础层；`client` 依赖 protocol；`server` 依赖 protocol + ai。
- `coding-agent` 依赖 agent、ai、tui，以及 **client/protocol**（用于 `src/client/remote-session.ts` 远程会话场景）。

`protocol` / `server` / `client` 是**实验性**的 RPC 协议栈，处于活跃开发中，API 可能随时变化（各自的 README 都明确标注了 Experimental）。注意区分：coding-agent 的 **RPC mode**（`--mode rpc`）是另一套独立的 stdin/stdout JSONL 协议，走 `modes/rpc/`，与 protocol/client 无关。

- `session-backends/sqlite-node` 独立成包，避免核心包默认引入 `node:sqlite` 原生依赖；它接受运行时特定的 SQLite factory，未来其他后端（如 bun）可各发各的包。
- `telemetry` 只有契约：`TelemetryContext` / `TelemetrySpan` 回调接口、`NOOP_TELEMETRY_CONTEXT`、内存参考实现、可序列化 schema。没有 exporter、没有全局当前 span、不绑定后端——各包显式传递 context。

## 3. 核心设计概念

### 3.1 pi-ai：统一 LLM API

`packages/ai` 是所有模型能力的抽象层，重点：

- **只收录支持工具调用的模型**（agent 工作流的硬性要求），见 `src/models.generated.ts`（**由脚本生成，禁止手改**；修改入口是 `packages/ai/scripts/generate-models.ts`）。
- **Provider 集合**：OpenAI、Anthropic、Google、Bedrock 等内置 provider factory，外加 `createProvider()` 自定义 provider 与 OpenAI 兼容开关。
- **认证解析**：`src/auth/` 自动解析订阅凭证、环境变量 API key、OAuth（Vertex）；`/login` 命令写凭证存储。
- **统一事件流**：`streamSimple` / `completeSimple` 提供跨 provider 统一的流式接口（文本、工具调用 partial JSON、thinking 流式输出、stop reason、usage/token/cost 追踪）。
- **跨 provider 交接**与**上下文序列化**：支持会话中途切换模型，上下文可序列化持久化。
- **浏览器可用**：通过无 Node 依赖实现，配合 tree-shaking。
- 附带一个 CLI（`pi-ai` bin），用于模型目录操作等。

### 3.2 pi-agent-core：agent 循环

`packages/agent` 是状态机核心，最重要的一条设计（见 `src/agent-loop.ts` 头注释）：

> **AgentMessage 与 LLM Message 分离**。agent 循环全程工作在 `AgentMessage`（灵活类型，可通过 declaration merging 扩展自定义消息类型）；只在 LLM 调用边界通过 `convertToLlm()` 过滤转换为 LLM 能理解的标准消息（user/assistant/toolResult）。

```
AgentMessage[] → transformContext() → AgentMessage[] → convertToLlm() → Message[] → LLM
                    (可选)                                    (必需)
```

其他要点：

- `agentLoop()` / `agentLoopContinue()` 返回 `EventStream`（可订阅的事件流），`Agent` 类（`src/agent.ts`）是其高层封装。
- 工具调用：定义、执行、partial JSON 流式参数、参数校验（`validateToolArguments`）。
- `src/harness/` 包含 `AgentHarness`——一个独立的实现规范（文档在 `packages/agent/docs/harness.md`，长达数章），面向无头/聊天场景：write-once 存储 + registers、会话树、操作状态机。主要用于 `pi-chat`（Slack 等）这类场景，与本仓库的 coding-agent 是两套东西，接手时别混淆。

### 3.3 pi-tui：终端 UI 框架

- **差分渲染**：只更新变化行，`TuiAltScreen` 配合 CSI 2026 同步输出实现无闪烁刷新。
- **两个渲染器**，共享同一个 `TUI` 接口：`TuiMainScreen`（主屏，保留终端 scrollback，终端拥有滚动）与 `TuiAltScreen`（alt 屏，固定视口，应用拥有滚动，支持鼠标/滚轮）。
- 组件：Text、Input、Editor、Markdown、SelectList、SettingsList、Image（Kitty/iTerm2）、VStack/HStack/ScrollView（alt 屏布局原语）等。
- `native/` 下有 darwin / win32 原生模块（修饰键、console mode），带 prebuilds。
- 布局系统设计文档见仓库根的 `tui-plan.md`（alt 屏布局系统实现交接文档）。

### 3.4 pi-coding-agent：CLI 与编排

入口是 `src/main.ts`：解析 CLI 参数（`cli/args.ts`），转成 `createAgentSession()` 选项——**SDK 承担重活，CLI 只是薄壳**。

关键文件：

| 文件 | 职责 |
|---|---|
| `core/agent-session.ts` | `AgentSession` 核心：会话生命周期、事件、重试、队列 |
| `core/agent-session-runtime.ts` / `-services.ts` | 运行时与依赖装配（文件系统、bash 执行、模型运行时等） |
| `core/sdk.ts` | 公开 SDK 入口，返回 `AgentSession` |
| `core/compaction/` | 上下文压缩与分支摘要 |
| `core/model-registry.ts` / `model-resolver.ts` | 模型目录与 `--model provider/id[:thinking]` 解析 |
| `core/extensions/` | 扩展系统（类型、加载、生命周期） |
| `modes/interactive/interactive-mode.ts` | 交互模式：TUI 渲染 + 输入，业务逻辑委托给 AgentSession |
| `modes/print-mode.ts` | `pi -p "..."` 单次文本输出与 `--mode json` 事件流 |
| `modes/rpc/` | RPC 模式（stdin/stdout JSONL） |
| `config.ts` | 包内资产路径解析（`getPackageDir` 等，禁止裸用 `__dirname`） |

**四种模式**：

1. **交互模式** `pi`：完整 TUI，编辑器、斜杠命令、快捷键、消息队列、主题。
2. **打印模式** `pi -p "prompt"`：文本输出即退；`pi --mode json` 输出结构化事件流。
3. **RPC 模式** `pi --mode rpc`：stdin/stdout JSONL 协议（命令 + 响应 + 事件流），供 IDE 等子进程集成。注意：帧分隔严格按 `\n`，Node 的 `readline` 会把 `U+2028/2029` 也当分隔符，**不符合协议**。
4. **SDK 模式**：直接 `import { AgentSession } from "@earendil-works/pi-coding-agent"` 嵌入 Node 应用。

**会话持久化**：JSONL 文件按工作目录存储于 `~/.pi/agent/sessions/<encoded-cwd>/`，支持分支（会话树）、压缩（compaction）。格式见 `packages/coding-agent/docs/session-format.md`。

### 3.5 扩展体系

核心可扩展点，全部有独立文档（`packages/coding-agent/docs/`）：

- **Extensions**（`extensions.md`）：TypeScript 模块，可加工具、斜杠命令、事件监听、自定义 UI。通过 jiti 动态加载。
- **Skills**（`skills.md`）：可复用的按需能力包。
- **Prompt templates**（`prompt-templates.md`）：从斜杠命令展开的复用提示词。
- **Themes**（`themes.md`）：内置与自定义终端主题（JSON 主题文件）。
- **Pi packages**（`packages.md`）：把上述四类打包成可分享的 npm/git 包。

### 3.6 实验性协议栈（protocol / server / client）

- **protocol v1**：`[uint32 BE 长度][CBOR payload]`；CBOR 是 RFC 8949 严格子集（拒绝 tag、超长、非法 UTF-8、未知字段），默认限制 16 MiB / 100 万元素 / 64 层嵌套。
- **server**：`PiServer` 组合传输监听器；`PiServerService` 是应用提供的服务实现；Unix listener 通过 socket 文件权限做访问控制；含 `pi-ai` 域对象 → 协议 DTO 的桥接适配器（`toProtocolXxx`，强校验 + 诊断信息脱敏）。
- **client**：传输无关（`ByteTransport` 接口），请求按 ID 关联，**快照权威、progress 事件非权威**；会话租约分 exclusive/shared；不自动重连。

## 4. 关键数据流：一次 prompt 的旅程

以交互模式为例：

1. 用户在编辑器输入 → 回车提交。
2. `AgentSession.prompt()` 把消息加入上下文（会话 JSONL 落盘）。
3. `agentLoop()` 启动：上下文经 `convertToLlm()` 转换为 LLM 消息。
4. `streamFn`（来自 `pi-ai` 的 `models.streamSimple`）请求模型，事件流式返回。
5. agent 循环解析流：文本增量 → `message_update` 事件；工具调用 → 执行工具 → 工具结果回到上下文 → 继续下一轮循环。
6. 循环终止（stop reason / 达到轮次上限）后，`AgentSession` 发出会话级事件。
7. 交互模式把事件渲染到 TUI；JSON/RPC 模式序列化为 JSONL 输出。

事件类型以 `AgentSessionEvent` 为契约（`core/agent-session.ts`），JSON/RPC 的线格式统一由 `modes/json-event.ts` 转换。

## 5. 开发工作流

### 环境与构建

```bash
npm install --ignore-scripts   # 装依赖，不跑生命周期脚本（仓库强制习惯）
npm run build                  # 刷新模型数据后构建全部包
npm run build:offline          # 用已有模型数据构建（无网络）
./pi-test.sh                   # 从源码运行 pi（任意目录可跑，保留调用者 cwd）
```

`npm run build:binary`（在 coding-agent 内）可用 Bun 编译单文件二进制；发布流程见 AGENTS.md 的 Releasing 一节。

### 质量门

```bash
npm run check    # 完整门禁：biome + pinned-deps + ts-imports + shrinkwrap + install-lock + tsgo --noEmit + browser-smoke
./test.sh        # 非 LLM 测试（不需要 API key）；不要直接跑完整 vitest 套件
npm run eval -- --provider openai --model gpt-5.6-sol   # 行为评估（真实模型，需要凭证）
```

`npm run check` 是提交前必须全绿的门禁（`--error-on-warnings`），不是可选步骤。

### TypeScript 约束（重要，有脚本强制）

- **仅可擦除语法**（Node strip-only / tsgo 支持）：禁 parameter properties、`enum`、`namespace`、`import =` 等需要 JS 产物转换的语法。
- **顶层 import 一律带 `.ts` 扩展名**（`check-ts-relative-imports` 强制），禁内联动态 import。
- 不用 `any`（除非绝对必要）。

### 测试

- 单测用 vitest（从包根跑具体文件）：`node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/specific.test.ts`。
- coding-agent 的套件测试用 `test/suite/harness.ts` + faux provider，**不允许**真实 provider API/付费 token。
- 问题回归测试放 `packages/coding-agent/test/suite/regressions/<issue>-<slug>.test.ts`。

### 供应链纪律（提交锁文件前必读）

- 直接外部依赖**精确锁定版本**；`.npmrc` 设了 `save-exact=true` 和 `min-release-age=2`。
- `package-lock.json` 是依赖事实源；pre-commit 会挡锁文件提交，除非 `PI_ALLOW_LOCKFILE_CHANGE=1`（有意的锁文件变更才用）。
- coding-agent 发布带的 `npm-shrinkwrap.json` 由脚本生成，生命周期脚本有 allowlist，新带生命周期脚本的依赖过不了 check 直到人工评审。
- 更新 `undici` 必须先读目标版本 changelog 评估影响。

## 6. 常见开发任务

| 任务 | 从哪里开始 |
|---|---|
| 加新模型/provider | `packages/ai/scripts/generate-models.ts`（生成 `models.generated.ts`）→ `packages/ai/src/providers/` |
| 改 agent 循环行为 | `packages/agent/src/agent-loop.ts` / `agent.ts` |
| 加内置工具 | `packages/coding-agent/src/core/` 下的 executor（如 `bash-executor.ts`），或扩展系统 |
| 写扩展/技能/主题 | 参考 `packages/coding-agent/examples/` 与对应 docs |
| 改 TUI 布局 | `packages/tui/src` 组件 + `tui-plan.md`（alt 屏布局设计） |
| 改交互模式 UI | `packages/coding-agent/src/modes/interactive/` |
| 改 CLI 参数 | `packages/coding-agent/src/cli/args.ts` → `main.ts` |
| 加会话后端 | 参考 `packages/session-backends/sqlite-node/`，实现 agent-core 的后端接口 |
| 跑行为评估 | `packages/evals/`，`createPiCodingAgentHarness` + vitest-evals |

## 7. 文档地图

按阅读顺序：

1. 本仓库 `README.md`（总览 + 供应链硬化）与 `AGENTS.md`（**开发规则，人机都遵守**）。
2. `packages/coding-agent/README.md`：产品功能全景（模式、会话、设置、扩展）。
3. `packages/coding-agent/docs/index.md`：32 篇文档的导航（quickstart、usage、extensions、skills、rpc、sdk、development 等）。
4. 各包的 `README.md` 与 `docs/`（agent 的 `harness.md` 只在需要接触 harness 时读）。
5. `tui-plan.md`：alt 屏布局系统设计交接文档。
6. RFC：https://rfc.earendil.com/keyword/pi/（长期规划）。

## 8. 常见坑

- **`__dirname` 拿包资产**：三态部署（npm 安装 / 独立二进制 / tsx 源码）下路径不同，一律走 `src/config.ts` 的 `getPackageDir()` 等。
- **改 `models.generated.ts`**：手改会被下一个生成步骤冲掉；改脚本再生成。
- **跑完整 vitest**：包含会激活的 e2e（有 endpoint/auth env 时）；用 `./test.sh` 或按包单跑。
- **RPC 客户端用 `readline`**：会误切 `U+2028/2029`，不满足协议。
- **`git add -A` / `reset --hard` 等**：仓库可能多会话并行工作，只动自己改的文件，见 AGENTS.md Git 一节。
- **发布**：锁步版本、无 major；发布前先在 main 上跑 `/cl` 审计 changelog，本地 `npm run release:local` 冒烟（AGENTS.md Releasing 一节有完整清单）。
