# Pi 项目接手文档

> 快速理解 Pi 的设计、架构和目标用户，以便快速上手开发。

---

## 项目定位

Pi 是一个**编码代理（coding agent）的 Agent Harness 项目**，核心产品是 `pi` 命令行工具——一个交互式、自扩展的编码代理，能够在终端中与开发者协作完成代码编写、文件操作、shell 命令执行等开发任务。

**目标用户**：软件开发者和运维工程师，特别是需要在终端中与 AI 模型协作完成编程任务的用户。用户通过自然语言或命令与 Pi 交互，Pi 则调用 LLM 并执行工具来完成任务。

**项目官网**: https://pi.dev

---

## 架构总览

Pi 是一个 monorepo，代码位于 `packages/` 下，包含 10 个包，依赖关系如下:

```
@earendil-works/pi-tui        (终端 UI 渲染库)
       |
@earendil-works/pi-telemetry  (遥测契约)
       |
@earendil-works/pi-ai         (统一多提供商 LLM API)
       |
@earendil-works/pi-agent-core (代理运行时 + 工具调用 + 状态管理)
       |
@earendil-works/pi-coding-agent (CLI 入口 + 会话管理 + 模式)
       |
@earendil-works/pi-protocol   (CBOR 远程会话协议)
       |
@earendil-works/pi-client     (远程会话客户端)
       |
@earendil-works/pi-server     (实验性远程会话服务器)
```

### 各包职责

| 包 | 职责 | 关键概念 |
|---|---|---|
| `pi-tui` | 终端 UI 库，差分渲染 | `Component`, `TUI`, `Keybinding`, `Markdown`, `EditorComponent` |
| `pi-telemetry` | 厂商无关的遥测契约和类型 schema | `TelemetryContext`, `Span` |
| `pi-ai` | 统一 LLM API，自动模型发现，30+ 提供商 | `Model`, `Api`, `Provider`, `Models`, `streamSimple` |
| `pi-agent-core` | 通用代理运行时，工具调用循环，状态管理 | `Agent`, `AgentTool`, `AgentLoopConfig`, `AgentEvent`, `AgentMessage`, `AgentState` |
| `pi-coding-agent` | 编码代理 CLI，包含交互模式、会话管理、扩展系统 | `AgentSession`, `AgentHarness`, `InteractiveMode`, `SettingsManager`, `ExtensionRunner` |
| `pi-protocol` | CBOR 编码的远程会话协议 | `ProtocolMessage`, `SessionPhase`, `ModelRef` |
| `pi-client` | 远程会话客户端（Unix socket） | `ClientSessionHandle`, `Connection` |
| `pi-server` | 实验性远程会话服务器 | `Server`, `SessionListener` |
| `pi-evals` | 评估系统（私有） | 基于 `vitest-evals` 的评估框架 |
| `session-backends/sqlite-node` | SQLite 会话后端 | 会话持久化 |

---

## 核心数据流

```
用户输入 (CLI/TUI/RPC)
    |
    v
AgentSession  -- 接收消息，管理会话生命周期
    |
    v
Agent (agent-core)  -- 运行 agent loop
    |  - 将消息转换为 LLM 格式
    |  - 调用 LLM (streamSimple)
    |  - 解析工具调用
    |  - 执行工具
    |  - 将结果返回 LLM
    |  - 循环直到停止
    |
    v
TUI (交互模式)  /  JSON (print模式)  /  RPC (远程模式)
    |
    v
用户看到结果
```

### Agent Loop 关键事件流

`AgentEvent` 定义了完整的事件序列:

```
agent_start
  turn_start
    message_start (user prompt)
    message_start (assistant)
    message_update (streaming tokens)
    tool_execution_start
    tool_execution_update
    tool_execution_end
    message_end
    turn_end
  (重复直到结束)
agent_end -> messages[]
```

---

## 关键设计决策

### 1. 最小核心 + 扩展系统

核心功能最小化，所有非核心功能通过扩展（extension）实现。

扩展机制位于 `packages/coding-agent/src/core/extensions/`，支持:
- 生命周期钩子（`onStart`, `onMessageEnd`, `onToolExecutionEnd` 等）
- 自定义工具注册
- 自定义 Provider 注册
- 事件订阅

示例扩展位于 `packages/coding-agent/examples/extensions/`。

### 2. 多提供商 LLM 统一 API

`pi-ai` 封装了 30+ LLM 提供商，统一为 `Api` 接口:
- `openai-responses` / `openai-completions`
- `anthropic-messages`
- `google-generative-ai`
- `bedrock-converse-stream`
- 等等

每个提供商在 `packages/ai/src/providers/` 下有独立的 `.ts` 文件，包含:
- `xxx.models.ts`: 模型数据（生成）
- `xxx.ts`: Provider 实现（工厂函数）

模型数据自动生成: `npm run generate:models` 从各提供商实时 API 拉取模型列表，生成 `models.generated.ts`。发布时使用离线快照。

### 3. 差分渲染 TUI

