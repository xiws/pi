<p align="center">
  <a href="https://pi.dev">
    <img alt="pi logo" src="https://pi.dev/logo-auto.svg" width="128">
  </a>
</p>
<p align="center">
  <a href="https://discord.com/invite/3cU7Bz4UPx"><img alt="Discord" src="https://img.shields.io/badge/discord-community-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
  <a href="https://www.npmjs.com/package/@earendil-works/pi-coding-agent"><img alt="npm" src="https://img.shields.io/npm/v/@earendil-works/pi-coding-agent?style=flat-square" /></a>
</p>

> 默认情况下，新贡献者提出的新问题和新拉取请求将被自动关闭。维护者每天都会审阅自动关闭的 issue。详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

# Pi Agent Harness

这是 Pi agent harness 项目的主页，包括我们自扩展的编码代理（coding agent）。

* **[@earendil-works/pi-coding-agent](packages/coding-agent)**: 交互式编码代理 CLI
* **[@earendil-works/pi-agent-core](packages/agent)**: 代理运行时，支持工具调用和状态管理
* **[@earendil-works/pi-ai](packages/ai)**: 统一的多元 LLM API（OpenAI、Anthropic、Google …）

了解 Pi 更多信息：

* [访问 pi.dev](https://pi.dev)，项目官网及演示
* [阅读文档](https://pi.dev/docs/latest)，或者你随时可以让代理自己解释

## 所有包

| 包名 | 说明 |
|---------|-------------|
| **[@earendil-works/pi-telemetry](packages/telemetry)** | 与厂商无关的遥测契约、参考适配器、规范测试和带类型的模式 |
| **[@earendil-works/pi-ai](packages/ai)** | 统一的多元 LLM API（OpenAI、Anthropic、Google 等） |
| **[@earendil-works/pi-agent-core](packages/agent)** | 代理运行时，支持工具调用和状态管理 |
| **[@earendil-works/pi-coding-agent](packages/coding-agent)** | 交互式编码代理 CLI |
| **[@earendil-works/pi-tui](packages/tui)** | 终端 UI 库，支持差分渲染 |

有关 Slack/聊天自动化和工作流，参见 [earendil-works/pi-chat](https://github.com/earendil-works/pi-chat)。

## 权限与容器化

Pi 不包含限制文件系统、进程、网络或凭据访问的内置权限系统。默认情况下，它以上线它的用户和进程的权限运行。

如果需要更强的边界隔离，请将 Pi 容器化或沙箱化。详见 [packages/coding-agent/docs/containerization.md](packages/coding-agent/docs/containerization.md) 中的三种模式：

- **Gondolin 扩展**：在主机上保留 `pi` 和提供方认证，同时路由内置工具和 `!` 命令到本地 Linux 微虚拟机。
- **普通 Docker**：将整个 `pi` 进程运行在本地容器中，实现简单的隔离。
- **OpenShell**：在策略控制的沙箱中运行整个 `pi` 进程。

## 贡献

详见 [CONTRIBUTING.md](CONTRIBUTING.md) 了解贡献指南，[AGENTS.md](AGENTS.md) 了解项目特定规范（适用于人类和代理）。Pi 的长期计划也可以在 [RFCs](https://rfc.earendil.com/keyword/pi/) 中找到。

## 开发

```bash
npm install --ignore-scripts  # 安装所有依赖，不运行生命周期脚本
npm run build         # 刷新模型数据，然后构建所有包
npm run build:offline # 使用现有模型数据离线重构建，无需网络访问
npm run check         # 语法检查、格式化和类型检查
./test.sh            # 运行测试（跳过无 API 密钥的 LLM 测试）
./pi-test.sh         # 从源码运行 pi（可从任意目录执行）
```

## 从发布源码构建独立二进制文件

GitHub 发布版本包含一个受发行版 `SHA256SUMS` 文件覆盖的版本控制源码归档。解压后运行与官方独立二进制文件相同的构建脚本：

```bash
VERSION="<release-version>"
tar -xzf "pi-${VERSION}-source.tar.gz"
cd "pi-${VERSION}"
./scripts/build-binaries.sh --offline-model-data --platform linux-x64 --out "$PWD/out"
```

源码归档包含用于发布的生成式提供方模型数据。使用 `--offline-model-data` 参数将基于该快照构建，而非从实时提供方目录刷新。脚本仍将安装依赖、构建 monorepo、编译 Bun 可执行文件并准备其运行时资源。自行提供依赖的包维护者可以传递 `--skip-install --skip-deps`。

## 增强供应链安全

我们将 npm 依赖变更视为已审核的代码变更。

- 直接外部依赖锁定精确版本，内部工作区包版本号可以浮动。
- `.npmrc` 中设置 `save-exact=true` 和 `min-release-age=2`，以避免 npm 解析时出现同日发布依赖。
- `package-lock.json` 是依赖的权威来源。预提交钩子阻止随意修改 lockfile，除非设置了 `PI_ALLOW_LOCKFILE_CHANGE=1`。
- `npm run check` 验证锁定依赖、原生 TypeScript 导入兼容性，以及生成的 coding-agent 缩略文件。
- 已发布的 CLI 包包含 `packages/coding-agent/npm-shrinkwrap.json`，由根 lockfile 生成，以锁定 npm 用户的传递依赖。
- 发布冒烟测试使用 `npm run release:local` 构建、打包，并在标记发行版前在 repo 外部创建隔离的 npm 和 Bun 安装。
- 本地发布安装、文档 npm 安装和 `pi update --self` 在支持的情况下使用 `--ignore-scripts`。
- CI 安装使用 `npm ci --ignore-scripts`，定时运行的 GitHub 工作流执行 `npm audit --omit=dev` 和 `npm audit signatures --omit=dev`。
- 缩略文件生成功能对依赖生命周期脚本有显式允许列表，新增的生命周期脚本依赖在审阅前会失败。

## 分享你的开源编码代理会话

如果你使用 Pi 或其他编码代理进行开源工作，请分享你的会话。

开源会话数据有助于利用真实世界任务、工具使用、失败和修复来改进编码代理，而非玩具基准测试。

详见 [X 上的这篇帖子](https://x.com/badlogicgames/status/2037811643774652911) 了解详情。

要发布会话，请使用 [`badlogic/pi-share-hf`](https://github.com/badlogic/pi-share-hf)。阅读其 README.md 了解安装说明。你只需一个 Hugging Face 账户、Hugging Face CLI 和 `pi-share-hf`。

你也可以观看 [这个视频](https://x.com/badlogicgames/status/2041151967695634619)，演示我如何发布自己的 `pi-mono` 会话。

我在此定期发布自己 `pi-mono` 的会话数据：

- [badlogicgames/pi-mono on Hugging Face](https://huggingface.co/datasets/badlogicgames/pi-mono)

## License

MIT

<p align="center">
  <a href="https://pi.dev">pi.dev</a> 域由
  <br /><br />
  <a href="https://exe.dev"><img src="packages/coding-agent/docs/images/exy.png" alt="Exy mascot" width="48" /><br />exe.dev</a>
</p>
