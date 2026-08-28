# Pi Agent 遥测 Schema

<!-- 由 generate-telemetry-docs.ts 生成。不要手动修改。 -->

## AI 请求 Schema

Schema 版本：1

### `pi.ai.request`

一次向 AI 提供者的逻辑请求

- 父级：根节点或任意调用方 span
- 默认状态：`ok`
- 错误条件：操作抛出或返回错误结果

#### 开始属性

| 名称 | 类型 | 必需 | 值 | 备注 | 描述 |
|---|---|---:|---|---|---|
| `pi.ai.operation` | `string` | yes | stream, fetch_deferred, cancel_deferred, generate_images |  | 逻辑提供者操作 |

| Name | Type | Required | Values | Notes | Description |
|---|---|---:|---|---|---|
| `pi.ai.operation` | `string` | yes | stream, fetch_deferred, cancel_deferred, generate_images | - | 逻辑提供者操作 |

#### 结束属性

| Name | Type | Required | Values | Notes | Description |
|---|---|---:|---|---|---|
| `pi.ai.request_count` | `number` | no | >=0 |  | API 请求计数 |

| `pi.ai.request_count` | `number` | | | |  |  |
|---|---|---:|---|---|---|
| `pi.ai.request_count` | `number` | no | >=0 | - | API 请求计数 |

**`pi.ai.request`**

| Attribute | Value Type | Required | Notes | Description |
|---|---|---:|---|---|
| `pi.ai.request_id` | `string` | yes | - | 逻辑请求 ID（用于重试/恢复追踪） |
| `pi.ai.provider` | `string` | yes | - | 提供者的唯一标识（用于提供者无关性） |
| `pi.ai.provider_version` | `string` | no | - | 提供者端点的版本 |
| `pi.ai.operation` | `string` | yes | stream, fetch_deferred, cancel_deferred, generate_images | 逻辑提供者操作 |
| `pi.ai.operation_attempt` | `number` | yes | >=1 | 当前尝试编号 |
| `pi.ai.operation_attempt_max` | `number` | yes | >=1 | 最大允许尝试次数（用于重试） |
| `pi.ai.provider_request_count` | `number` | no | >=0 | 提供者端点请求计数（用于请求计数） |
| `pi.ai.input_tokens` | `number` | no | >=0 | 输入标记数 |
| `pi.ai.output_tokens` | `number` | no | >=0 | 输出标记数 |
| `pi.ai.output_caching_tokens` | `number` | no | >=0 | 输出缓存标记数 |
| `pi.ai.request_count` | `number` | no | >=0 | API 请求计数 |
| `pi.ai.request_duration_ms` | `duration` | no |  | API 请求的持续时间（毫秒） |
| `pi.ai.request_latency_ms` | `duration` | no |  | API 请求延迟（毫秒） |
| `pi.ai.request_latency_p99_ms` | `duration` | no |  | API 请求延迟 P99（毫秒） |
| `pi.ai.request_status` | `string` | yes | ok, error | API 请求状态 |
| `pi.ai.output_text` | `string` | no | - | 输出文本 |
| `pi.ai.error_message` | `string` | no | - | 错误消息（如果出错） |
| `pi.ai.request_id` | `string` | no | - | **逻辑请求 ID（用于重试/恢复追踪）** |

**`pi.ai.request`**

| Attribute | Value Type | Required | Notes | Description |
|---|---|---:|---|---|
| `pi.ai.request_id` | `string` | yes | - | 逻辑请求 ID（用于重试/恢复追踪） |
| `pi.ai.provider` | `string` | yes | - | 提供者的唯一标识（用于提供者无关性） |
| `pi.ai.provider_version` | `string` | no | - | 提供者端点的版本 |
| `pi.ai.operation` | `string` | yes | stream, fetch_deferred, cancel_deferred, generate_images | 逻辑提供者操作 |
| `pi.ai.operation_attempt` | `number` | yes | >=1 | 当前尝试编号 |
| `pi.ai.operation_attempt_max` | `number` | yes | >=1 | 最大允许尝试次数（用于重试） |
| `pi.ai.provider_request_count` | `number` | no | >=0 | 提供者端点请求计数（用于请求计数） |
| `pi.ai.input_tokens` | `number` | no | >=0 | 输入标记数 |
| `pi.ai.output_tokens` | `number` | no | >=0 | 输出标记数 |
| `pi.ai.output_caching_tokens` | `number` | no | >=0 | 输出缓存标记数 |
| `pi.ai.request_count` | `number` | no | >=0 | API 请求计数 |
| `pi.ai.request_duration_ms` | `duration` | no | - | API 请求的持续时间（毫秒） |
| `pi.ai.request_latency_ms` | `duration` | no | - | API 请求延迟（毫秒） |
| `pi.ai.request_latency_p99_ms` | `duration` | no | - | API 请求延迟 P99（毫秒） |
| `pi.ai.request_status` | `string` | yes | ok, error | API 请求状态 |
| `pi.ai.output_text` | `string` | no | - | 输出文本 |
| `pi.ai.error_message` | `string` | no | - | **如果出错，错误消息** |
| `pi.ai.request_id` | `string` | no | - | **逻辑请求 ID（用于重试/恢复追踪）** |

