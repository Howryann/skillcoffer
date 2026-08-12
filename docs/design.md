# skillcoffer 设计契约

| 字段 | 值 |
|------|-----|
| 状态 | Current |
| 版本 | 0.2 |
| 范围 | 本地 store、版本、工作线、挂载、工具包、公开 GitHub 上游、CLI |

本文记录当前领域语义。实现细节可调整，但不得在没有迁移说明时改变 manifest、version、
branch、link 或 bundle 的含义。Web 表面另见 `docs/webui.md`。

## 1. 定位

skillcoffer 是 Agent Skills 的本地管理器：从磁盘或公开 GitHub 安装 skill，在独立工作线
中编辑，保存不可变快照，比较或应用上游，并通过 symlink 或 `pi --skill` 使用它们。

它不是 agent runtime、完整 git、远程市场或企业权限系统。

### 目标

- store 使用普通目录与 JSON，可检查、可备份、可人工恢复
- work 可直接由编辑器修改
- save 产生不可变 version，restore 可回到任意 version
- 每条 branch 有独立 work 与 HEAD
- link 明确区分 live 和 pin
- GitHub 上游固定到解析后的 commit
- CLI 与 WebUI 调用同一个 `Store`

### 非目标

- merge、rebase、stash、三路冲突处理
- 集合批量安装、私有 GitHub 登录、submodule、LFS
- publish、registry adapter、团队协作与 RBAC
- Windows copy/junction 模式
- 项目级或远程多 store

## 2. 领域模型

| 术语 | 定义 |
|------|------|
| Skill | 一个本地管理单元，由 `localId` 标识 |
| Version | 一次保存事件及其不可变文件树 |
| treeHash | 文件树内容与可执行位的 SHA-256 |
| Branch | 命名工作线，保存 HEAD 与独立 work |
| Work | branch 下可直接编辑的目录 |
| HEAD | branch 当前对齐的 version id |
| Dirty | work 的 treeHash 与 HEAD treeHash 不同 |
| Upstream | 原始 file 路径或公开 GitHub 坐标 |
| Link | 指向 work 或 version tree 的外部 symlink |
| Bundle | 一组指向 skill 的 symlink，供一次 pi session 使用 |

### Version

Version id 是保存事件 id，不是内容 hash。同一文件树可对应多个保存事件；内容相等由
`treeHash` 判断。

```ts
type VersionMeta = {
  id: string;
  treeHash: string;
  source: "file" | "local" | "upstream";
  note?: string;
  createdAt: string;
  upstream?: {
    requestedRef: string;
    resolvedCommit: string;
  };
};
```

### Branch

```ts
type BranchState = {
  head: string;
  upstreamBaseVersion?: string;
};
```

每条 branch 的 work 独立存在。`activeBranch` 只决定 CLI 默认操作哪条线；它不改变
任何已有 link 或正在运行的 session。

### Link

```ts
type LinkRec = {
  to: string;
  ref: string;
  mode: "live" | "pin";
};
```

- live 指向 `branches/<branch>/work`
- pin 指向 `versions/<version>/tree`
- save 不移动 pin
- work 改动会立即对 live 使用者可见

## 3. Store 布局

默认根目录是 `~/.skillcoffer`，可由 `SKILLCOFFER_HOME` 覆盖。

```text
$SKILLCOFFER_HOME/
  store.lock
  skills/
    <localId>/
      manifest.json
      versions/
        <versionId>/
          version.json
          tree/
      branches/
        <branch>/
          work/
  bundles/
    <bundle>/
      <skill> -> skill work 或 version tree
```

`manifest.json` 是 skill 可变状态的唯一权威来源：

```json
{
  "schemaVersion": 1,
  "localId": "find-docs",
  "name": "find-docs",
  "activeBranch": "main",
  "upstream": {
    "remote": "github",
    "repo": "owner/repo",
    "path": "skills/find-docs",
    "requestedRef": "main"
  },
  "branches": {
    "main": {
      "head": "ver_...",
      "upstreamBaseVersion": "ver_..."
    }
  },
  "links": [],
  "updatedAt": "..."
}
```

## 4. 文件树规则

- skill 根必须包含 `SKILL.md`
- frontmatter `name` 和 localId 使用 `[a-z0-9]([a-z0-9-]*[a-z0-9])?`
- 入库树只接受普通文件和目录
- symlink 与特殊文件拒绝进入 version/work
- treeHash 按规范化相对路径排序
- 每项哈希输入为 `path\0executable\0sha256(content)\n`
- 空目录不参与 hash
- version tree 写入后尽力移除写权限
- 从 version 复制到 work 时恢复可编辑权限

外部 skill 中的脚本永不由安装、检查或 diff 自动执行。

## 5. 写入边界

所有写操作经过 `Store.withLock`，manifest 使用临时文件加 rename 写入。创建 version 时先
复制树、计算 treeHash，再更新 manifest。破坏性覆盖 work 前必须检查 dirty，除非调用者
明确传入 `force`。

当前锁实现是原型级进程标记，不应被视为可靠的跨进程互斥。需要并行写入支持时，第一步
是用独占创建或系统文件锁替换 `withLock` 内部实现；公开 API 不需要改变。

## 6. 核心操作

### add

`add <path|owner/repo[/path]>`：

