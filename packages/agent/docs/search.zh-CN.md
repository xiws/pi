# 会话搜索

Pi 搜索是跨已提交会话条目的轻量查询接口。共享契约仅返回稳定的命中标识；实现可以用后端特定的显示数据扩展命中结果。

## 核心 API

```ts
export interface SessionSearchHit {
  /** 拥有该条目的会话的逻辑标识。 */
  readonly sessionId: string;

  /** 在该会话中条目的逻辑标识。 */
  readonly entryId: string;
}

export interface SessionSearchOptions {
  /** 将结果限定为特定的规范条目类型。 */
  readonly entryTypes?: readonly Entry["type"][];

  /** 限制返回的最大命中数。后端可以返回更少，但不能返回更多。 */
  readonly limit?: number;

  /** 用于取消的取消信号，例如搜索时输入。 */
  readonly signal?: AbortSignal;
}

export interface SessionSearch<T extends SessionSearchHit = SessionSearchHit> {
  search(text: string, options?: SessionSearchOptions): AsyncIterable<T>;
}
```

基础命中有意保持极简：`(sessionId, entryId)` 是跨 JSONL、内存、SQLite FTS 和远程索引的可移植标识。摘要、时间戳、分数、元数据、偏移和排序语义由具体实现提供。

## 为什么使用异步可迭代对象

`AsyncIterable` 允许消费者逐步显示结果，在获得足够结果时停止迭代，并用 `AbortSignal` 取消进行中的工作。节流仍由 UI/调用方处理；API 仅提供取消原语。

```ts
let currentAbortController: AbortController | undefined;

async function updateResults(query: string) {
  currentAbortController?.abort();
  const controller = new AbortController();
  currentAbortController = controller;

  try {
    for await (const hit of search.search(query, { limit: 10, signal: controller.signal })) {
      render(hit);
    }
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "AbortError") throw error;
  }
}
```

## 默认实现

### 扫描搜索

可重用的扫描器将会话类数据源（`getMetadata`、`findEntries` 和 `getLabel`）转换为投影条目：

```ts
export interface SessionSearchCandidate {
  readonly entryId: string;
  readonly seq: number;
  readonly type: Entry["type"];
  readonly timestamp: number;
  readonly text: string;
  readonly fields?: Record<string, unknown>;
}

export interface ScanningSessionSearchHit extends SessionSearchHit {
  readonly timestamp: number;
  readonly snippet: string;
}
```

`SessionSearchCandidate` 是预匹配扫描器输入：它包含可搜索文本、类型、序列号和可选的投影字段。扫描器将匹配的候选项转换为公共命中。

已打开的会话或存储可以直接扫描：

```ts
const search = createScanningSessionSearch(sessions);

for await (const hit of search.search("authentication", { limit: 10 })) {
  const session = sessionsById.get(hit.sessionId)!;
  const entry = await session.getEntry(hit.entryId);
  console.log(entry);
}
```

JSONL 不需要单独的公共搜索适配器。基于 JSONL 的代码可以保持本地发现/加载，然后将加载的存储传递给同一个扫描器：

```ts
async function* jsonlReadables(jsonl: JsonlSessionRepoOptions, query: JsonlSessionListOptions = {}) {
  for (const metadata of await listJsonlSessionMetadata(jsonl, query)) {
    yield loadJsonlSessionStorage(jsonl, metadata);
  }
}

const search = createScanningSessionSearch((query) => jsonlReadables(jsonl, query));
```

扫描源不应在可能抢占写入者租约的情况下对 harness 拥有的会话调用 `SessionRepo.open()`。JSONL 应使用只读加载辅助函数；已经打开的会话/存储可以直接扫描。

### SQLite FTS

SQLite 搜索暴露了扩展的命中：

```ts
export interface SqliteSessionSearchHit extends SessionSearchHit {
  readonly metadata: SqliteSessionMetadata;
  readonly timestamp: number;
  readonly score: number;
}
```

```ts
const search = createSqliteSessionSearch({ env, sqlite, databasePath });

for await (const hit of search.search("auth", {
  entryTypes: ["message", "compaction"],
  limit: 20,
})) {
  console.log(hit.sessionId, hit.entryId, hit.score);
}
```

FTS 表和触发器在首次非空白搜索时延迟创建。当 FTS 首次创建时，SQLite 从规范 `entries` 执行一次性重建；之后，SQLite 触发器保持 FTS 与规范条目插入、删除和负载更新的同步。这使得 SQLite 搜索在提交后即鲜，但也意味着 FTS 触发器失败可能会在搜索为数据库启用的情况下回滚规范 SQLite 写入。

## 索引后端

搜索索引是共享 API 的后端派生状态。共享包仅导出查询 API；应用或后端包在需要显式索引维护时可以定义自己的写入/喂入契约。

