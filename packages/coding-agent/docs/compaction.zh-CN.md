# 压缩与分支摘要

LLM 的上下文窗口有限。当对话过长时，Pi 使用压缩（compaction）来总结旧内容，同时保留近期工作。本文介绍自动压缩和分支摘要两种机制。

**源文件** ([pi-mono](https://github.com/earendil-works/pi-mono))：

- [`packages/coding-agent/src/core/compaction/compaction.ts`](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/src/core/compaction/compaction.ts) — 自动压缩逻辑
- [`packages/coding-agent/src/core/compaction/branch-summarization.ts`](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/src/core/compaction/branch-summarization.ts) — 分支摘要
- [`packages/coding-agent/src/core/compaction/utils.ts`](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/src/core/compaction/utils.ts) — 共享工具函数（文件跟踪、序列化）
- [`packages/coding-agent/src/core/session-manager.ts`](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/src/core/session-manager.ts) — 入口类型（`CompactionEntry`、`BranchSummaryEntry`）
- [`packages/coding-agent/src/core/extensions/types.ts`](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/src/core/extensions/types.ts) — 扩展事件类型

如需在你的项目中获取 TypeScript 定义，请检查 `node_modules/@earendil-works/pi-coding-agent/dist/`。

## 概述

Pi 有两种摘要机制：

| 机制 | 触发条件 | 用途 |
|------|----------|------|
| 压缩（Compaction） | 上下文超过阈值，或执行 `/compact` | 总结旧消息以释放上下文空间 |
| 分支摘要（Branch summarization） | `/tree` 导航 | 切换分支时保留上下文 |

两者使用相同的结构化摘要格式，并累计跟踪文件操作。压缩和分支摘要请求使用新的路由会话 ID，并且在提供商支持的情况下禁用 prompt-cache 写入，因为这些一次性提示不太可能被重复使用。

## 压缩（Compaction）

### 触发时机

自动压缩在以下条件满足时触发：

```
contextTokens > contextWindow - reserveTokens
```

默认情况下，`reserveTokens` 为 16384 个 token（可在 `~/.pi/agent/settings.json` 或 `<project-dir>/.pi/settings.json` 中配置）。这为 LLM 的回复留出空间。

你也可以通过 `/compact [instructions]` 手动触发，其中可选的指令用于聚焦摘要内容。

### 工作原理

1. **查找切点**：从最新消息向后遍历，累积 token 估算值，直到达到 `keepRecentTokens`（默认 20k，可在 `~/.pi/agent/settings.json` 或 `<project-dir>/.pi/settings.json` 中配置）
2. **提取消息**：收集从前一个保留边界（或会话开始）到切点的消息
3. **生成摘要**：调用 LLM 以结构化格式生成摘要；如果存在之前的摘要，则将其作为迭代上下文传入
4. **追加条目**：保存带有摘要和 `firstKeptEntryId` 的 `CompactionEntry`
5. **重建上下文**：会话为下一次请求重建上下文，使用摘要 + 从 `firstKeptEntryId` 开始的后续消息

```
压缩前：

  entry:  0     1     2     3      4     5     6      7      8     9
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬─────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool│
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴─────┘
                └────────┬───────┘ └──────────────┬──────────────┘
               messagesToSummarize            kept messages
                                   ↑
                          firstKeptEntryId (entry 4)

压缩后（新增条目）：

  entry:  0     1     2     3      4     5     6      7      8     9     10
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬─────┬─────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool│ cmp │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴─────┴─────┘
               └──────────┬──────┘ └──────────────────────┬───────────────────┘
                 not sent to LLM                    sent to LLM
                                                         ↑
                                              starts from firstKeptEntryId

LLM 所见内容：

  ┌────────┬─────────┬─────┬─────┬──────┬──────┬─────┬──────┐
  │ system │ summary │ usr │ ass │ tool │ tool │ ass │ tool │
  └────────┴─────────┴─────┴─────┴──────┴──────┴─────┴──────┘
       ↑         ↑      └─────────────────┬────────────────┘
    prompt   from cmp          messages from firstKeptEntryId
```

多次压缩时，被摘要的部分从前一次压缩的保留边界（`firstKeptEntryId`）开始，而不是从压缩条目本身开始；如果找不到前次压缩的保留条目，则回退到前次压缩之后的那个条目。这样可以保留在前次压缩中幸存的消息，将它们纳入下一轮摘要中。Pi 还会在写入新 `CompactionEntry` 之前，从重建的会话上下文中重新计算 `tokensBefore`，因此该 token 计数反映的是实际被替换的压缩前上下文。

### 分割轮次（Split Turns）

一个"轮次（turn）"以用户消息开头，包含所有助手响应和工具调用，直到下一个用户消息。通常，压缩在轮次边界处切断。

当单个轮次超过 `keepRecentTokens` 时，切点会落在轮次中间的助手消息处。这就是"分割轮次"：

```
分割轮次（一个巨大的轮次超出预算）：

  entry:  0     1     2      3     4      5      6     7      8
        ┌─────┬─────┬─────┬──────┬─────┬──────┬──────┬─────┬──────┐
        │ hdr │ usr │ ass │ tool │ ass │ tool │ tool │ ass │ tool │
        └─────┴─────┴─────┴──────┴─────┴──────┴──────┴─────┴──────┘
                ↑                                     ↑
         turnStartIndex = 1                  firstKeptEntryId = 7
                │                                     │
                └──── turnPrefixMessages (1-6) ───────┘
                                                      └── kept (7-8)

  isSplitTurn = true
  messagesToSummarize = []  （没有完整的轮次在前）
  turnPrefixMessages = [usr, ass, tool, ass, tool, tool]
```

对于分割轮次，Pi 生成两个摘要并合并：

1. **历史摘要**：之前的上下文（如果有）
2. **轮次前缀摘要**：分割轮次的早期部分

### 切点规则

有效的切点是：

- 用户消息
- 助手消息
- BashExecution 消息
- 自定义消息（custom_message、branch_summary）

永远不要在工具结果处切断（它们必须与其工具调用保持在一起）。

### CompactionEntry 结构

定义在 [`session-manager.ts`](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/src/core/session-manager.ts) 中：

```typescript
interface CompactionEntry<T = unknown> {
  type: "compaction";
  id: string;
  parentId: string;
  timestamp: number;
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  usage?: Usage;       // 生成摘要所使用的 LLM 用量
  fromHook?: boolean;  // 如果由扩展提供则为 true（遗留字段名）
  details?: T;         // 实现特定的数据
}

// 默认压缩使用此结构作为 details（来自 compaction.ts）：
interface CompactionDetails {
  readFiles: string[];
  modifiedFiles: string[];
}
```

扩展可以在 `details` 中存储任何可 JSON 序列化的数据。默认压缩会跟踪文件操作，但自定义扩展实现可以使用自己的结构。生成的和扩展提供的摘要会在可用时存储其 LLM `usage`，以便会话总量包含摘要工作。

参见 [`prepareCompaction()`](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/src/core/compaction/compaction.ts) 和 [`compact()`](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/src/core/compaction/compaction.ts)。对于直接编程式摘要，`generateSummary()` 返回摘要文本，`generateSummaryWithUsage()` 返回 `{ text, usage }`。

## 分支摘要（Branch Summarization）

### 触发时机

当你使用 `/tree` 导航到不同分支时，Pi 会提议总结你即将离开的分支工作。这将左侧分支的上下文注入到新分支中。

### 工作原理

1. **查找共同祖先**：旧位置和新位置共享的最深节点
2. **收集条目**：从旧叶节点回溯到共同祖先
3. **按预算准备**：包含不超过 token 预算的消息（从最新的开始）
4. **生成摘要**：以结构化格式调用 LLM
5. **追加条目**：在导航点保存 `BranchSummaryEntry`

```
导航前的树：

         ┌─ B ─ C ─ D （旧叶节点，即将被废弃）
    A ───┤
         └─ E ─ F （目标分支）

共同祖先：A
需要摘要的条目：B, C, D

导航后带摘要的树：

         ┌─ B ─ C ─ D
    A ───┤
         └─ E ─ F ─ [B,C,D 的摘要] （新叶节点）
```

### 累计文件跟踪

压缩和分支摘要都会累计跟踪文件。在生成摘要时，Pi 会从以下来源提取文件操作：

- 被摘要消息中的工具调用
- 之前的压缩或分支摘要 `details`（如果有）

这意味着文件跟踪会在多次压缩或嵌套的分支摘要中累积，保留完整的读写文件历史记录。

### BranchSummaryEntry 结构

定义在 [`session-manager.ts`](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/src/core/session-manager.ts) 中：

```typescript
interface BranchSummaryEntry<T = unknown> {
  type: "branch_summary";
  id: string;
  parentId: string;
  timestamp: number;
  summary: string;
  fromId: string;      // 我们从哪个条目进行导航
  usage?: Usage;       // 生成摘要所使用的 LLM 用量
  fromHook?: boolean;  // 如果由扩展提供则为 true（遗留字段名）
  details?: T;         // 实现特定的数据
}

// 默认分支摘要使用此结构作为 details（来自 branch-summarization.ts）：
interface BranchSummaryDetails {
  readFiles: string[];
  modifiedFiles: string[];
}
```

与压缩相同，扩展可以在 `details` 中存储自定义数据。

参见 [`collectEntriesForBranchSummary()`](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/src/core/compaction/branch-summarization.ts)、[`prepareBranchEntries()`](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/src/core/compaction/branch-summarization.ts) 和 [`generateBranchSummary()`](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/src/core/compaction/branch-summarization.ts)。

## 摘要格式

压缩和分支摘要使用相同的结构化格式：

```markdown
## Goal
[用户试图完成的工作]

## Constraints & Preferences
- [用户提到的要求]

## Progress
### Done
- [x] [已完成的任务]

### In Progress
- [ ] [当前工作]

### Blocked
- [问题（如果有）]

## Key Decisions
- **[决策]**：[理由]

## Next Steps
1. [接下来应该做什么]

## Critical Context
- [继续所需的数据]

<read-files>
path/to/file1.ts
path/to/file2.ts
</read-files>

<modified-files>
path/to/changed.ts
</modified-files>
```

### 消息序列化

在摘要之前，消息通过 [`serializeConversation()`](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/src/core/compaction/utils.ts) 序列化为文本：

```
[User]: 用户说的话
[Assistant thinking]: 内部推理
[Assistant]: 回复文本
[Assistant tool calls]: read(path="foo.ts"); edit(path="bar.ts", ...)
[Tool result]: 工具输出
```

这样可以防止模型将其视为可以继续进行的对话。

工具结果在序列化时被截断为 2000 个字符。超出此限制的内容会被替换为一个标记，指示截断了多少个字符。这使摘要请求保持在合理的 token 预算内，因为工具结果（尤其是 `read` 和 `bash` 的结果）通常是上下文大小最大的贡献者。

## 通过扩展进行自定义摘要

扩展可以拦截和定制压缩与分支摘要。有关事件类型定义，请参阅 [`extensions/types.ts`](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/src/core/extensions/types.ts)。

### session_before_compact

在自动压缩或 `/compact` 之前触发。可以取消或提供自定义摘要。请参阅类型文件中的 `SessionBeforeCompactEvent` 和 `CompactionPreparation`。

```typescript
pi.on("session_before_compact", async (event, ctx) => {
  const { preparation, branchEntries, customInstructions, reason, willRetry, signal } = event;

  // preparation.messagesToSummarize — 需要摘要的消息
  // preparation.turnPrefixMessages — 分割轮次的前缀（如果 isSplitTurn）
  // preparation.previousSummary — 之前的压缩摘要
  // preparation.fileOps — 提取的文件操作
  // preparation.tokensBefore — 压缩前的上下文 token
  // preparation.firstKeptEntryId — 保留消息的开始位置
  // preparation.settings — 压缩设置

  // branchEntries — 当前分支上的所有条目（用于自定义状态）
  // reason — "manual"（/compact）、"threshold" 或 "overflow"
  // willRetry — 中止的轮次是否在压缩后重试（溢出恢复）
  // signal — AbortSignal（传递给 LLM 调用）

  // 取消：
  return { cancel: true };

  // 自定义摘要：
  return {
    compaction: {
      summary: "你的摘要...",
      firstKeptEntryId: preparation.firstKeptEntryId,
      tokensBefore: preparation.tokensBefore,
      // usage: summaryResponse.usage, // 可选；会计入会话总量
      details: { /* 自定义数据 */ },
    }
  };
});
```

#### 将消息转换为文本

要使用你自己的模型生成摘要，请使用 `serializeConversation` 将消息转换为文本：

```typescript
import { convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";

pi.on("session_before_compact", async (event, ctx) => {
  const { preparation } = event;
  
  // 将 AgentMessage[] 转换为 Message[]，然后序列化为文本
  const conversationText = serializeConversation(
    convertToLlm(preparation.messagesToSummarize)
  );
  // 返回：
  // [User]: message text
  // [Assistant thinking]: thinking content
  // [Assistant]: response text
  // [Assistant tool calls]: read(path="..."); bash(command="...")
  // [Tool result]: output text

  // 现在发送到你的模型进行摘要
  const { summary, usage } = await myModel.summarize(conversationText);
  
  return {
    compaction: {
      summary,
      firstKeptEntryId: preparation.firstKeptEntryId,
      tokensBefore: preparation.tokensBefore,
      usage,
    }
  };
});
```

参见 [custom-compaction.ts](../examples/extensions/custom-compaction.ts)，这是一个使用不同模型的完整示例。

### session_compact_failed

当手动或自动压缩失败或被中止时触发。这对于遥测扩展很有用，这些扩展需要将 `session_before_compact` 尝试与最终结果配对。

```typescript
pi.on("session_compact_failed", async (event, ctx) => {
  const { reason, errorMessage, aborted, willRetry, fromExtension } = event;
  // reason — "manual"（/compact）、"threshold" 或 "overflow"
  // errorMessage — 非中止失败时存在
  // aborted — 取消/中止的压缩为 true
  // willRetry — 中止的轮次是否会在压缩后重试
  // fromExtension — 是否正在使用扩展提供的压缩内容
});
```

### session_before_tree

在 `/tree` 导航之前触发。无论用户是否选择摘要，始终触发。可以取消导航或提供自定义摘要。

```typescript
pi.on("session_before_tree", async (event, ctx) => {
  const { preparation, signal } = event;

  // preparation.targetId — 导航到的位置
  // preparation.oldLeafId — 当前位置（即将被废弃）
  // preparation.commonAncestorId — 共同祖先
  // preparation.entriesToSummarize — 将被摘要的条目
  // preparation.userWantsSummary — 用户是否选择摘要

  // 完全取消导航：
  return { cancel: true };

  // 提供自定义摘要（仅当 userWantsSummary 为 true 时使用）：
  if (preparation.userWantsSummary) {
    return {
      summary: {
        summary: "你的摘要...",
        // usage: summaryResponse.usage, // 可选；会计入会话总量
        details: { /* 自定义数据 */ },
      }
    };
  }
});
```

请参阅类型文件中的 `SessionBeforeTreeEvent` 和 `TreePreparation`。

## 设置

在 `~/.pi/agent/settings.json` 或 `<project-dir>/.pi/settings.json` 中配置压缩：

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  }
}
```

| 设置项 | 默认值 | 描述 |
|--------|--------|------|
| `enabled` | `true` | 启用自动压缩 |
| `reserveTokens` | `16384` | 为 LLM 回复预留的 token 数 |
| `keepRecentTokens` | `20000` | 保留的最近 token 数（不摘要） |

使用 `"enabled": false` 禁用自动压缩。你仍然可以通过 `/compact` 手动压缩。
