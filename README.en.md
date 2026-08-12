# skillcoffer

**Version, review, and compose Agent Skills without giving up local control.**

[简体中文](./README.md) | **English**

[![MIT License](https://img.shields.io/badge/license-MIT-2ea44f.svg)](./LICENSE)
![Node.js >= 20](https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)
![Status: early development](https://img.shields.io/badge/status-early%20development-f0ad4e)

skillcoffer turns loose [Agent Skills](https://agentskills.io) directories into an inspectable local workflow: install from disk or public GitHub, edit on independent branches, preserve known-good states as immutable snapshots, review upstream diffs before updating, and mount or compose exactly what a [pi](https://github.com/badlogic/pi-mono) session needs.

No database, hosted service, or new agent runtime is required. Use `skillcoffer`, or the equivalent short command `skco`.

![skillcoffer WebUI showing unsaved changes, branches, live and pinned links, and version history](./docs/images/skill-overview.png)

<p align="center"><sub>Live WebUI, currently available in Simplified Chinese: unsaved changes, branch status, live / pinned links, and immutable versions in one view.</sub></p>

## Why skillcoffer

| Capability | What it does |
|------------|--------------|
| **Edit freely, roll back cleanly** | `save` creates an immutable snapshot; `restore` resets the current branch's work tree and HEAD to any snapshot without moving existing links. |
| **Review before updating** | Inspect upstream changes with `check` / `diff`, then explicitly run `update --apply`; GitHub refs resolve to recorded commit SHAs. |
| **Choose live iteration or reproducibility** | Live links follow editable work for rapid iteration; pinned links stay on an immutable version for important sessions. |
| **Compose capabilities per session** | A bundle can mix live and pinned skills, then generate or execute the matching `pi --skill ...` command. |
| **Keep ownership local** | State is ordinary directories, JSON, and symlinks that you can inspect, back up, and recover; the WebUI only listens on loopback. |

skillcoffer is not a replacement for Git, a remote marketplace, or an agent runtime. It focuses on the local lifecycle from skill installation and editing through review and use.

## Requirements

- Node.js 20 or newer
- Git for fetching GitHub sources
- `diff` for CLI and WebUI directory comparisons
- Linux or macOS; Windows junction/copy support is not implemented yet
- pi is optional and is only invoked by `skillcoffer pi ...`

## Installation

The package is not published to the npm registry yet. Install it from source:

```bash
git clone https://github.com/Howryann/skillcoffer.git
cd skillcoffer
npm ci
npm run build
npm install -g .
```

Verify both commands:

```bash
skillcoffer --help
skco --help
```

To run from the repository without a global install:

```bash
npm run skco -- --help
```

## Let an Agent Install and Learn skillcoffer

You do not need to clone or install anything first. Give this prompt directly to
an agent with terminal access:

```text
Install skillcoffer for yourself and learn how to use it:

1. Check whether `skco --help` works. If it does not, clone
   https://github.com/Howryann/skillcoffer.git into a temporary directory,
   follow the repository README to install it, then verify `skco --help`.
   Do not ask me to run these commands manually.
2. Use `skco` to install:
   https://github.com/Howryann/skillcoffer/tree/main/.agents/skills/skillcoffer-operations
3. Mount `skillcoffer-operations` live at
   `~/.agents/skills/skillcoffer-operations` so future agent sessions discover it.
4. If the CLI, skill, or mount already exists, inspect and reuse it. Do not delete
   the Store, overwrite ordinary files, or use `--force`.
5. Read `SKILL.md` under `skco path skillcoffer-operations` and immediately
   follow its workflow for the rest of this task; do not wait for a new session.
6. Run final status checks and report the CLI, skill, mount path, and verification
   results.
```

The current agent can then operate skillcoffer using the installed Skill, and
future sessions will discover it from `~/.agents/skills/`.

## Quick Start

### 1. Install a public GitHub skill

```bash
skillcoffer add anthropics/skills/skills/pdf --ref main
skillcoffer status pdf -v
```

You can also install a local directory:

```bash
skillcoffer add ./my-skill
```

The skill root must contain `SKILL.md`.

### 2. Edit and save

```bash
skillcoffer path pdf
$EDITOR "$(skillcoffer path pdf)/SKILL.md"
skillcoffer status pdf
skillcoffer save pdf -m "Tune PDF extraction workflow"
```

`path` returns the editable directory for the active branch. Do not edit the installation source or a version tree directly.

### 3. Review and apply upstream changes

```bash
skillcoffer check pdf
skillcoffer diff pdf --upstream
skillcoffer update pdf --apply
```

`update` previews by default. It only writes a new upstream version when `--apply` is present.

### 4. Use a skill in one pi session

```bash
skillcoffer pi pdf --print
skillcoffer pi pdf
skillcoffer pi pdf --pin
```

- The default uses current work.
- `--pin` uses the immutable version at HEAD.
- `--print` only displays the command that would run.

### 5. Compose several skills

```bash
skillcoffer bundle create research
skillcoffer bundle add research pdf --pin
skillcoffer bundle add research demo-skill
skillcoffer pi research --print
skillcoffer pi research -- --model your-model
```

Each bundle member can be live or pinned independently.

## Persistent Links

A skill can be linked to a common agent directory during installation:

```bash
skillcoffer add ./my-skill --agent pi
skillcoffer add ./another-skill --agent agents
skillcoffer add ./claude-skill --agent claude
```

Or provide an explicit symlink destination:

```bash
skillcoffer link pdf --to "$HOME/.pi/agent/skills/pdf"
skillcoffer unlink pdf --to "$HOME/.pi/agent/skills/pdf"
```

A live link immediately exposes unsaved changes in work. Use `--pin` when reproducibility matters.

## WebUI

```bash
skillcoffer ui --open
```

The default address is [http://127.0.0.1:7526](http://127.0.0.1:7526). Override it with `--port`. The server binds only to the local loopback interface.

The WebUI supports installation, status, file browsing, diffs, save and restore, upstream updates, links, bundles, and Doctor operations. Skill content remains editable in your own editor. The current interface is in Simplified Chinese.

![skillcoffer bundle page showing live and pinned members with a pi launch command](./docs/images/bundle-composition.png)

<p align="center"><sub>Bundles can mix live and pinned members; dirty live skills are called out before they enter a session.</sub></p>

## Core Model

| Concept | Meaning |
|---------|---------|
| **Work** | The editable file tree for one branch |
| **Version** | An immutable snapshot created by installation, `save`, or update |
| **Branch** | A named line of work with its own work directory and HEAD |
| **Live link** | Points to work, so edits become visible immediately |
| **Pin link** | Points to a version tree and does not move after later saves |
| **Bundle** | A set of live or pinned skills for one pi session |

See the [design contract](./docs/design.md) for detailed semantics and the [WebUI contract](./docs/webui.md) for interface boundaries. These documents are currently written in Chinese.

## CLI Reference

| Task | Commands |
|------|----------|
| Install and inspect | `add`, `list`, `status`, `path` |
| Versions | `save`, `versions`, `restore`, `discard` |
| Branches | `branch list`, `branch new`, `work-on` |
| Upstream | `check`, `diff`, `update` |
| Links | `link`, `unlink` |
| Bundles | `bundle create`, `bundle add`, `bundle path`, `bundle list` |
| Launch pi | `pi <skill\|bundle>...` |
| Maintenance | `doctor`, `remove`, `demo`, `ui` |

Run `skillcoffer --help` for the complete command entry points. CLI output is currently human-oriented and is not a stable machine-readable interface.

## Store and Security Boundaries

The default store is `~/.skillcoffer`. Override it with an environment variable:

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

- Installation, checks, and diffs never execute scripts from a skill.
- Skill trees entering the store cannot contain symlinks or special files.
- GitHub upstream refs are resolved to a concrete commit before use.
- The WebUI listens only on `127.0.0.1` and has no remote multi-user authentication.
- The store is local state; back it up like other development data.

## Development

```bash
git clone https://github.com/Howryann/skillcoffer.git
cd skillcoffer
npm ci
npm test
npm run build
```

For WebUI development, run these commands in separate terminals:

```bash
node dist/cli.js ui
npm run dev:ui
```

The Vite development server proxies `/api` to local port `7526`.

## Contributing

Issues and pull requests are welcome. Before submitting a change, run:

```bash
npm test
npm run build
```

Changes to state semantics, manifests, or filesystem layout should update the [design contract](./docs/design.md). Changes to WebUI behavior should update the [WebUI contract](./docs/webui.md). Please open an issue first for larger features so the scope can be agreed upon.

## Project Status

skillcoffer is in early development. Its core local workflows are usable, but the CLI, WebUI, and storage contract may still change incompatibly before `1.0`.

It does not currently include a remote skill marketplace, publishing service, first-class private GitHub support, collection installation, shell completion, a Windows link fallback, or team permissions.

## License

[MIT](./LICENSE) © Howryann