### 错误和重试

**`pi.ai.request` schema 支持操作抛出和恢复的重试**：

- `pi.ai.provider_request_count`：用于重试操作计数，用于重试操作计数。
- `pi.ai.request_count`：用于请求计数。

**`pi.ai.request` schema 支持操作抛出和恢复的重试**：

- `pi.ai.provider_request_count`：API 请求计数，用于重试操作计数。
- `pi.ai.request_count`：用于请求计数。

**`pi.ai.request` schema 支持操作抛出和恢复的重试**：

- 在操作抛出时记录 `pi.ai.provider_request_count` 以便重试恢复。
- 在操作恢复时重置 `pi.ai.provider_request_count`。

## AI 请求 schema

Schema 版本：1

### `pi.ai.request`

一次向 AI 提供者的逻辑请求

- 父级：根节点或任意调用方 span
- 默认状态：`ok`
- 错误条件：操作抛出或返回错误结果

#### 开始属性

| Name | Type | Required | Values | Notes | Description |
|---|---|---:|---|---|---|
| `pi.ai.operation` | `string` | yes | stream, fetch_deferred, cancel_deferred, generate_images | - | 逻辑提供者操作 |

#### 结束属性

| Name | Type | Required | Values | Notes | Description |
|---|---|---:|---|---|---|
| `pi.ai.request_count` | `number` | no | >=0 | - | API 请求计数 |

**`pi.ai.request`**

| Attribute | Value Type | Required | Notes | Description |
|---|---|---:|---|---|
| `pi.ai.request_id` | `string` | yes | - | 逻辑请求 ID（用于重试/恢复追踪） |
| `pi.ai.provider` | `string` | yes | - | 提供者的唯一标识（用于提供者无关性） |
| `pi.ai.provider_version` | `string` | no | - | 提供者端点的版本 |
| `pi.ai.operation` | `string` | yes | stream, fetch_deferred, cancel_deferred, generate_images | 逻辑提供者操作 |
| `pi.ai.operation_attempt` | `number` | yes | >=1 | 当前尝试编号 |
| `pi.ai.operation_attempt_max` | `number` | yes | >=1 | 最大允许尝试次数（用于重试） |
| `pi.ai.provider_request_count` | `number` | no | >=0 | 提供者端点请求计数（用于请求计数） |
| `pi.ai.input_tokens` | `number` | no | >=0 | 输入标记数 |
| `pi.ai.output_tokens` | `number` | no | >=0 | 输出标记数 |
| `pi.ai.output_caching_tokens` | `number` | no | >=0 | 输出缓存标记数 |
| `pi.ai.request_count` | `number` | no | >=0 | API 请求计数 |
| `pi.ai.request_duration_ms` | `duration` | no | - | API 请求的持续时间（毫秒） |
| `pi.ai.request_latency_ms` | `duration` | no | - | API 请求延迟（毫秒） |
| `pi.ai.request_latency_p99_ms` | `duration` | no | - | API 请求延迟 P99（毫秒） |
| `pi.ai.request_status` | `string` | yes | ok, error | API 请求状态 |
| `pi.ai.output_text` | `string` | no | - | 输出文本 |
| `pi.ai.error_message` | `string` | no | - | 错误消息（如果出错） |
| `pi.ai.request_id` | `string` | no | - | **逻辑请求 ID（用于重试/恢复追踪）** |

### 错误和重试

**`pi.ai.request` schema 支持操作抛出和恢复的重试**：

- 在提供者和工具操作中恢复 `pi.ai.provider_request_count` 用于重试。
- 在操作抛出时记录 `pi.ai.request_id` 用于重试恢复。