1. 获取并验证包含 `SKILL.md` 的文件树
2. 创建首个 version
3. 创建 `main` branch 与可写 work
4. 记录 file 或 GitHub upstream
5. 默认不 link；输出工作路径与下一条 link 命令

已有 localId 必须拒绝，不静默覆盖。

### save

对指定 branch 或 active branch 计算 work treeHash：

- 与 HEAD 相同：返回 HEAD，不创建空 version
- 不同：创建 `source=local` version，移动该 branch HEAD
- 保留 `upstreamBaseVersion`
- 不改变任何 pin link

### discard

将 branch work 重置为 HEAD tree。命令本身即明确的丢弃动作。

### restore

将 branch HEAD 与 work 一起重置到指定 version。dirty 时默认拒绝；`--force` 可明确丢弃
未保存修改。其他 branch 与 pin link 不变。

### branch / work-on

- `branch new` 从 branch HEAD 或指定 version 创建独立 work
- 不复制来源 branch 的 dirty 内容
- `work-on` 只修改 activeBranch，允许当前 branch dirty
- 切换 activeBranch 不改变 link

### check / update

`check` 在临时目录获取 GitHub upstream 并比较 treeHash，不写 version。

状态：

- `equal`：HEAD tree 与 upstream 相同
- `upstream-changed`：upstream 不同，本地未从上游基线继续保存
- `local-diverged`：本地 HEAD 已离开 upstreamBaseVersion，且 upstream 不同
- `unavailable`：网络、权限、ref 或路径不可用

`update` 默认只预览。`update --apply` 要求 work clean；本地已分叉时拒绝，除非明确
`--force`。成功应用后创建 upstream version，并让 branch HEAD、work 与
`upstreamBaseVersion` 指向它。pin 不变。

### diff

CLI 与 WebUI 调用系统 `diff -ruN` 比较：

- work 与 HEAD
- work 与指定 version
- work 与另一 branch
- work 与临时 upstream tree

diff 只读，不创建 version。

### link / unlink

`link --to <leaf>` 的目标是最终 symlink 路径：

- 默认 live `@main`
- `--pin` 将 branch ref 解析为当前 HEAD version
- 显式 version ref 自动 pin
- `--force` 只允许替换 symlink，不删除普通文件或目录
- `unlink` 必须确认记录存在，并拒绝删除不再指向该 skill 的有效 symlink

preset：

- pi: `~/.pi/agent/skills/<localId>`
- agents: `~/.agents/skills/<localId>`
- claude: `~/.claude/skills/<localId>`

### remove

有 link 时默认拒绝。`--force` 只清理由 skillcoffer 记录的 symlink，再删除该 skill 的
store 目录。

## 7. GitHub Source

接受：

- `owner/repo[/path]`
- `owner/repo[/path]@ref`
- `github:owner/repo[/path]`
- `https://github.com/owner/repo/tree/ref/path`

获取流程使用系统 git：

1. 创建私有临时仓库
2. shallow fetch requested ref
3. 解析 `FETCH_HEAD` 为完整 commit SHA
4. sparse checkout 可选 skill path
5. 验证 `SKILL.md`
6. 调用者完成后删除临时目录

当前只承诺公开仓库。git 交互禁用终端密码提示。

## 8. Bundle 与 pi

Bundle 是目录，不维护第二份 JSON。成员 symlink 的目标决定模式：

- main work 为 live
- main HEAD version tree 为 pin

`bundle add` 可覆盖已有成员 symlink 以切换模式；普通文件会被拒绝。删除 bundle 前必须
确认全部成员都是 symlink。

`skillcoffer pi <skill|bundle>...` 将名称解析为路径，并为每个路径生成
`--skill <path>`。`--pin` 只影响直接传入的 skill；bundle 成员保持自身模式。`--print`
只输出命令，不启动 pi。

## 9. CLI 表面

```text
add | list | status | path | versions | save | restore | discard
branch list | branch new | work-on
link | unlink | diff | check | update | remove | doctor | demo
bundle create | bundle add | bundle path | bundle list
pi <skill|bundle>... [--pin] [--print] [-- <pi args>]
ui [--port] [--open]
```

当 store 只有一个 skill 时，可省略部分命令的 skill 名。错误写到 stderr，并以非零状态
退出；正常输出面向人类，不承诺稳定的机器解析格式。

## 10. Doctor

Doctor 只检查并报告，不猜测性重建状态：

- branch HEAD tree 是否存在
- version metadata 与 treeHash 是否匹配
- link 记录是否缺失或悬空
- bundle 成员是否为 symlink 且目标存在

WebUI 仅允许自动执行可验证的坏 link 清理。

## 11. 实现边界

- `src/store.ts`：领域状态与文件系统操作
- `src/github.ts`：GitHub spec 与临时 snapshot
- `src/cli.ts`：参数、输出与进程启动
- `src/ui/server.ts`：localhost API 与静态资源
- `src/ui/contracts.ts`：服务端/浏览器共享响应类型
- `web/src`：React 操作面

CLI 和 UI 可以有不同展示模型，但不得复制 `Store` 的状态迁移逻辑。

## 12. 延期事项

只有出现实际需求后再设计：

- 私有 GitHub 凭据
- 集合安装与远程搜索
- branch 删除与 version GC
- 存储限额和磁盘用量管理
- Windows link 替代方案
- publish、skillpack、registry adapter
- 项目级、多用户或远程 store

延期事项不预留接口、配置或 manifest 字段。
