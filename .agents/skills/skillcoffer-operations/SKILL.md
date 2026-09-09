---
name: skillcoffer-operations
description: Use skillcoffer (skco) to install, edit, version, update, publish, mount, bundle, and launch agent skills; back up or restore its Store with a GitHub Backend; and troubleshoot Store busy or broken links. Use for skillcoffer operation requests, GitHub skill installation URLs, and live/pin mount questions even when no command is supplied.
compatibility: Node.js >=20 on Linux/macOS; skco CLI. GitHub operations require Git/network, comparisons require diff, and Pi sessions require pi.
---

# Skillcoffer operations

Inspect relevant state, execute the requested operation, verify the result.
Reuse authorization already given. Run Store writes serially.

## Start

```bash
command -v skco
skco --help
```

If missing and installation is requested, run `npm install -g skillcoffer`,
then verify help. Inspect `SKILLCOFFER_HOME`; default is `~/.skillcoffer`.
Use explicit Skill names. Inspect only what the task needs:

```bash
skco list
skco status <skill> -v
skco bundle list
```

This guide covers v0.4.0. Check installed help when a command is unavailable.
CLI output is for humans; do not depend on its formatting for parsing.

## Essential rules

- `add` imports a Skill; the agent sees it only through a mount or session input.
- Each branch has writable work and an immutable HEAD Version. Edit work only.
- Live links expose unsaved edits immediately. Pins stay on one saved Version.
- Editing commands default to the active branch. New links, CLI Bundle members,
  and direct `skco pi <skill>` default to **main**.
- `publish` sends saved HEAD. Backend push backs up the Store **including dirty work**.

## Install

```bash
skco add ./my-skill
skco add owner/repo/path --ref main
skco add 'https://github.com/owner/repo/tree/main/skills'
skco add owner/repo --ref main
skco status <skill> -v
```

Local/GitHub directories can contain one Skill or a collection. Discovery stops
at each `SKILL.md` root. Existing IDs are skipped; duplicate names fail before
import. `--name <id>` requires one discovered Skill. Collections can partially
succeed: inspect added/skipped/failed results before retrying.

A tree URL supplies its own ref. For refs containing `/`, use
`owner/repo/path --ref feature/foo`. On a transient network error, inspect
installed state and retry once; do not delete existing Skills to retry.

`add --agent pi|agents|claude` links newly added Skills live. If linking fails
after import, finish with `link --to`; another add skips installed Skills.

## Edit and save

```bash
skco path <skill>
skco diff <skill>
skco save <skill> -m '<reason>'
skco status <skill> -v
```

Edit files under the returned work path. Preserve the user's save note.
A clean save is a no-op; pins remain unchanged.

## Restore and branch

```bash
skco versions <skill>
skco restore <skill> <version-id>
skco branch new <skill> <branch> --from <branch-or-version>
skco work-on <skill> <branch>
```

Restore resets HEAD and work; historical Versions and pins remain. Dirty work
requires `--force`. `skco discard <skill>` resets unsaved work to HEAD. Establish
which edits the user authorized discarding before either destructive action.

New branches start from saved content, not dirty work; omitted `--from` uses
active HEAD. `work-on` changes the CLI default without moving existing links.

| Parameter | Meaning |
|---|---|
| `save/restore/discard/check/update/publish --branch <branch>` | Select the operation's branch |
| `path --ref <branch>` | Return editable work for that branch |
| `path --ref <version-id>` | Return immutable content for inspection only |
| `diff --branch <other>` / `--version <id>` | Compare active work against that branch's work / saved Version |
| `diff --upstream` | Compare active work with upstream; adding `--branch` does not select another work branch |

## Review and apply upstream

```bash
skco check <skill>
skco diff <skill> --upstream
skco update <skill>
```

- `equal`: saved HEAD matches upstream; work may still be dirty.
- `upstream-changed`: upstream differs; HEAD is still at its imported base.
- `local-diverged`: HEAD differs and has moved from its imported base, or that
  base is unknown. This does **not** prove the remote changed.
- `unavailable`: no GitHub upstream or fetching failed.

`update` previews. For another branch, use `update --branch <branch>` to preview
without switching the active branch. When applying is authorized:

```bash
skco update <skill> --branch <branch> --apply
skco status <skill> -v
```

Apply requires clean work even with `--force`. Force resets diverged saved
content to upstream; it does not merge. Historical Versions and pins survive.
CLI apply fetches again; re-review if upstream may have changed and verify the
applied commit. Local file sources do not support GitHub check/update.

## Publish

Inspect `status <skill> -v`, the selected HEAD, and the destination first.
Publishing requires an existing GitHub repository, Git write credentials and
commit identity. Once authorized:

```bash
skco publish <skill> owner/repo/path --ref main --branch <branch>
skco publish <skill> --branch <branch>
skco status <skill> -v
```

The first successful publish binds repo/path/ref; later calls reuse it.
`--branch` selects local HEAD; `--ref` selects the remote branch. Unsaved edits
are excluded. Publish commits/pushes immediately; no preview or force mode.
Rebinding is unsupported. Different existing target content or subsequent
external target changes are refused. Publication does not change Upstream.

## Mount and unmount

Use the requested leaf path, such as `$HOME/.pi/agent/skills/<skill>`,
`$HOME/.agents/skills/<skill>`, or `$HOME/.claude/skills/<skill>`:

```bash
skco link <skill> --to <leaf-path> --ref <branch>
skco link <skill> --to <leaf-path> --pin --ref <branch-or-version>
skco link <skill> --to <leaf-path> --repin --ref <branch>
```

Repin requires a recorded link and makes it pinned, including an existing live
link. Omitted `--ref` means **main HEAD**, not the active or original branch.
Verify status, the actual symlink target, and `<leaf-path>/SKILL.md`.

`link` refuses ordinary files/directories; replacing an unrecorded symlink with
`--force` needs authorization for that replacement. To unmount when requested:

```bash
skco unlink <skill> --to <leaf-path>
```

## Bundles and sessions

```bash
skco bundle create <bundle>
skco bundle add <bundle> <skill-a>
skco bundle add <bundle> <skill-b> --pin
skco bundle list
skco pi <bundle> --print
skco pi <bundle> -- --model <model>
```

CLI members use main work or main HEAD. Repeating `bundle add` replaces the
member; with `--pin` it refreshes to main HEAD. CLI `bundle add` ignores `--ref`.
Direct `skco pi <skill> --pin` uses main HEAD; it does not alter Bundle modes.
`--print` previews without launching. Bundle names win over Skill names on collision.

CLI Bundle commands are only `create|add|path|list`. Use the supported
[WebUI operations](references/web-ui.md) for removal or precise member refs;
do not invent CLI commands or manually change Store internals.

## Other operations

- **Store backup/restore:** read [Backend](references/backend.md) before using
  `skco backend push|pull|status`.
- **WebUI:** read [WebUI](references/web-ui.md) for `skco ui --open`, Bundle
  operations, and batch update checks.
- **Remove, Doctor, Store busy, or experiments:** read
  [Troubleshooting](references/troubleshooting.md) before proceeding.

Report the relevant Skill/Bundle, branch/HEAD, clean or dirty state, mount mode
and verified path. For remote operations include destination/ref and commit.
Mention failures or unverified results; import alone is not agent availability.
