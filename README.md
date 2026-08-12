# skillcoffer

**把 Agent Skills 收进一个可检查、可版本化、可组合的本地仓库。**

**简体中文** | [English](./README.en.md)

[![MIT License](https://img.shields.io/badge/license-MIT-2ea44f.svg)](./LICENSE)
![Node.js >= 20](https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)
![Status: early development](https://img.shields.io/badge/status-early%20development-f0ad4e)

skillcoffer 是 [Agent Skills](https://agentskills.io) 的本地管理器。它从本机目录或公开 GitHub 仓库安装 skill，为编辑工作保留独立工作线和不可变存档，跟踪上游变化，并将一个或多个 skill 交给 [pi](https://github.com/badlogic/pi-mono) 会话。

完整命令是 `skillcoffer`，`skco` 是完全等价的短命令。

## 为什么需要 skillcoffer

一个 skill 本质上是一组文件，但长期使用时还会遇到这些问题：

- 当前使用的是上游版本、本地修改，还是某次固定快照？
- 如何编辑一个 skill，又不直接污染安装来源？
- 如何查看上游变化，并在应用前检查 diff？
- 如何让长期挂载保持实时，同时让重要会话固定版本？
- 如何把多个 skill 组合起来，只在一次 pi 会话中启用？

skillcoffer 用普通目录、JSON 和 symlink 在本地解决这些问题。它不是 Git 的替代品，也不是远程市场或 agent runtime。

## 功能

- **从本机或 GitHub 安装**：接受包含 `SKILL.md` 的目录，以及 `owner/repo[/path]` 形式的公开 GitHub 来源。
- **不可变存档**：`save` 为当前文件树创建版本；`restore` 可以回到任意已保存状态。
- **独立工作线**：每条 branch 都有自己的可编辑 work 目录和 HEAD，不会混入其他工作线的未保存修改。
- **可审查的上游更新**：先 `check` / `diff`，再显式执行 `update --apply`；GitHub ref 会解析并记录为 commit SHA。
- **live / pin 挂载**：live 跟随工作目录，pin 固定到不可变版本。
- **Bundle 与 pi 启动器**：组合多个 skill，并生成或执行 `pi --skill ...`。
- **本地 WebUI**：浏览状态、文件、diff、存档、挂载、工具包和 Doctor 报告。
- **可检查的存储**：状态保存在普通文件中，可以直接查看、备份和恢复。

## 环境要求

- Node.js 20 或更高版本
- Git，用于获取 GitHub 来源
- `diff`，用于 CLI 和 WebUI 的目录比较
- Linux 或 macOS；当前未实现 Windows junction/copy 模式
- pi 是可选依赖，只有 `skillcoffer pi ...` 会调用它

## 安装

项目尚未发布到 npm registry。当前从源码安装：

```bash
git clone https://github.com/Howryann/skillcoffer.git
cd skillcoffer
npm ci
npm run build
npm install -g .
```

确认两个命令都可用：

```bash
skillcoffer --help
skco --help
```

不需要全局安装时，可以在仓库内运行：

```bash
npm run skco -- --help
```

## 快速开始

### 1. 安装一个公开 GitHub skill

```bash
skillcoffer add anthropics/skills/skills/pdf --ref main
skillcoffer status pdf -v
```

也可以安装本机目录：

```bash
skillcoffer add ./my-skill
```

skill 根目录必须包含 `SKILL.md`。

### 2. 编辑并保存

```bash
skillcoffer path pdf
$EDITOR "$(skillcoffer path pdf)/SKILL.md"
skillcoffer status pdf
skillcoffer save pdf -m "Tune PDF extraction workflow"
```

`path` 返回当前工作线的可编辑目录。不要直接修改安装来源或 version tree。

### 3. 检查并应用上游更新

```bash
skillcoffer check pdf
skillcoffer diff pdf --upstream
skillcoffer update pdf --apply
```

`update` 默认只预览；只有 `--apply` 才会写入新的上游版本。

### 4. 在一次 pi 会话中使用

```bash
skillcoffer pi pdf --print
skillcoffer pi pdf
skillcoffer pi pdf --pin
```

- 默认使用当前 work。
- `--pin` 使用当前 HEAD 的不可变版本。
- `--print` 只显示将执行的命令。

### 5. 组合多个 skill

```bash
skillcoffer bundle create research
skillcoffer bundle add research pdf --pin
skillcoffer bundle add research demo-skill
skillcoffer pi research --print
skillcoffer pi research -- --model your-model
```

Bundle 成员可以分别选择 live 或 pin。

## 持久挂载

安装时可以直接挂到常见 agent 目录：

```bash
skillcoffer add ./my-skill --agent pi
skillcoffer add ./another-skill --agent agents
skillcoffer add ./claude-skill --agent claude
```

也可以明确指定 symlink 目标：

```bash
skillcoffer link pdf --to "$HOME/.pi/agent/skills/pdf"
skillcoffer unlink pdf --to "$HOME/.pi/agent/skills/pdf"
```

live 挂载会立即看到 work 中尚未保存的修改；需要可复现行为时使用 `--pin`。

## WebUI

```bash
skillcoffer ui --open
```

默认地址为 [http://127.0.0.1:7526](http://127.0.0.1:7526)，可通过 `--port` 覆盖。服务只绑定本机回环地址。

WebUI 提供安装、状态、文件浏览、diff、save / restore、上游更新、挂载、Bundle 和 Doctor 操作；skill 内容仍由你自己的编辑器修改。

## 核心模型

| 概念 | 含义 |
|------|------|
| **Work** | 某条工作线的可编辑文件树 |
| **Version** | `save`、安装或更新产生的不可变快照 |
| **Branch** | 拥有独立 work 与 HEAD 的命名工作线 |
| **Live link** | 指向 work，修改会立即对使用者可见 |
| **Pin link** | 指向 version tree，不随后续保存移动 |
| **Bundle** | 一组 live/pin skill，供一次 pi 会话使用 |

详细语义见[设计契约](./docs/design.md)，Web 界面边界见 [WebUI 契约](./docs/webui.md)。

## CLI 速查

| 场景 | 命令 |
|------|------|
| 安装与查看 | `add`, `list`, `status`, `path` |
| 存档 | `save`, `versions`, `restore`, `discard` |
| 工作线 | `branch list`, `branch new`, `work-on` |
| 上游 | `check`, `diff`, `update` |
| 挂载 | `link`, `unlink` |
| 工具包 | `bundle create`, `bundle add`, `bundle path`, `bundle list` |
| 启动 pi | `pi <skill\|bundle>...` |
| 维护 | `doctor`, `remove`, `demo`, `ui` |

运行 `skillcoffer --help` 查看完整入口。当前 CLI 输出面向人类，不承诺稳定的机器解析格式。

## 数据目录与安全边界

默认 store 位于 `~/.skillcoffer`，可通过环境变量覆盖：

```bash
SKILLCOFFER_HOME=/path/to/store skillcoffer list
```

```text
$SKILLCOFFER_HOME/
  skills/<id>/manifest.json
  skills/<id>/versions/<version>/{version.json,tree/}
  skills/<id>/branches/<branch>/work/
  bundles/<name>/<skill> -> ...
```

- 安装、检查和 diff 不会执行 skill 中的脚本。
- 进入 store 的 skill tree 不允许 symlink 或特殊文件。
- GitHub 上游在使用前解析为确定的 commit。
- WebUI 只监听 `127.0.0.1`，不提供远程多用户鉴权。
- store 是本机状态；请像其他开发资料一样自行备份。

## 开发

```bash
git clone https://github.com/Howryann/skillcoffer.git
cd skillcoffer
npm ci
npm test
npm run build
```

开发 WebUI 时，在两个终端中分别运行：

```bash
node dist/cli.js ui
npm run dev:ui
```

Vite 开发服务器会把 `/api` 代理到本地 `7526` 端口。

## 贡献

Issue 和 Pull Request 都欢迎。提交改动前请运行：

```bash
npm test
npm run build
```

涉及状态语义、manifest 或文件布局的改动，请同时更新[设计契约](./docs/design.md)；涉及 WebUI 行为的改动，请同步更新 [WebUI 契约](./docs/webui.md)。较大的功能建议先开 Issue 明确范围。

## 项目状态

skillcoffer 当前处于早期开发阶段，核心本地工作流已经可用，但 CLI、WebUI 和存储契约在 `1.0` 前仍可能发生破坏性变化。

目前不包含：远程 skill 市场、发布服务、私有 GitHub 一等支持、集合批量安装、shell completion、Windows link 替代模式，以及团队权限系统。

## 许可证

[MIT](./LICENSE) © Howryann