### 基于 Elasticsearch 的 JSONL 会话

这是应用拥有的粘合层。核心提供查询契约和 JSONL 会话发现；Elastic 写入契约本地于此适配器。

```ts
import { Client } from "@elastic/elasticsearch";
import {
  scanningEntries,
  type JsonlSessionMetadata,
  type JsonlSessionRepoOptions,
  type SessionSearch,
  type SessionSearchHit,
  type SessionSearchOptions,
} from "@earendil-works/pi-agent-core";

// 基于 JSONL 的代码可以本地从现有的 JSONL 列表/加载辅助函数提供这些。
async function* jsonlReadables(jsonl: JsonlSessionRepoOptions, options: { cwd?: string } = {}) {
  for (const metadata of await listJsonlSessionMetadata(jsonl, options)) {
    yield loadJsonlSessionStorage(jsonl, metadata);
  }
}

interface SearchIndexWriter<TItem> {
  apply(items: TItem[]): Promise<void>;
  flush?(): Promise<void>;
}

interface IndexedSessionSearch<T extends SessionSearchHit, TItem>
  extends SessionSearch<T>, SearchIndexWriter<TItem> {}

type ElasticSessionFeedItem =
  | { type: "upsert"; id: string; body: ElasticSessionDoc }
  | { type: "delete"; id: string };

interface ElasticSessionDoc {
  sessionId: string;
  entryId: string;
  seq: number;
  timestamp: number;
  cwd: string;
  text: string;
  metadata: JsonlSessionMetadata;
  fields?: Record<string, unknown>;
}

interface ElasticSessionSearchHit extends SessionSearchHit {
  readonly timestamp: number;
  readonly snippet: string;
  readonly score?: number;
}

class ElasticSessionSearch
  implements IndexedSessionSearch<ElasticSessionSearchHit, ElasticSessionFeedItem>
{
  constructor(
    private readonly client: Client,
    private readonly index: string,
  ) {}

  async apply(items: ElasticSessionFeedItem[]): Promise<void> {
    const operations = items.flatMap((item) => {
      if (item.type === "delete") {
        return [{ delete: { _index: this.index, _id: item.id } }];
      }
      return [{ index: { _index: this.index, _id: item.id } }, item.body];
    });

    if (operations.length > 0) await this.client.bulk({ operations });
  }

  async flush(): Promise<void> {
    await this.client.indices.refresh({ index: this.index });
  }

  async *search(
    text: string,
    options: SessionSearchOptions = {},
  ): AsyncIterable<ElasticSessionSearchHit> {
    const result = await this.client.search<ElasticSessionDoc>({
      index: this.index,
      size: options.limit ?? 20,
      query: {
        bool: {
          must: [{ match: { text } }],
        },
      },
    });

    for (const hit of result.hits.hits) {
      if (!hit._source) continue;
      if (options.signal?.aborted) throw options.signal.reason;
      yield {
        sessionId: hit._source.sessionId,
        entryId: hit._source.entryId,
        timestamp: hit._source.timestamp,
        snippet: hit._source.text,
        score: hit._score ?? undefined,
      };
    }
  }
}
```

补入/重建任务可以将 JSONL 投影喂入 Elasticsearch 而不占用写入者租约：

```ts
async function indexJsonlSessionsIntoElastic(
  jsonl: JsonlSessionRepoOptions,
  elastic: ElasticSessionSearch,
  options: { cwd?: string } = {},
): Promise<void> {
  for await (const session of jsonlReadables(jsonl, { cwd: options.cwd })) {
    const metadata = await session.getMetadata();
    for await (const candidate of scanningEntries(session)) {
      await elastic.apply([{
        type: "upsert",
        id: `${metadata.id}:${candidate.entryId}`,
        body: {
          sessionId: metadata.id,
          entryId: candidate.entryId,
          seq: candidate.seq,
          timestamp: candidate.timestamp,
          cwd: metadata.cwd,
          text: candidate.text,
          metadata,
          fields: candidate.fields,
        },
      }]);
    }
  }

  await elastic.flush();
}
```

## 正确性和失败边界

搜索索引是共享 API 的后端派生状态：应用可以重试、重建或将搜索标记为过时。后端特定选择可能导致不同权衡；SQLite FTS 使用共置触发器，因此 FTS 失败可能会在搜索已初始化触发器后回滚规范 SQLite 写入。

如果扫描源产生重复的 `sessionId` 值，应快速失败，因为基础命中标识是 `(sessionId, entryId)`。索引后端通常在其存储/索引层强制唯一性。

搜索加入仍然需要同步/索引层。后续操作应添加一个默认无操作的搜索索引汇（例如 `NOOP_SEARCH_INDEX_SINK`），以便规范写入站点可以无条件地发出索引事件，类似地，当遥测禁用时遥测使用无操作实现。
