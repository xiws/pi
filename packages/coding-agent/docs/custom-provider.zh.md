# 自定义提供商

扩展可以通过 `pi.registerProvider()` 注册自定义模型提供商。这能够支持：

- **代理** - 将请求通过企业代理或 API 网关转发
- **自定义端点** - 使用自托管或私有的模型部署
- **OAuth/SSO** - 为企业管理提供商添加认证流程
- **自定义 API** - 为非标准 LLM API 实现流式传输

## 示例扩展

查看这些完整的提供商示例：

- [`examples/extensions/custom-provider-anthropic/`](../examples/extensions/custom-provider-anthropic/)
- [`examples/extensions/custom-provider-gitlab-duo/`](../examples/extensions/custom-provider-gitlab-duo/)

## 目录

- [示例扩展](#example-extensions)
- [快速参考](#quick-reference)
- [覆盖现有提供商](#override-existing-provider)
- [注册新提供商](#register-new-provider)
- [注销提供商](#unregister-provider)
- [OAuth 支持](#oauth-support)
- [自定义流式 API](#custom-streaming-api)
- [上下文溢出错误](#context-overflow-errors)
- [测试你的实现](#testing-your-implementation)
- [配置参考](#config-reference)
- [模型定义参考](#model-definition-reference)

## 快速参考

扩展可以注册完整的 pi-ai `Provider`，或使用遗留的 provider-config 形式。当需要自定义认证、过滤、刷新或流式传输行为时，优先使用完整提供商。Pi 将 `models.json` 覆盖合并到已注册的本地提供商之上。

```typescript
import { createProvider, openAICompletionsApi } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerProvider(createProvider({
    id: "native-local",
    name: "Native Local",
    baseUrl: "http://localhost:8080/v1",
    auth: {
      apiKey: {
        name: "本地服务器 API 密钥",
        async login(interaction) {
          return {
            type: "api_key",
            key: await interaction.prompt({ type: "secret", message: "API 密钥" })
          };
        },
        async resolve({ credential }) {
          return credential?.key
            ? { auth: { apiKey: credential.key }, source: "已存储的 API 密钥" }
            : undefined;
        }
      }
    },
    models: [],
    api: openAICompletionsApi()
  }));

  // 遗留 provider-config 形式：
  // 覆盖现有提供商的 baseUrl
  pi.registerProvider("anthropic", {
    baseUrl: "https://proxy.example.com"
  });

  // 带模型注册新提供商
  pi.registerProvider("my-provider", {
    name: "我的提供商",
    baseUrl: "https://api.example.com",
    apiKey: "$MY_API_KEY",
    api: "openai-completions",
    models: [
      {
        id: "my-model",
        name: "我的模型",
        reasoning: false,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096
      }
    ]
  });
}
```

扩展工厂也可以是 `async` 的。对于动态模型发现，在工厂中获取并注册模型，而不是在 `session_start` 中。Pi 会等待工厂完成，因此提供商在交互式启动期间以及 `pi --list-models` 时都可用。

## 覆盖现有提供商

最简单的用例：通过代理重定向现有提供商。

```typescript
// 所有 Anthropic 请求现在都通过你的代理转发
pi.registerProvider("anthropic", {
  baseUrl: "https://proxy.example.com"
});

// 为 OpenAI 请求添加自定义标头
pi.registerProvider("openai", {
  headers: {
    "X-Custom-Header": "value"
  }
});

// baseUrl 和标头都设置
pi.registerProvider("google", {
  baseUrl: "https://ai-gateway.corp.com/google",
  headers: {
    "X-Corp-Auth": "$CORP_AUTH_TOKEN"  // 环境变量或字面量
  }
});
```

当只提供 `baseUrl` 和/或 `headers`（没有 `models`）时，会保留该提供商的所有现有模型，仅更新端点。

## 注册新提供商

要添加一个完全新的提供商，请指定 `models` 以及必需的配置。

如果模型列表来自远程端点，请使用异步扩展工厂：

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default async function (pi: ExtensionAPI) {
  const response = await fetch("http://localhost:1234/v1/models");
  const payload = (await response.json()) as {
    data: Array<{
      id: string;
      name?: string;
      context_window?: number;
      max_tokens?: number;
    }>;
  };

  pi.registerProvider("local-openai", {
    baseUrl: "http://localhost:1234/v1",
    apiKey: "$LOCAL_OPENAI_API_KEY",
    api: "openai-completions",
    models: payload.data.map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: model.context_window ?? 128000,
      maxTokens: model.max_tokens ?? 4096,
    })),
  });
}
```

这会在启动完成之前注册获取的模型。

```typescript
pi.registerProvider("my-llm", {
  baseUrl: "https://api.my-llm.com/v1",
  apiKey: "$MY_LLM_API_KEY",  // 环境变量引用
  api: "openai-completions",  // 使用哪个流式 API
  models: [
    {
      id: "my-llm-large",
      name: "我的 LLM 大型",
      reasoning: true,        // 支持扩展思考
      input: ["text", "image"],
      cost: {
        input: 3.0,           // 每百万令片的美元
        output: 15.0,
        cacheRead: 0.3,
        cacheWrite: 3.75
      },
      contextWindow: 200000,
      maxTokens: 16384
    }
  ]
});
```

当提供 `models` 时，它会**替换**该提供商的所有现有模型。

`apiKey` 和自定义标头值使用与 `models.json` 相同的配置值语法：以 `!command` 开头会执行整个值的命令，`$ENV_VAR` 和 `${ENV_VAR}` 会插值环境变量，`$$` 会输出字面量 `$`，`$!` 会输出字面量 `!`。

## 注销提供商

使用 `pi.unregisterProvider(name)` 删除之前通过 `pi.registerProvider(name, ...)` 注册的提供商：

```typescript
// 注册
pi.registerProvider("my-llm", {
  baseUrl: "https://api.my-llm.com/v1",
  apiKey: "$MY_LLM_API_KEY",
  api: "openai-completions",
  models: [
    {
      id: "my-llm-large",
      name: "我的 LLM 大型",
      reasoning: true,
      input: ["text", "image"],
      cost: { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
      contextWindow: 200000,
      maxTokens: 16384
    }
  ]
});

// 稍后，删除它
pi.unregisterProvider("my-llm");
```

注销会删除该提供商的动态模型、API 密钥回退、OAuth 提供商注册以及自定义流处理函数注册。任何被覆盖的内置模型或提供商行为都会恢复。

在初始扩展加载阶段之后发起的调用会立即应用，因此不需要 `/reload`。

### API 类型

`api` 字段决定使用哪个流式实现：

| API | 用途 |
|-----|------|
| `anthropic-messages` | Anthropic Claude API 及兼容 API |
| `openai-completions` | OpenAI Chat Completions API 及兼容 API |
| `openai-responses` | OpenAI Responses API |
| `azure-openai-responses` | Azure OpenAI Responses API |
| `openai-codex-responses` | OpenAI Codex Responses API |
| `mistral-conversations` | 原生 Mistral Chat Completions 流式传输 |
| `google-generative-ai` | Google Generative AI API |
| `google-vertex` | Google Vertex AI API |
| `bedrock-converse-stream` | Amazon Bedrock Converse API |

大多数 OpenAI 兼容提供商可使用 `openai-completions`。使用模型级别的 `thinkingLevelMap` 处理模型特定的思考级别，并使用 `compat` 处理提供商的特定行为。`xhigh` 和 `max` 级别是可选的，需要非空的映射条目，并且可能被不支持的空值分隔：

```typescript
models: [{
  id: "custom-model",
  // ...
  reasoning: true,
  thinkingLevelMap: {              // 将 pi 级别映射到提供商值；null 表示该级别不支持
    minimal: null,
    low: null,
    medium: null,
    high: "default",
    xhigh: null,
    max: "max"
  },
  compat: {
    supportsDeveloperRole: false,   // 使用 "system" 而不是 "developer"
    supportsReasoningEffort: true,
    maxTokensField: "max_tokens",   // 而不是 "max_completion_tokens"
    requiresToolResultName: true,   // 工具结果需要 name 字段
    thinkingFormat: "qwen",        // 顶层 enable_thinking: true
    cacheControlFormat: "anthropic" // Anthropic 风格的 cache_control 标记
  }
}]
```

为 OpenRouter 风格的 `reasoning: { effort }` 控件使用 `openrouter`。为 Together 风格的 `reasoning: { enabled }` 控件使用 `together`；配合 `supportsReasoningEffort`，它还会发送 `reasoning_effort`。为本地 Qwen 兼容服务器（读取 `chat_template_kwargs.enable_thinking` 且需要 `preserve_thinking`）使用 `qwen-chat-template`。

为通过 `cache_control` 暴露 Anthropic 风格提示缓存的 OpenAI 兼容提供商，使用 `cacheControlFormat: "anthropic"`。

对于使用 `api: "anthropic-messages"` 的 Anthropic 兼容提供商，在需要自适应思考（`thinking.type: "adaptive"` 加上 `output_config.effort`）的模型或提供商上设置 `compat.forceAdaptiveThinking: true`。内置的自适应 Claude 模型会自动设置此项。仅在提供程序会发出空思考签名并期望在重放时 `signature: ""` 的情况下，设置 `compat.allowEmptySignature: true`。

> 迁移说明：Mistral 已从 `openai-completions` 迁移到 `mistral-conversations`。
> 为原生 Mistral 模型使用 `mistral-conversations`。
> 如果你有意将 Mistral 兼容/自定义端点通过 `openai-completions` 路由，请显式设置所需的 `compat` 标志。

### 认证标头

如果你的提供商期望 `Authorization: Bearer <key>` 但不使用标准 API，请设置 `authHeader: true`：

```typescript
pi.registerProvider("custom-api", {
  baseUrl: "https://api.example.com",
  apiKey: "$MY_API_KEY",
  authHeader: true,  // 添加 Authorization: Bearer 标头
  api: "openai-completions",
  models: [...]
});
```

密钥会在每次请求时解析。显式的请求 `Authorization` 标头优先于生成的值。

## OAuth 支持

添加与 `/login` 集成的 OAuth/SSO 认证：

```typescript
import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai";

pi.registerProvider("corporate-ai", {
  baseUrl: "https://ai.corp.com/v1",
  api: "openai-responses",
  models: [...],
  oauth: {
    name: "企业 AI（SSO）",

    async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
      const method = await callbacks.onSelect({
        message: "选择登录方式：",
        options: [
          { id: "browser", label: "浏览器 OAuth" },
          { id: "device", label: "设备码" }
        ]
      });
      if (!method) throw new Error("登录已取消");

      let code: string;
      if (method === "device") {
        callbacks.onDeviceCode({
          userCode: "ABCD-1234",
          verificationUri: "https://sso.corp.com/device",
          intervalSeconds: 5,
          expiresInSeconds: 900
        });
        code = await pollDeviceCodeUntilComplete();
      } else {
        callbacks.onAuth({ url: "https://sso.corp.com/authorize?..." });
        code = await callbacks.onPrompt({ message: "输入 SSO 代码：" });
      }

      // 用代码交换令牌（你的实现）
      const tokens = await exchangeCodeForTokens(code);

      return {
        refresh: tokens.refreshToken,
        access: tokens.accessToken,
        expires: Date.now() + tokens.expiresIn * 1000
      };
    },

    async refreshToken(credentials: OAuthCredentials, signal: AbortSignal): Promise<OAuthCredentials> {
      const tokens = await refreshAccessToken(credentials.refresh, signal);
      return {
        refresh: tokens.refreshToken ?? credentials.refresh,
        access: tokens.accessToken,
        expires: Date.now() + tokens.expiresIn * 1000
      };
    },

    getApiKey(credentials: OAuthCredentials): string {
      return credentials.access;
    }
  }
});
```

注册后，用户可以通过 `/login corporate-ai` 进行身份验证。

### OAuthLoginCallbacks

`callbacks` 对象为提供商拥有的流程提供与 UI 无关的交互：

```typescript
interface OAuthLoginCallbacks {
  // 在浏览器中打开 URL（用于 OAuth 重定向）
  onAuth(params: { url: string }): void;

  // 显示设备码（用于设备授权流程）
  onDeviceCode(params: {
    userCode: string;
    verificationUri: string;
    intervalSeconds?: number;
    expiresInSeconds?: number;
  }): void;

  // 显示临时进度
  onProgress?(message: string): void;

  // 提示用户输入（用于手动输入令牌）
  onPrompt(params: { message: string }): Promise<string>;

  // 显示交互式选择器，例如选择浏览器 OAuth 或设备码
  onSelect(params: {
    message: string;
    options: { id: string; label: string }[];
  }): Promise<string | undefined>;
}
```

### OAuthCredentials

凭证会持久化存储在 `~/.pi/agent/auth.json`：

```typescript
interface OAuthCredentials {
  refresh: string;   // 刷新令牌（用于 refreshToken()）
  access: string;    // 访问令牌（由 getApiKey() 返回）
  expires: number;   // 毫秒时间戳的过期时间
}
```

## 自定义流式 API

对于具有非标准 API 的提供商，请实现 `streamSimple`。在编写自己的实现之前，先研究现有的 API 实现：

**参考实现：**
- [anthropic-messages.ts](https://github.com/earendil-works/pi-mono/blob/main/packages/ai/src/api/anthropic-messages.ts) - Anthropic Messages API
- [mistral-conversations.ts](https://github.com/earendil-works/pi-mono/blob/main/packages/ai/src/api/mistral-conversations.ts) - Mistral Conversations API
- [openai-completions.ts](https://github.com/earendil-works/pi-mono/blob/main/packages/ai/src/api/openai-completions.ts) - OpenAI Chat Completions
- [openai-responses.ts](https://github.com/earendil-works/pi-mono/blob/main/packages/ai/src/api/openai-responses.ts) - OpenAI Responses API
- [google-generative-ai.ts](https://github.com/earendil-works/pi-mono/blob/main/packages/ai/src/api/google-generative-ai.ts) - Google Generative AI
- [bedrock-converse-stream.ts](https://github.com/earendil-works/pi-mono/blob/main/packages/ai/src/api/bedrock-converse-stream.ts) - AWS Bedrock

### 流模式

所有提供商都遵循相同的模式：

```typescript
import {
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
  calculateCost,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";

function streamMyProvider(
  model: Model<any>,
  context: Context,
  options?: SimpleStreamOptions
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();

  (async () => {
    // 初始化输出消息
    const output: AssistantMessage = {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "pending",
      timestamp: Date.now(),
    };

    try {
      // 推送开始事件
      stream.push({ type: "start", partial: output });

      // 发起 API 请求并处理响应...
      // 在其到达时推送内容事件，并从终止事件设置 stopReason。
      if (output.stopReason === "pending") {
        throw new Error("提供商流在没有停止原因的情况下结束");
      }
      if (output.stopReason === "error" || output.stopReason === "aborted") {
        throw new Error(output.errorMessage || "发生了一个未知错误");
      }

      // 推送完成事件
      stream.push({
        type: "done",
        reason: output.stopReason,
        message: output
      });
      stream.end();
    } catch (error) {
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();

  return stream;
}
```

### 事件类型

按以下顺序通过 `stream.push()` 推送事件：

1. `{ type: "start", partial: output }` - 流已开始

2. 内容事件（可重复，为每个块跟踪 `contentIndex`）：
    - `{ type: "text_start", contentIndex, partial }` - 文本块已开始
    - `{ type: "text_delta", contentIndex, delta, partial }` - 文本块
    - `{ type: "text_end", contentIndex, content, partial }` - 文本块已结束
    - `{ type: "thinking_start", contentIndex, partial }` - 思考已开始
    - `{ type: "thinking_delta", contentIndex, delta, partial }` - 思考块
    - `{ type: "thinking_end", contentIndex, content, partial }` - 思考已结束
    - `{ type: "toolcall_start", contentIndex, partial }` - 工具调用已开始
    - `{ type: "toolcall_delta", contentIndex, delta, partial }` - 工具调用 JSON 块
    - `{ type: "toolcall_end", contentIndex, toolCall, partial }` - 工具调用已结束

3. `{ type: "done", reason, message }` 或 `{ type: "error", reason, error }` - 流已结束

`partial` 字段在每个事件中包含当前的 `AssistantMessage` 状态。在收到数据时更新 `output.content`，然后将 `output` 作为 `partial` 包含在内。

### 内容块

在它们到达时向 `output.content` 添加内容块：

```typescript
// 文本块
output.content.push({ type: "text", text: "" });
stream.push({ type: "text_start", contentIndex: output.content.length - 1, partial: output });

// 当文本到达时
const block = output.content[contentIndex];
if (block.type === "text") {
  block.text += delta;
  stream.push({ type: "text_delta", contentIndex, delta, partial: output });
}

// 当块完成时
stream.push({ type: "text_end", contentIndex, content: block.text, partial: output });
```

### 工具调用

工具调用需要累加 JSON 并解析：

```typescript
// 开始工具调用
output.content.push({
  type: "toolCall",
  id: toolCallId,
  name: toolName,
  arguments: {}
});
stream.push({ type: "toolcall_start", contentIndex: output.content.length - 1, partial: output });

// 累加 JSON
let partialJson = "";
partialJson += jsonDelta;
try {
  block.arguments = JSON.parse(partialJson);
} catch {}
stream.push({ type: "toolcall_delta", contentIndex, delta: jsonDelta, partial: output });

// 完成
stream.push({
  type: "toolcall_end",
  contentIndex,
  toolCall: { type: "toolCall", id, name, arguments: block.arguments },
  partial: output
});
```

### 使用量和成本

根据 API 响应更新使用量并计算成本：

```typescript
output.usage.input = response.usage.input_tokens;
output.usage.output = response.usage.output_tokens;
output.usage.cacheRead = response.usage.cache_read_tokens ?? 0;
output.usage.cacheWrite = response.usage.cache_write_tokens ?? 0;
output.usage.totalTokens = output.usage.input + output.usage.output +
                           output.usage.cacheRead + output.usage.cacheWrite;
calculateCost(model, output.usage);
```

## 上下文溢出错误

当请求超过模型的上下文窗口时，Pi 可以通过压缩对话并重试来自动恢复。仅当 Pi 能够识别该失败为溢出时，才会触发此恢复。

检测在最终化的助手消息上运行：

- `stopReason === "error"`
- `errorMessage` 匹配 Pi 已知的溢出模式之一（见 [`packages/ai/src/utils/overflow.ts`](https://github.com/earendil-works/pi-mono/blob/main/packages/ai/src/utils/overflow.ts)）

如果你的提供商以 Pi 不识别的消息返回溢出错误，请在注册提供商的同一扩展中规范化错误。使用 `message_end` 处理程序重写助手消息，使其 `errorMessage` 以 Pi 识别的短语开头。通用回退 `context_length_exceeded` 是最安全的选择。

```typescript
const MY_PROVIDER_OVERFLOW_PATTERN = /your provider's overflow phrase/i;

export default function (pi: ExtensionAPI) {
  pi.registerProvider("my-provider", { /* ... */ });

  pi.on("message_end", (event, ctx) => {
    const message = event.message;
    if (message.role !== "assistant") return;
    if (message.stopReason !== "error") return;
    if (
      message.provider !== "my-provider" &&
      ctx.model?.provider !== "my-provider"
    )
      return;

    const errorMessage = message.errorMessage ?? "";
    if (errorMessage.includes("context_length_exceeded")) return;
    if (!MY_PROVIDER_OVERFLOW_PATTERN.test(errorMessage)) return;

    return {
      message: {
        ...message,
        errorMessage: `context_length_exceeded: ${errorMessage}`,
      },
    };
  });
}
```

`message_end` 在 Pi 跟踪助手消息用于自动压缩之前运行，因此重写的 `errorMessage` 是 Pi 检查的内容。有了这个机制，Pi 将会：

1. 从 `errorMessage` 检测溢出。
2. 从实时上下文中丢弃失败的助手消息。
3. 运行压缩。
4. 重试一次请求。

请谨慎保护重写逻辑：

- 将其限定为你的提供商（`message.provider` 和 `ctx.model?.provider`），以便不碰其他提供商的无关错误。
- 匹配提供商特定的模式，而不是 Pi 的通用溢出模式。重写速率限制或节流错误（`rate limit`、`too many requests`）会错误地触发压缩，而不是 Pi 的普通重试退避路径。
- 在 `errorMessage` 已包含 `context_length_exceeded` 时跳过，以便该处理程序是幂等的。

## 测试你的实现

使用与内置提供商相同的测试套件测试你的提供商。从 [packages/ai/test/](https://github.com/earendil-works/pi-mono/tree/main/packages/ai/test) 复制并调整这些测试文件：

| 测试 | 用途 |
|------|------|
| `stream.test.ts` | 基本流式传输、文本输出 |
| `tokens.test.ts` | 令牌计数和使用量 |
| `abort.test.ts` | AbortSignal 处理 |
| `empty.test.ts` | 空/最小响应 |
| `context-overflow.test.ts` | 上下文窗口限制 |
| `image-limits.test.ts` | 图像输入处理 |
| `unicode-surrogate.test.ts` | unicode 边界情况 |
| `tool-call-without-result.test.ts` | 工具调用边界情况 |
| `image-tool-result.test.ts` | 工具结果中的图像 |
| `total-tokens.test.ts` | 总令牌计算 |
| `cross-provider-handoff.test.ts` | 提供商之间的上下文交接 |

运行测试以验证你的提供商/模型对的兼容性。

## 配置参考

```typescript
interface ProviderConfig {
  /** UI（如 /login）中提供商的显示名称。 */
  name?: string;

  /** API 端点 URL。定义模型时需要。 */
  baseUrl?: string;

  /** API 密钥字面量、环境变量插值（$ENV_VAR 或 ${ENV_VAR}），或 !command。定义模型时需要（除非使用 oauth）。 */
  apiKey?: string;

  /** 流式传输的 API 类型。定义模型时需要在提供商或模型级别指定。 */
  api?: Api;

  /** 用于非标准 API 的自定义流式实现。 */
  streamSimple?: (
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions
  ) => AssistantMessageEventStream;

  /** 要在请求中包含的自定义标头。值使用与 apiKey 相同的解析语法。 */
  headers?: Record<string, string>;

  /** 如果为 true，使用解析的 API 密钥添加 Authorization: Bearer 标头。 */
  authHeader?: boolean;

  /** 要注册的模型。如果提供，会替换该提供商的所有现有模型。 */
  models?: ProviderModelConfig[];

  /** 用于 /login 支持的 OAuth 提供商。 */
  oauth?: {
    name: string;
    login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials>;
    refreshToken(credentials: OAuthCredentials, signal: AbortSignal): Promise<OAuthCredentials>;
    getApiKey(credentials: OAuthCredentials): string;
  };
}
```

## 模型定义参考

```typescript
interface ProviderModelConfig {
  /** 模型 ID（例如，"claude-sonnet-4-20250514"）。 */
  id: string;

  /** 显示名称（例如，"Claude 4 Sonnet"）。 */
  name: string;

  /** 针对此特定模型的 API 类型覆盖。 */
  api?: Api;

  /** 针对此特定模型的 API 端点 URL 覆盖。 */
  baseUrl?: string;

  /** 该模型是否支持扩展思考。 */
  reasoning: boolean;

  /** 将 pi 思考级别映射到提供商/模型特定的值；null 标记为不支持的级别。 */
  thinkingLevelMap?: Partial<Record<"off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", string | null>>;

  /** 支持的输入类型。 */
  input: ("text" | "image")[];

  /** 每百万令片的成本（用于使用量跟踪）。 */
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };

  /** 最大上下文窗口大小（令牌）。 */
  contextWindow: number;

  /** 最大输出令牌数。 */
  maxTokens: number;

  /** 针对此特定模型的自定义标头。 */
  headers?: Record<string, string>;

  /** 所选 API 的兼容性设置。 */
  compat?: {
    // openai-completions
    supportsStore?: boolean;
    supportsDeveloperRole?: boolean;
    supportsReasoningEffort?: boolean;
    supportsUsageInStreaming?: boolean;
    supportsFinishReason?: boolean;
    supportsStrictMode?: boolean;
    supportsOpenAIGrammarTools?: boolean; // openai-completions/openai-responses；否则回退到普通的 function 工具
    maxTokensField?: "max_completion_tokens" | "max_tokens";
    requiresToolResultName?: boolean;
    requiresAssistantAfterToolResult?: boolean;
    requiresThinkingAsText?: boolean;
    requiresReasoningContentOnAssistantMessages?: boolean;
    thinkingFormat?: "openai" | "openrouter" | "deepseek" | "together" | "baseten" | "zai" | "qwen" | "chat-template" | "qwen-chat-template" | "string-thinking" | "ant-ling";
    chatTemplateKwargs?: Record<string, string | number | boolean | null | { "$var": "thinking.enabled" | "thinking.effort" | "thinking.budget"; omitWhenOff?: boolean }>;
    chatTemplateArgs?: Record<string, string | number | boolean | null | { "$var": "thinking.enabled" | "thinking.effort" | "thinking.budget"; omitWhenOff?: boolean }>;
    thinkingTokenBudgetField?: "thinking_token_budget" | "thinking_budget" | "thinking_budget_tokens";
    supportsThinkingTokenBudget?: boolean;
    cacheControlFormat?: "anthropic";
    sessionAffinityFormat?: "openai" | "openai-nosession" | "openrouter";
    sendSessionAffinityHeaders?: boolean;

    // anthropic-messages
    supportsEagerToolInputStreaming?: boolean;
    supportsLongCacheRetention?: boolean;
    sendSessionAffinityHeaders?: boolean;
    supportsCacheControlOnTools?: boolean;
    forceAdaptiveThinking?: boolean;
    allowEmptySignature?: boolean;
    supportsStrictTools?: boolean;
  };
}
```

`openrouter` 会发送 `reasoning: { effort }`。`deepseek` 会发送 `thinking: { type: "enabled" | "disabled" }` 并在启用时发送 `reasoning_effort`。`together` 会发送 `reasoning: { enabled }`，并且在启用 `supportsReasoningEffort` 时还会发送 `reasoning_effort`。`qwen` 用于 DashScope 风格的顶层 `enable_thinking`。为读取 `chat_template_kwargs.enable_thinking` 且需要 `preserve_thinking` 的本地 Qwen 兼容服务器使用 `qwen-chat-template`。为可配置的 `chat_template_kwargs` 使用 `chat-template`，例如 DeepSeek V3.x 在 vLLM 背后配合 `chatTemplateKwargs: { "thinking": { "$var": "thinking.enabled" } }`。使用 `thinkingFormat: "baseten"` 配合 `chatTemplateArgs`，当提供商在 `chat_template_args` 下期望切换值并可能支持顶层 `reasoning_effort` 时使用。

`thinkingTokenBudgetField` 会作为顶层请求字段发送每个级别的受压思考预算（vLLM 上的 `thinking_token_budget`、Qwen/SGLang 上的 `thinking_budget`、llama.cpp 上的 `thinking_budget_tokens`）。`supportsThinkingTokenBudget: true` 是 vLLM 字段名的别名。请勿将其与 DashScope Qwen 模型上的 `reasoning_effort` 结合使用。

`cacheControlFormat: "anthropic"` 会对系统提示、最后一个工具定义以及最后一个 user、assistant 或工具结果文本内容应用 Anthropic 风格的 `cache_control` 标记。