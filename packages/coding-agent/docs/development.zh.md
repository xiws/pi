# 开发

请参阅 [AGENTS.md](https://github.com/earendil-works/pi-mono/blob/main/AGENTS.md) 获取额外指导。

## 配置

```bash
git clone https://github.com/earendil-works/pi-mono
cd pi-mono
npm install
npm run build
```

从源码运行：

```bash
/path/to/pi-mono/pi-test.sh
```

该脚本可从任意目录运行。Pi 会保持调用方的当前工作目录。

## Fork / 重命名

通过 `package.json` 配置：

```json
{
  "piConfig": {
    "name": "pi",
    "configDir": ".pi"
  }
}
```

修改 `name`、`configDir` 和 `bin` 字段以适配你的 fork。这会影响 CLI 标题栏、配置文件路径和环境变量名。

## 路径解析

三种执行模式：npm install、独立二进制文件、从源码 tsx。

**始终使用 `src/config.ts`** 来访问包资源：

```typescript
import { getPackageDir, getThemeDir } from "./config.js";
```

切勿直接使用 `__dirname` 获取包资源路径。

## 调试命令

`/debug`（隐藏）会写入 `~/.pi/agent/pi-debug.log`：
- 带有 ANSI 转义码的 TUI 渲染行
- 最后发送给 LLM 的消息

## 测试

```bash
./test.sh                         # 运行非 LLM 相关测试（无需 API 密钥）
npm test                          # 运行所有测试
npm test -- test/specific.test.ts # 运行指定测试
```

## 项目结构

```
packages/
  ai/           # LLM 提供程序抽象
  agent/        # Agent 循环与消息类型
  tui/          # 终端 UI 组件
  coding-agent/ # CLI 和交互模式
```
