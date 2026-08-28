#!/usr/bin/env node
/**
 * CLI entry point for the refactored coding agent.
 * Uses main.ts with AgentSession and new mode modules.
 *
 * Test with: npx tsx src/cli-new.ts [args...]
 *
 * ============================================================
 * 核心链路总览（以 `pi -p "prompt"` 单次执行模式为主线）：
 *
 *   pi -p "prompt"
 *     └─ cli.ts                 进程初始化，调用 main(argv)
 *         └─ main.ts            参数解析 → 模式判定 → 会话/模型/工具解析
 *                               → 组装初始 prompt → 创建运行时 → 分发模式
 *             ├─ cli/args.ts            parseArgs：把 argv 解析成结构化 Args
 *             ├─ cli/initial-message.ts buildInitialMessage：stdin + @file
 *             │                          + 首条消息 合并为初始 prompt
 *             ├─ core/agent-session-services.ts   创建 cwd 绑定服务
 *             │                          （ModelRuntime/Settings/ResourceLoader）
 *             ├─ core/sdk.ts            createAgentSession：选模型/thinking/工具
 *             │                          → new Agent → new AgentSession
 *             └─ modes/print-mode.ts    单次执行：session.prompt() → 输出回复
 *                 └─ core/agent-session.ts  prompt()：命令/模板展开 → 校验
 *                     │                      → 组装 user 消息 → agent.prompt()
 *                     └─ packages/agent/src/agent.ts     Agent 状态机 + 事件分发
 *                         └─ packages/agent/src/agent-loop.ts  循环：LLM 流式响应
 *                             │                      → 工具执行 → 队列消息 → 再循环
 *                             └─ core/model-runtime.ts streamSimple → pi-ai → LLM API
 * ============================================================
 */
import { APP_NAME } from "./config.ts";
import { configureHttpDispatcher } from "./core/http-dispatcher.ts";
import { main } from "./main.ts";

// 把进程名改成 "pi"（ps/htop 里看到的进程名）。
// process 是 Node.js 的全局对象，不需要 import。
process.title = APP_NAME;
// 设置环境变量，向子进程和被加载的扩展声明“当前运行在 pi 编码代理里”。
process.env.PI_CODING_AGENT = "true";
process.env.AI_AGENT = "pi";
// 屏蔽 Node 运行时的弃用警告，避免污染终端输出（TUI 需要独占 stdout）。
process.emitWarning = (() => {}) as typeof process.emitWarning;

// Configure undici's global dispatcher before provider SDKs issue requests.
// Runtime settings are applied once SettingsManager has loaded global/project settings.
// 在任何 LLM Provider SDK 发请求之前，先配置全局 HTTP 调度器（连接池/代理等）。
// undici 是 Node.js 内置 fetch 底层使用的 HTTP 客户端。
configureHttpDispatcher();

// 把命令行参数（process.argv 的第 3 个起，前两个是 node 路径和脚本路径）
// 交给 main.ts 的 main() 处理，整个链路从这里进入。
main(process.argv.slice(2));
