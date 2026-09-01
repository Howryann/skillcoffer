# Storage Backend Design

## Terms

- **Storage Backend**: one dedicated GitHub repository bound to one Store.
- **Portable Store Snapshot**: the canonical, validated Store representation committed under `snapshot/`.
- **Sync baseline**: the remote commit and Snapshot hash recorded after a successful push or pull.

## Snapshot Schema 1

```text
snapshot/
  snapshot.json
  skills/<id>/manifest.json
  skills/<id>/versions/<version>/{version.json,tree/}
  skills/<id>/branches/<branch>/work/
```

`snapshot.json` records Bundle names and logical members, including empty Bundles. A member stores its Skill, live/pin mode, and Branch or Version ref. Physical Bundle symlinks are rebuilt for the restored Store path.

Skill manifests retain Branch, Upstream, active Branch and Publication state. External harness Links and manifest `updatedAt` are omitted because they are machine-local or non-domain state. Version metadata, notes, resolved commits, dirty work and executable bits remain in the Snapshot.

The Snapshot excludes `backend.json`, Store locks, temporary files, filesystem ownership, ACLs and mtimes. Local file Upstream paths remain provenance only and are not remapped.

## Local Backend State

`$SKILLCOFFER_HOME/backend.json` uses schema 1:

```json
{
  "schemaVersion": 1,
  "repo": "owner/repo",
  "ref": "main",
  "commit": "...",
  "snapshotHash": "..."
}
```

It is written only after a successful first push or pull. Existing Stores without this file remain unconfigured and need no migration.

## Synchronization

| Local vs baseline | Remote vs baseline | Status | Push | Pull |
|---|---|---|---|---|
| same | same | `synced` | no-op | no-op |
| changed | same | `local-changed` | commit and push | no-op |
| same | changed | `remote-changed` | reject | restore and advance baseline |
| changed | changed | `diverged` | reject | reject |

The first push accepts an empty repository or an existing valid, identical Snapshot. The first pull requires an empty Store. Ref changes and Backend rebinding are rejected; there is no force mode.

## Restore Safety

Pull validates the full Snapshot in a sibling staging directory before replacing `skills/` and `bundles/`. Version hashes are verified, Version trees become owner-read-only, work trees become owner-writable, and executable bits are preserved. Replacement uses same-filesystem renames with rollback on an operation error.

External harness Links are never imported. A later pull overlays existing local Link records when their Skill and ref remain valid; otherwise it fails before replacing Store state. Publication state is ordinary manifest data and round-trips without invoking Publication code.