`pi-tui` 实现了差分渲染（differential rendering）——每次渲染只发送变化的部分到终端，避免全量重绘。组件树通过 `Component.render(width)` 接口实现。

### 4. 会话系统

会话（session）是 Pi 的核心状态管理单元，存储在 `~/.pi/agent/sessions/` 或项目级 `.pi/sessions/` 下，格式为 JSONL。

支持功能:
- 会话分支（branching）
- 压缩（compaction，自动总结旧消息以节省 token）
- 分支摘要（branch summary）
- 导出为 HTML
- 远程访问（通过 RPC 协议）

### 5. 供应链安全

- 外部依赖全部锁定精确版本
- `package-lock.json` 是依赖权威来源
- 发布前生成本地安装测试
- `npm run check` 验证依赖、类型、lint
- CI 使用 `--ignore-scripts` 安装

---

## 代码组织

### `packages/coding-agent/src/` 结构

```
src/
  cli.ts              # CLI 入口
  main.ts             # 主流程: 参数解析、模式选择、初始化
  config.ts           # 路径、版本、安装方法检测
  migrations.ts       # 配置迁移
  package-manager-cli.ts  # 包管理命令

  core/
    agent-session.ts          # 核心会话抽象（~3400 行）
    agent-session-runtime.ts  # 会话运行时
    agent-session-services.ts # 会话服务工厂
    sdk.ts                    # SDK 入口（createAgentSession）
    settings-manager.ts       # 设置管理（JSON 配置）
    model-resolver.ts         # 模型解析
    model-runtime.ts          # 模型运行时（API 密钥管理）
    model-registry.ts         # 模型注册表
    session-manager.ts        # 会话文件管理
    compaction/               # 压缩逻辑
    tools/                    # 内置工具实现
      read.ts, write.ts, edit.ts, edit-diff.ts
      bash.ts, powershell.ts
      grep.ts, find.ts, ls.ts
      index.ts                # 工具导出
    extensions/               # 扩展系统
      types.ts, loader.ts, runner.ts, wrapper.ts
    auth-storage.ts           # API 密钥存储
    bash-executor.ts          # Bash 执行器
    event-bus.ts              # 事件总线
    keybindings.ts            # 按键绑定
    prompt-templates.ts       # 提示模板
    skills.ts                 # 技能系统
    slash-commands.ts         # 斜杠命令
    export-html/              # HTML 导出
    http-dispatcher.ts        # HTTP 代理

  modes/
    interactive/              # 交互模式（TUI）
      interactive-mode.ts     # 主交互逻辑（~6500 行）
      components/             # TUI 组件
      theme/                  # 主题系统
      assets/                 # 资源图片
    print-mode.ts             # 打印模式（非交互）
    rpc/                      # RPC 模式
    json-event.ts             # JSON 事件输出

  extensions/                 # 内置扩展
    llama/                    # llama.cpp 支持

  bun/                        # Bun 运行时入口
  client/                     # 远程客户端
  server/                     # 远程服务器
  utils/                      # 工具函数
```

### `packages/agent/src/` 结构

```
src/
  agent.ts        # Agent 类（状态管理 + 循环入口）
  agent-loop.ts   # 低级别 agent loop 实现
  types.ts        # 核心类型定义（~400 行）
  stream-fn.ts    # 流函数
  proxy.ts        # 代理
  search/         # 搜索功能
  harness/        # AgentHarness（高级抽象）
    agent-harness.ts  # 多会话、多通道、认证管理
    session/          # 会话接口
    compaction/       # 压缩
    tools/            # 工具定义
    events.ts         # 事件
    messages.ts       # 消息
    ...
```

---

## 构建与开发

### 快速开始

```bash
npm install --ignore-scripts
npm run build
npm run check
./pi-test.sh    # 从源码运行 pi
```

### 关键脚本

| 命令 | 用途 |
|---|---|
| `npm run build` | 构建所有包（先刷新模型数据） |
| `npm run build:offline` | 使用现有模型数据离线构建 |
| `npm run check` | lint + 格式化 + 类型检查 + 依赖检查 |
| `npm run generate:models` | 从提供商 API 拉取模型数据 |
| `./test.sh` | 运行测试（跳过需要 API key 的测试） |
| `./pi-test.sh` | 从源码运行 pi CLI |

### 构建独立二进制

```bash
./scripts/build-binaries.sh --offline-model-data --platform linux-x64 --out "$PWD/out"
```

### 发布流程

锁步版本（lockstep versioning）: 所有包共享一个版本号。

1. 运行 `/cl` 提示更新 CHANGELOG
2. 本地构建和冒烟测试: `npm run release:local -- --out /tmp/pi-local-release --force`
3. 发布: `PI_ALLOW_LOCKFILE_CHANGE=1 npm run release:patch`（补丁）或 `release:minor`（破坏性变更）
4. CI 自动发布到 npm 并更新版本公告

---

## 配置系统

### 配置文件层级

1. 全局配置: `~/.pi/agent/settings.json`
2. 项目配置: `<project>/.pi/settings.json`（合并覆盖全局）

