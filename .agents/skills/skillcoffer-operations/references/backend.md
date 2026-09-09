# Backend backup and restore

Inspect `SKILLCOFFER_HOME` and run `skco backend status`. Backend uses a dedicated,
already-created GitHub repository, system Git credentials, and a Git commit
identity for push. It is separate from Skill Upstream and Publication.

## First sync

For an authorized backup:

```bash
skco backend push owner/skill-vault --ref main
skco backend status
```

First push accepts an empty repository or an identical valid Store Snapshot.
An ordinary repository with a README is not an empty Backend.

For an authorized restore, select an empty Store:

```bash
SKILLCOFFER_HOME=/chosen/empty-store skco backend pull owner/skill-vault --ref main
SKILLCOFFER_HOME=/chosen/empty-store skco backend status
```

First pull requires no Skills or Bundles, including empty Bundles. Do not delete
an existing Store to satisfy this condition. Use a separate path if appropriate.
First success binds repo/ref; later push/pull can omit the target. Rebinding,
ref changes, preview, force overwrite, and automatic merging are unsupported.

## Choose the next action

| `backend status` | Meaning and action |
|---|---|
| `unconfigured` | Choose a target and first push or pull |
| `synced` | Push/pull are no-ops |
| `local-changed` | Push backs up local changes; pull is a no-op |
| `remote-changed` | Pull restores remote changes; push refuses |
| `diverged` | Both changed; push and pull refuse. Preserve both states and report the conflict |
| `unavailable` | Diagnose repository/ref, network, or Git credentials |

Run only the authorized direction: `skco backend push` or `skco backend pull`,
then check status. Pull does not undo local edits when the remote is unchanged.
For divergence, a separate empty Store can inspect the remote without erasing
local work. Do not delete binding files or reset history to bypass the conflict.

## What is restored

Snapshots include Versions, branch state, **unsaved work**, notes, executable
bits, Publication, and logical Bundles including empty ones. Saving first is
not required. External harness links and local runtime/cache state are excluded.
Local file-source paths remain provenance; they are not remapped.

Pull validates the Snapshot and rebuilds Bundle links for the destination.
Existing local persistent links survive later pulls only if their Skill/ref
remains valid; otherwise pull refuses. Restoring elsewhere does not mount Skills
into that machine's agents.

Verify relevant `status <skill> -v`, Bundle targets, expected dirty work, and
`backend status`. Report repo/ref, commit, Snapshot hash, and any mounts needed.
Push/pull/status all hold the Store lock; see [Troubleshooting](troubleshooting.md).
