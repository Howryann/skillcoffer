# Troubleshooting and isolated checks

## Store busy

Store writes use `.store-write.lock`; Backend push/pull/status hold it throughout
the operation. If another operation is active, retry after it finishes.

A crashed writer can leave the lock. Only after confirming all CLI/WebUI
processes using that Store have stopped, remove the lock file named in the
error and retry. Do not infer safety from age or PID alone. Restart old processes
after upgrading. The lock does not prevent editors changing work directly.

## Remove a Skill

For an authorized removal:

1. Inspect `skco status <skill> -v` and `skco bundle list`.
2. Remove affected Bundle members through WebUI, preserving unrelated members.
3. Unmount recorded persistent links with `skco unlink <skill> --to <leaf-path>`.
4. Run `skco remove <skill>` and verify remaining Skills, Bundles and mount paths.

Removal rejects recorded persistent links but does not protect Bundle references;
it can leave broken members. `remove --force` deletes the Skill and recorded
symlink leaves without unlink's target check. Prefer explicit unlinks; use force
only when those deletions are authorized. Unlink refuses a live unrelated target
or ordinary file/directory; missing/dangling links can be cleaned up.

## Doctor and links

```bash
skco doctor
skco status <skill> -v
```

Read findings, not just `doctor done`. CLI Doctor checks branch HEAD hashes and
recorded link existence; it does not check every historical Version, correct
symlink targets, or Bundles. Verify actual link targets and `SKILL.md` existence
separately. WebUI Doctor also checks broken/non-symlink Bundle members.

For a missing mount, inspect the recorded mode/ref and recreate the intended
link. For corrupted Version content, preserve evidence and identify a verified
source before recovery; do not edit immutable Version trees to silence Doctor.

## Isolated experiments

If the caller supplied an isolated `SKILLCOFFER_HOME`, use it and preserve its
state for requested verification. Do not replace or clean a caller-owned Store.
Otherwise create a temporary Store and a temporary Skill source you own:

```bash
lab="$(mktemp -d)"
trap 'rm -rf "$lab"' EXIT
export SKILLCOFFER_HOME="$lab/store"
mkdir -p "$lab/source"
printf '%s\n' '---' 'name: demo-skill' 'description: Temporary CLI check.' '---' '# Demo' > "$lab/source/SKILL.md"
skco add "$lab/source"
skco status demo-skill -v
skco doctor
```

Run this in one shell scope. If another process needs the results after exit,
let that caller own cleanup instead. For test links use paths under the lab;
`--agent` targets the real home even with an isolated Store. Run writes serially.
Do not run `skco demo` on a real Store: it can forcibly replace `demo-skill`.