### 关键配置项

```json
{
  "defaultModel": "anthropic:claude-sonnet-4-20250514",
  "thinkingLevel": "medium",
  "defaultTools": ["read", "bash", "edit", "write", "grep", "ls", "find"],
  "terminal": { "showImages": true },
  "retry": { "enabled": true, "maxRetries": 3 },
  "compaction": { "enabled": true, "reserveTokens": 16384 }
}
```

### 环境变量

- `PI_ALLOW_LOCKFILE_CHANGE=1`: 允许提交 lockfile 变更
- `PI_DISABLE_EXTENSION_PACKAGES=1`: 禁用扩展包
- 更多见 `docs/environment-variables.md`

---

## 扩展系统

扩展是 Pi 的核心扩展机制，通过 `~/.pi/agent/extensions/` 或项目级 `.pi/extensions/` 加载。

扩展可以:
- 注册自定义工具（AgentTool）
- 注册自定义 LLM 提供商
- 监听事件（message_end, tool_execution_end 等）
- 提供自定义 UI 组件

### 扩展开发

```typescript
// 示例扩展
export default {
  async onStart(ctx) {
    ctx.setTools([...ctx.getTools(), myCustomTool]);
  },
  async onMessageEnd(ctx, event) {
    console.log("Message ended:", event.message.role);
  }
};
```

详见 `packages/coding-agent/docs/extensions.md` 和 `examples/extensions/`。

---

## 测试

### 测试框架

- `packages/agent` 和 `packages/ai`: vitest
- `packages/tui`: `node:test`
- `packages/coding-agent`: vitest

### 测试规范

```bash
# 运行所有非 e2e 测试
./test.sh

# 运行特定测试文件
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/specific.test.ts

# packages/tui (node:test)
node --test test/specific.test.ts
```

### 测试工具

- `packages/coding-agent/test/suite/harness.ts` + 假 provider（无需真实 API key）
- 回归测试放在 `test/suite/regressions/<issue-number>-<short-slug>.test.ts`

---

## 关键钩子与扩展点

| 钩子/扩展点 | 位置 | 用途 |
|---|---|---|
| `AgentLoopConfig.beforeToolCall` | `agent-core` | 在工具执行前拦截/阻止 |
| `AgentLoopConfig.afterToolCall` | `agent-core` | 修改工具执行结果 |
| `AgentLoopConfig.shouldStopAfterTurn` | `agent-core` | 控制何时停止循环 |
| `AgentLoopConfig.getSteeringMessages` | `agent-core` | 注入引导消息 |
| `AgentLoopConfig.prepareNextTurn` | `agent-core` | 修改下一轮上下文 |
| `ExtensionRunner` hooks | `coding-agent` | 扩展生命周期: onStart, onMessageEnd, onToolExecutionEnd 等 |
| `AgentHarness` | `agent-core/harness` | 高级抽象: 多会话、多通道、认证管理 |

---

## 常见开发任务

### 添加新 LLM 提供商

参考 `packages/ai/src/providers/` 中现有实现，需要:
1. 实现 Provider 接口（工厂函数）
2. 实现 API 适配器（在 `packages/ai/src/api/` 下）
3. 添加模型数据（生成或手动）
4. 在 `all.ts` 中注册
5. 在 `types.ts` 的 `KnownProvider` 和 `KnownApi` 中注册

详见 `packages/coding-agent/docs/providers.md` 和 `.pi/skills/add-llm-provider.md`。

### 添加新工具

在 `packages/coding-agent/src/core/tools/` 下创建，需要:
1. 定义工具输入/输出类型
2. 实现 `createXxxTool` 工厂函数
3. 在 `tools/index.ts` 中导出
4. 在 SDK 中注册

### 修改 agent loop 行为

在 `packages/agent/src/agent-loop.ts` 中，核心循环逻辑:

```
runAgentLoop():
  1. 添加 prompt 消息到 context
  2. 调用 LLM -> assistant message
  3. 解析 tool calls
  4. 对每个 tool call: 执行 beforeToolCall -> execute -> afterToolCall
  5. 将结果放回 context
  6. 调用 shouldStopAfterTurn / getSteeringMessages / getFollowUpMessages
  7. 决定是否继续循环
```

---

## 代码风格

- TypeScript strict mode, erasable syntax only（无 `enum`, `namespace`, 参数属性等）
- Biome 格式化: tab 缩进，宽度 120
- 无 `any` 除非绝对必要
- 顶层 import，禁止 inline import
- 依赖精确版本锁定

---

## 其他重要资源

| 资源 | 位置 |
|---|---|
| AGENTS.md（开发规则） | 根目录 |
| CONTRIBUTING.md（贡献指南） | 根目录 |
| 文档 | `packages/coding-agent/docs/` |
| 扩展示例 | `packages/coding-agent/examples/extensions/` |
| RFCs | https://rfc.earendil.com/keyword/pi/ |
| Discord | https://discord.com/invite/3cU7Bz4UPx |