# WebUI operations

```bash
skco ui --open
skco ui --port 7526
```

Default address: `http://127.0.0.1:7526`. The server binds only to loopback and
uses the selected `SKILLCOFFER_HOME`. Keep the foreground server in the host
agent's supported persistent terminal; verify readiness before browsing.
When browsing remotely, use an already available browser/tunnel workflow.

The UI supports installation, file browsing, Diff, save/restore/discard,
upstream updates, Links, Bundles, and Doctor. Edit Skill content with an editor.
Viewing another branch does not change the CLI active branch.

## Capabilities beyond the CLI

- **Bundles:** add members, select live branches or pinned Versions, change mode,
  remove members, and delete Bundles. Removal keeps the stored Skills. Inspect
  the resulting members and targets. CLI has no Bundle remove command and its
  `bundle add` does not forward `--ref`.
- **Batch checks:** the Skills list can check GitHub sources with progress and
  retained results. Checks do not apply updates. Badges use the displayed
  branch's imported base; local-only changes and unrelated repository changes
  do not count as updates. Read failure/unknown state separately and check the
  observation time before treating a badge as current.
- **Update previews:** applying uses the preview's local HEAD and upstream commit.
  If either changed, preview again; do not bypass a stale-preview failure.
- **Doctor:** additionally reports broken Bundle members and non-symlink members.
  Its link cleanup removes stale mounts/records; it does not repair Skill content.

Use supported UI controls when requested. If no browser-control capability is
available, give the user the precise UI action and report the operation as
pending rather than inventing a CLI equivalent. Publish and Backend workflows
in this guide use the CLI.
