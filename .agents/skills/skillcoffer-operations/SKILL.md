---
name: skillcoffer-operations
description: Operate and troubleshoot skillcoffer (`skco`) safely. Use whenever the user asks to install, inspect, edit, save, restore, branch, compare, update, link, unlink, bundle, remove, or launch agent skills with skillcoffer, including requests that only provide a GitHub skill URL or mention live/pin mounts.
compatibility: Requires the skco CLI. GitHub sources also require git and network access.
---

# Skillcoffer Operations

Use `skco` as the short form of `skillcoffer`. Inspect the current state before
mutating it, perform one write at a time, and verify the resulting state.

## Mental model

- The store defaults to `~/.skillcoffer`; `SKILLCOFFER_HOME` selects another store.
- `add` imports a skill into the store. It creates an immutable version and a
  writable `main` work tree, but does not expose the skill to an agent unless a
  link option was explicitly requested.
- A branch has an immutable HEAD version and an independent writable work tree.
  `dirty` means the work tree differs from HEAD.
- `save` creates a local version and moves that branch's HEAD. It does not move
  pinned links.
- A live link points to a branch work tree and sees edits immediately. A pin
  points to one immutable version.
- A bundle is a directory of live or pinned skill links. It is a session input,
  not a global agent mount.
- `skco pi ...` passes skill or bundle paths to one Pi session. `--print` shows
  the command without starting Pi.
- GitHub installs record both the requested ref and the commit resolved during
  each imported upstream snapshot.

Never edit a version tree. Edit only the path returned by `skco path <skill>`.

## Establish state

Run the smallest relevant inspection first:

```bash
command -v skco
skco --help
skco list
skco status <skill> -v
skco bundle list
```

Use an explicit skill name even when the CLI could infer the only installed
skill. CLI output is intended for humans; do not build brittle parsers around
`status` or `list` formatting.

When operating inside the skillcoffer source repository, treat these as the
authorities for current behavior:

- `docs/design.md`: domain and safety contract
- `src/cli.ts`: supported command surface and flags
- `src/store.ts`: state transitions and filesystem behavior
- `src/github.ts`: GitHub source parsing and acquisition

## Install

Install a local directory or a public GitHub skill directory:

```bash
skco add ./path/to/skill
skco add 'owner/repo/path/to/skill' --ref main
skco add 'https://github.com/owner/repo/tree/main/path/to/skill'
```

The source directory must contain `SKILL.md` with a valid lowercase hyphenated
`name`. Use `--name <local-id>` only to resolve a deliberate local name
collision. Existing local IDs are rejected rather than overwritten.

After installation, verify the snapshot rather than trusting one success line:

```bash
skco status <skill> -v
work="$(skco path <skill>)"
test -f "$work/SKILL.md"
```

GitHub acquisition can fail transiently during fetch or sparse checkout. On a
network/TLS error, inspect `skco list` first, then retry once if no skill was
created. Never remove an existing skill merely to make a retry succeed.

An embedded `/tree/<ref>/...` URL supplies the ref itself. Prefer either that
form or `owner/repo/path --ref <ref>`; do not combine them expecting `--ref` to
override the URL.

## Review and save edits

Inspect user edits before recording them:

```bash
skco status <skill> -v
skco diff <skill>
skco save <skill> -m '<meaningful reason>'
skco status <skill> -v
```

Preserve the user's wording for the save note when they provide one. A clean
save is a no-op and returns the existing HEAD.

To discard unsaved work, first show that it is dirty and confirm destructive
intent unless the user explicitly asked to discard:

```bash
skco discard <skill>
```

## Restore and branch

List versions before selecting a restore target:

```bash
skco versions <skill>
skco restore <skill> <version-id>
skco status <skill> -v
```

Restore moves the selected branch's HEAD and work tree together. Historical
versions remain available, and pins remain unchanged. Dirty work is rejected
unless `--force` is used; never force away edits without explicit approval.

Use a branch when local work should continue independently:

```bash
skco branch new <skill> <branch>
skco work-on <skill> <branch>
skco branch list <skill>
```

`branch new` starts from a HEAD/version, not unsaved work. `work-on` only changes
the CLI default branch; it does not retarget existing links. Persistent links,
bundles, and direct `skco pi <skill>` resolution default to `main`, not the
active branch. To expose another branch persistently, link it explicitly with
`--ref <branch>`.

## Compare and update GitHub upstream

Use the review-first sequence:

```bash
skco check <skill>
skco diff <skill> --upstream
skco update <skill>
```

Interpret `check` as follows:

- `equal`: local HEAD tree matches current upstream.
- `upstream-changed`: upstream differs and the local branch has not saved past
  its upstream base.
- `local-diverged`: both local saved history and upstream differ.
- `unavailable`: upstream cannot currently be fetched or does not exist.

`skco update` previews. Only run `skco update <skill> --apply` when the user has
asked to apply the update. It requires clean work. Treat `--force` as a hard
reset of locally diverged history and require explicit approval.

## Persistent links

For an existing skill, link explicitly to the requested harness:

```bash
skco link <skill> --to "$HOME/.pi/agent/skills/<skill>"
skco link <skill> --to "$HOME/.agents/skills/<skill>"
skco link <skill> --to "$HOME/.claude/skills/<skill>"
```

The default is `LIVE @main`. Add `--pin` when reproducibility is required:

```bash
skco link <skill> --to <leaf-path> --pin
```

A pin does not advance after `save`. Refresh an existing recorded link to the
current HEAD with `--repin`:

```bash
skco link <skill> --to <leaf-path> --repin
```

`link` refuses ordinary files and directories. `--force` can replace an
unrecorded symlink, so require explicit approval before using it.

`--agent pi|agents|claude` is an install-time convenience for `skco add`; use
`link --to` for an already installed skill. Prefer separate `add` and `link`
steps when recovery matters: an `add --agent` invocation can finish importing
the skill and then fail while creating the link. In that case, inspect `status`
and complete the link instead of retrying the install.

Verify both the manifest record and the filesystem target:

```bash
skco status <skill> -v
readlink -f <leaf-path>
test -f <leaf-path>/SKILL.md
```

Remove only the recorded link; the stored skill and versions remain:

```bash
skco unlink <skill> --to <leaf-path>
```

## Bundles and session loading

Create a bundle, then add members serially. Members are live unless `--pin` is
present:

```bash
skco bundle create <bundle>
skco bundle add <bundle> <skill-a>
skco bundle add <bundle> <skill-b> --pin
skco bundle list
```

Preview or start a Pi session with the bundle:

```bash
skco pi <bundle> --print
skco pi <bundle>
skco pi <bundle> -- --model <model>
```

For direct skills, `skco pi <skill> --pin` selects the current immutable
`main` HEAD. `--pin` does not rewrite modes already stored inside a bundle. To
refresh a pinned bundle member after saving, run `bundle add <bundle> <skill>
--pin` again; it replaces that member link.

The current CLI exposes only `bundle create|add|path|list`. Do not invent a
`bundle remove` command or manually edit the store when asked to remove a member
or bundle; re-check `skco --help` because this surface may change, then report
the current limitation or use an explicitly requested supported UI operation.

## Removal and health checks

Run `skco doctor` after filesystem-level troubleshooting. Remove a skill only
on explicit request:

```bash
skco remove <skill>
```

Removal is rejected while links exist. Prefer explicit `unlink` operations
followed by `remove`, because `unlink` verifies the symlink still points at the
skill. `remove --force` removes recorded symlink leaves and the entire stored
skill without the same target check, so require explicit confirmation before
using it.

The CLI `doctor` checks branch HEAD trees, version hashes, and recorded skill
links. It does not currently validate every bundle invariant; inspect bundles
separately with `skco bundle list` and filesystem checks when diagnosing them.

## Safe experiments

First inspect `SKILLCOFFER_HOME`. If the caller already set it to an explicit
isolated path, use that store as supplied; do not silently replace it with a
second temporary store. Preserve caller-owned state long enough for any
requested external verification.

When no isolated store was supplied, create one and clean only the directory
this process created:

```bash
lab="$(mktemp -d)"
trap 'rm -rf "$lab"' EXIT
export SKILLCOFFER_HOME="$lab/store"
skco add ./examples/demo-skill
skco status demo-skill -v
skco doctor
```

Do not clean or replace a store you did not create. If a test harness needs to
inspect the result after the agent exits, let the harness own cleanup instead
of installing an EXIT trap.

Do not use `--agent` in an isolated experiment: harness preset paths are under
the real home directory, independent of `SKILLCOFFER_HOME`. If link behavior
must be tested, use `link --to "$lab/mounts/<skill>"` and unlink it afterward.

The current store lock is prototype-grade. Never run mutating `skco` commands
in parallel, including multiple `bundle add` operations.

## Report results

State the skill or bundle name, resulting mode (`live` or `pin`), relevant path,
HEAD/upstream identity when applicable, and whether the final work tree is
clean. Mention retries or commands that could not be verified. Do not claim a
skill is available to a harness merely because it was added to the store.
