pi 可以创建提示模板。让它为你工作流的模板模板。

# 提示模板

提示模板是 Markdown 片段，可以展开为完整的提示。在编辑器中键入 `/名称` 可调用模板，其中 `名称` 是不带 `.md` 的文件名。

## 位置

Pi 从以下位置加载提示模板：

- 全局：`~/.pi/agent/prompts/*.md`
- 项目：`.pi/prompts/*.md`（仅项目可信后）
- 包：`prompts/` 目录或 `package.json` 中的 `pi.prompts` 条目
- 设置：`prompts` 数组，包含文件或目录
- CLI：`--prompt-template <path>`（可重复）

禁用发现请使用 `--no-prompt-templates`。

## 格式

```markdown
---
description: 审查已暂存的 git 变更
---
审查已暂存的变更（`git diff --cached`）。重点关注：
- Bug 和逻辑错误
- 安全问题
- 错误处理遗漏
```

- 文件名将成为命令名称。`review.md` 变为 `/review`。
- `description` 是可选的。如果缺失，则使用第一行非空内容。
- `argument-hint` 是可选的。设置后，提示会在自动补全下拉框中显示在 `description` 之前。

### 参数提示

在前置元数据中使用 `argument-hint` 在自动补全中显示预期参数。在 `<尖括号>` 中指定必需参数，在 `[方括号]` 中指定可选参数：

```markdown
---
description: Review PRs from URLs with structured issue and code analysis
argument-hint: "<PR-URL>"
---
```

这在自动补全下拉框中渲染为：

```
→ pr   <PR-URL>       — Review PRs from URLs with structured issue and code analysis
  is   <issue>        — Analyze GitHub issues (bugs or feature requests)
  wr   [instructions] — Finish the current task end-to-end
  cl   — Audit changelog entries before release
```

## 用法

在编辑器中键入 `/` 后跟模板名称。自动补全会显示可用模板及其描述。

```
/review                           # 展开 review.md
/component Button                 # 带参数展开
/component Button "click handler" # 多个参数
```

## 参数

模板支持位置参数、默认值和简单切片：

- `$1`, `$2`, ... 位置参数
- `$@` 或 `$ARGUMENTS` 用于连接所有参数
- `${1:-default}` 在有参数 1 存在且非空时使用 arg 1，否则使用 `default`
- `${@:-default}` 或 `${ARGUMENTS:-default}` 在所有论证存在且非空时使用它们，否则使用 `default`
- `${@:N}` 用于 N 位置（1 索引）及以后
- `${@:N:L}` 用于从 N 开始的 `L` 个参数

示例：

```markdown
---
description: 创建组件
---
创建一个名为 $1 的 React 组件，具有以下功能：$@
```

默认值对于可选参数很有用：

```markdown
以 ${1:-7} 个要点总结当前状态。
```

用法：`/component Button "onClick handler" "disabled support"`

## 加载规则

- `prompts/` 中的模板发现是非递归的。
- 如果你想在子目录中有模板，请通过 `prompts` 设置或包清单显式添加它们。
