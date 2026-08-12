# skillcoffer WebUI 契约

| 字段 | 值 |
|------|-----|
| 状态 | Current |
| 入口 | `skillcoffer ui [--port 7526] [--open]` |
| 范围 | 本地 skill 状态、存档、挂载、工具包、文件与 diff、Doctor |

WebUI 是 CLI/core 的本地操作面，不定义第二套领域语义。所有写操作必须调用
`Store`，不得直接改 manifest、version tree 或 bundle symlink。

## 1. 产品边界

WebUI 服务个人开发者管理本机 skill。它应当安静、紧凑、可扫读，首屏直接进入
工具，不做营销落地页。

**负责：**

- 安装本地目录或公开 GitHub skill
- 查看 dirty、branch、version、upstream 与 link 状态
- save、discard、restore、check、update
- 浏览文件与 unified diff
- 创建和维护 bundle，复制 pi 启动命令
- Doctor 检查与修复坏挂载

**不负责：**

- 在线编辑 skill 内容
- merge、stash、rebase
- Hub 市场、团队权限、审核流
- 浏览器内启动 pi 或嵌入终端
- 远程部署与多用户鉴权

## 2. 用户词汇

| 词 | 含义 |
|----|------|
| skill | 一个可管理的能力包 |
| 存档 | 不可变 version 快照 |
| 工作线 | branch 及其独立 work 目录 |
| 挂载 | harness 全局目录中的 live/pin symlink |
| 工具包 | 一次 pi session 使用的 skill 集合 |

`work`、`HEAD`、`treeHash`、manifest 路径只在高级信息或技术错误中出现。

挂载与工具包必须明确区分：挂载控制 harness 的长期可见性；工具包只控制一次
`pi --skill` 会话，不要求成员先被挂载。

## 3. 信息架构

| 路由 | 内容 |
|------|------|
| `/` | 总览与安装入口 |
| `/skills/:id` | skill 状态、文件、diff 与操作 |
| `/bundles/:name` | bundle 成员与启动命令 |
| `/doctor` | store 一致性检查与可修复问题 |

App Shell 固定包含：

- 48px 顶栏：产品名、搜索、Doctor、store 路径
- 240px 左栏：Skills 与 Bundles 两段列表
- 单一主内容列：桌面最大宽度约 960px
- skill 与 bundle 状态每 4 秒轮询；Doctor 徽标每 15 秒轮询

搜索只过滤已加载的本地 skill 与 bundle，不访问远程市场。

## 4. Skill 页面

页面顶部依次展示：

1. local id、来源与可复制工作目录
2. dirty、active branch、live/pin 数量
3. 当前状态对应的主操作
4. `概况 / 文件 / 对比` 三个 tab

### 概况

固定顺序：

1. upstream 状态与 check/update 操作
2. link 列表与 live/pin 说明
3. branch 列表
4. version 时间线与 restore
5. 所在 bundle
6. 折叠的 manifest 与 treeHash

只有一个主 CTA：dirty 时为“存档”；clean 且无 link 时为“挂到 pi”；其余操作
保持次级样式。

破坏性动作使用行内二次确认，不使用 modal：

- discard 明确说明会丢弃未存档修改
- restore 明确说明会重置当前 work
- update apply 明确说明是 hard reset，pin 不变
- unlink 明确显示目标路径

### 文件

文件 tab 只读浏览 work、HEAD 或最近 version。默认选择 `SKILL.md`，二进制文件不
渲染文本，超过 512 KB 的文件只显示前 512 KB 并标注截断。

### 对比

支持 work、HEAD、version 与 GitHub upstream 之间的 unified diff。左侧列出变更文件，
右侧一次显示一个文件。insert/delete 必须同时通过颜色和 `+/-` 文本表达。

## 5. Bundle 页面

页面依次展示：

1. bundle 名、成员数、可复制目录
2. `skillcoffer pi <name>` 与 `--print` 命令
3. live/pin 成员列表
4. 可添加的本地 skill
5. 折叠的删除操作

成员默认 live；用户可切为 pin、移出或重新加入。live 成员 dirty 时必须显示警告，
但不能阻止复制启动命令。删除 bundle 只删除成员 symlink 和 bundle 目录，不删除 skill。

## 6. 空态与 Doctor

没有 skill 时，首页直接显示安装表单。输入接受本机目录或
`owner/repo[/path]`，可选挂到 pi、agents 或 claude。

Doctor 检查：

- branch HEAD version tree 是否存在
- version treeHash 是否匹配
- link 记录与 symlink 是否一致
- bundle 成员是否为有效 symlink

只有坏 link 记录提供自动修复；其他问题报告位置与原因，不做猜测性修改。

## 7. 状态与反馈

- 网络/API 错误显示在当前工作区，不清除全局导航
- 写操作期间禁用触发按钮
- 成功操作使用短暂状态提示
- 外部 CLI/编辑器改动由轮询反映
- `live` 与 `pin` 始终使用文字和颜色双编码
- dirty 且存在 live link 时明确提示已有 session 可能看到修改

## 8. 视觉与可访问性

视觉 token 的唯一实现位于 `web/src/styles.css`。界面使用近黑背景、浅色正文、薄荷色
主动作、黄色 dirty、红色危险、蓝色 pin；不使用渐变、玻璃、发光或装饰图形。

- 字体使用系统 sans 与 monospace
- 卡片和按钮半径不超过 8px；胶囊仅用于状态徽标
- 页面标题约 20px，面板标题保持 12-14px
- 所有交互必须有可见 `focus-visible`
- 状态不能只靠颜色传达
- 遵守 `prefers-reduced-motion`
- 主界面面向桌面；窄屏必须可读且不能文字重叠

## 9. 技术边界

- React + Vite + Tailwind，生产资源构建到 `dist/web`
- Node 内置 `http` 提供 JSON API 和静态 SPA fallback
- 只绑定 `127.0.0.1`
- 前端不引入全局状态库、查询库或组件框架
- API 响应类型集中在 `src/ui/contracts.ts`
- API 请求统一经过 `web/src/api.ts` 的 `request<T>`

新增依赖前必须证明现有平台、React、Tailwind 或已安装依赖不能完成需求。

## 10. 验证

每次 UI 改动至少执行：

```bash
npm run build
skillcoffer ui --port 7526
agent-browser-cli open http://127.0.0.1:7526 --group-title skillcoffer-ui
agent-browser-cli scan --text-only
agent-browser-cli screenshot --out /tmp/skillcoffer-ui.png
```

验收重点：页面正文非空，skill/bundle 路由可达，写操作有反馈，diff 可见，桌面与窄屏
无重叠，控制台无运行时错误。
