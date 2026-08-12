#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { looksLikeGithubSpec } from "./github.js";
import {
  Store,
  agentPresetPath,
  defaultHome,
  printLiveWarning,
  treeHashOf,
} from "./store.js";

function die(msg: string, code = 2): never {
  console.error(`error: ${msg}`);
  process.exit(code);
}

function usage(): never {
  console.log(`skillcoffer — manage agent skills locally, launch pi with --skill

Store: $SKILLCOFFER_HOME (default: ${defaultHome()})
Short command: skco

Pi (session-level):
  skillcoffer pi <skill|bundle>... [--pin] [--print] [-- <pi args>]
  skillcoffer bundle create|add|path|list

Skills:
  add <path|owner/repo[/path]> [--ref] [--name] [--agent pi|agents|claude]
  list | status | path | versions | save | restore | discard
  branch | work-on | link | unlink | diff | check | update | remove | doctor | demo
  ui [--port] [--open]

Install (from this repo):
  npm install -g .
  # or: npm link

Examples:
  skillcoffer add ./examples/demo-skill
  skillcoffer add anthropics/skills/skills/pdf
  skillcoffer bundle create coding
  skillcoffer bundle add coding pdf
  skillcoffer pi coding --print
`);
  process.exit(0);
}

type Flags = Record<string, string | boolean | undefined>;

const cliOptions = {
  name: { type: "string" },
  link: { type: "string" },
  agent: { type: "string" },
  branch: { type: "string" },
  from: { type: "string" },
  ref: { type: "string" },
  to: { type: "string" },
  message: { type: "string", short: "m" },
  version: { type: "string" },
  upstream: { type: "boolean" },
  apply: { type: "boolean" },
  force: { type: "boolean" },
  pin: { type: "boolean" },
  repin: { type: "boolean" },
  v: { type: "boolean", short: "v" },
  "dry-run": { type: "boolean" },
  print: { type: "boolean" },
  port: { type: "string" },
  open: { type: "boolean" },
} as const;

function parseCliArgs(argv: string[]) {
  const separator = argv.indexOf("--");
  const args = separator === -1 ? argv : argv.slice(0, separator);
  const rest = separator === -1 ? [] : argv.slice(separator + 1);
  try {
    const { values, positionals } = parseArgs({
      args,
      options: cliOptions,
      allowPositionals: true,
    });
    return { pos: positionals, flags: values as Flags, rest };
  } catch (e) {
    die(e instanceof Error ? e.message : String(e));
  }
}

function flag(flags: Flags, k: string): string | undefined {
  const v = flags[k];
  return typeof v === "string" ? v : undefined;
}

function has(flags: Flags, k: string): boolean {
  return flags[k] === true;
}

function needName(store: Store, posName?: string): string {
  if (posName) return posName;
  const all = store.list();
  if (all.length === 1) return all[0].localId;
  die("skill name required (or install exactly one skill)");
}

function cmdAdd(store: Store, pos: string[], flags: Flags) {
  const src = pos[0] || die("add <path|owner/repo[/path]>");
  const m = looksLikeGithubSpec(src)
    ? store.addFromGithub(src, { name: flag(flags, "name"), ref: flag(flags, "ref") })
    : store.addFromFile(src, { name: flag(flags, "name") });
  const work = store.pathOf(m.localId, "main");
  console.log(`added ${m.localId} (name=${m.name})`);
  console.log(`edit: ${work}`);
  console.log(`store: ${store.skillDir(m.localId)}`);
  if (m.upstream?.remote === "github") {
    console.log(
      `upstream: github:${m.upstream.repo}${m.upstream.path ? "/" + m.upstream.path : ""}@${m.upstream.requestedRef}`,
    );
  }

  let linkTo = flag(flags, "link");
  const agent = flag(flags, "agent");
  if (agent) linkTo = agentPresetPath(agent, m.localId);
  if (linkTo) {
    const rec = store.link(m.localId, linkTo, { ref: "main" });
    console.log(`linked ${rec.mode.toUpperCase()} @${rec.ref} -> ${rec.to}`);
    console.log(printLiveWarning(rec.mode));
  } else {
    const suggest = agentPresetPath("agents", m.localId);
    console.log(`not linked (harness will not see it yet)`);
    console.log(`next: skillcoffer link ${m.localId} --to ${suggest}`);
  }
}

function cmdStatus(store: Store, pos: string[], flags: Flags) {
  const name = needName(store, pos[0]);
  const { manifest: m, dirty, versions } = store.status(name);
  console.log(`skill: ${m.localId}`);
  console.log(`editing: ${m.activeBranch}${dirty[m.activeBranch] ? " (有未存档修改)" : " (clean)"}`);
  console.log(`work: ${store.workDir(m.localId, m.activeBranch)}`);
  console.log("branches:");
  for (const [b, st] of Object.entries(m.branches)) {
    const mark = b === m.activeBranch ? "*" : " ";
    const d = dirty[b] ? " dirty" : "";
    console.log(`  ${mark} ${b}  head=${st.head}${d}`);
  }
  const liveCount = m.links.filter((l) => l.mode === "live").length;
  if (dirty[m.activeBranch] && liveCount) {
    console.log(`警告: ${liveCount} 个直播挂载会看到未存档修改`);
  }
  console.log("links:");
  if (!m.links.length) console.log("  (none)");
  for (const l of m.links) {
    console.log(`  ${l.mode.toUpperCase()} @${l.ref} -> ${l.to}`);
  }
  if (has(flags, "v")) {
    console.log("versions:");
    for (const v of versions) console.log(`  ${store.describeVersion(v, m)}`);
    if (m.upstream) console.log(`upstream: ${JSON.stringify(m.upstream)}`);
  } else {
    console.log(`versions: ${versions.length} (use -v or 'versions' to list)`);
  }
}

function cmdVersions(store: Store, pos: string[]) {
  const name = needName(store, pos[0]);
  const { manifest: m, versions } = store.status(name);
  for (const v of versions) console.log(store.describeVersion(v, m));
}

function runDiff(left: string, right: string, labelLeft: string, labelRight: string) {
  console.log(`diff: ${labelRight} vs ${labelLeft}`);
  console.log(`  left(old)=${left}`);
  console.log(`  right(new)=${right}`);
  const r = spawnSync("diff", ["-ruN", left, right], { encoding: "utf8" });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.status === 0) console.log("(no diff — 两边一致)");
  if (r.status !== 0 && r.status !== 1) {
    die(r.stderr || `diff failed with ${r.status}`);
  }
}

function cmdDiff(store: Store, pos: string[], flags: Flags) {
  const name = needName(store, pos[0]);
  const m = store.status(name).manifest;
  const branch = m.activeBranch;
  const work = store.workDir(name, branch);

  if (has(flags, "upstream")) {
    store.withUpstreamTree(name, (treeDir, snap) => {
      runDiff(
        treeDir,
        work,
        `upstream ${snap.repo}@${snap.resolvedCommit.slice(0, 7)}`,
        `work(${branch})`,
      );
    });
    return;
  }

  let left: string;
  let label: string;
  const ver = flag(flags, "version");
  const br = flag(flags, "branch");
  if (ver) {
    left = store.versionTree(name, ver);
    label = `version ${ver}`;
  } else if (br) {
    left = store.workDir(name, br);
    label = `branch ${br} work`;
  } else {
    const head = m.branches[branch].head;
    left = store.versionTree(name, head);
    label = `HEAD ${branch} (${head})`;
  }
  runDiff(left, work, label, `work(${branch})`);
}

function cmdCheck(store: Store, pos: string[], flags: Flags) {
  const name = needName(store, pos[0]);
  const r = store.check(name, { branch: flag(flags, "branch") });
  console.log(`status: ${r.status}`);
  console.log(r.message);
  if (r.resolvedCommit) console.log(`upstream commit: ${r.resolvedCommit}`);
  if (r.localHead) console.log(`local HEAD: ${r.localHead}`);
  if (r.localTreeHash) console.log(`local tree: ${r.localTreeHash.slice(0, 12)}`);
  if (r.upstreamTreeHash) console.log(`upstream tree: ${r.upstreamTreeHash.slice(0, 12)}`);
  if (r.status === "upstream-changed") {
    console.log(`next: skillcoffer diff ${name} --upstream`);
    console.log(`next: skillcoffer update ${name} --apply`);
  }
  if (r.status === "local-diverged") {
    console.log(`next: skillcoffer branch new ${name} try-merge  # or update --apply --force`);
  }
}

function cmdUpdate(store: Store, pos: string[], flags: Flags) {
  const name = needName(store, pos[0]);
  if (!has(flags, "apply")) {
    const r = store.check(name, { branch: flag(flags, "branch") });
    console.log(`status: ${r.status}`);
    console.log(r.message);
    if (r.resolvedCommit) console.log(`upstream commit: ${r.resolvedCommit}`);
    if (r.status === "equal") return;
    if (r.status === "unavailable") die(r.message);
    console.log(`preview diff vs upstream:`);
    try {
      store.withUpstreamTree(name, (treeDir, snap) => {
        const work = store.workDir(name, flag(flags, "branch") ?? store.status(name).manifest.activeBranch);
        runDiff(
          treeDir,
          work,
          `upstream@${snap.resolvedCommit.slice(0, 7)}`,
          "work",
        );
      });
    } catch (e) {
      console.error(e instanceof Error ? e.message : e);
    }
    console.log(`Run: skillcoffer update ${name} --apply`);
    return;
  }
  const { version, check } = store.updateApply(name, {
    branch: flag(flags, "branch"),
    force: has(flags, "force"),
  });
  console.log(`status: ${check.status}`);
  console.log(check.message);
  console.log(`HEAD now ${version.id} tree:${version.treeHash.slice(0, 12)}`);
  if (check.resolvedCommit) console.log(`upstream commit: ${check.resolvedCommit}`);
  console.log("pins unchanged");
}

function cmdDoctor(store: Store) {
  const skills = store.list();
  console.log(`home: ${store.home}`);
  console.log(`skills: ${skills.length}`);
  for (const m of skills) {
    for (const [b, st] of Object.entries(m.branches)) {
      const tree = store.versionTree(m.localId, st.head);
      if (!existsSync(tree)) console.log(`BROKEN head tree ${m.localId}@${b} ${st.head}`);
      else {
        const meta = JSON.parse(
          readFileSync(join(store.versionDir(m.localId, st.head), "version.json"), "utf8"),
        ) as { treeHash: string };
        const th = treeHashOf(tree);
        if (th !== meta.treeHash) console.log(`HASH MISMATCH ${m.localId} ${st.head}`);
      }
    }
    for (const l of m.links) {
      if (!existsSync(l.to)) console.log(`MISSING LINK ${m.localId} -> ${l.to}`);
    }
  }
  console.log("doctor done");
}

function cmdDemo(store: Store) {
  // uses current SKILLCOFFER_HOME
  const demoSrc = resolveDemoSkill();
  const id = "demo-skill";
  if (existsSync(store.manifestPath(id))) store.remove(id, { force: true });
  store.addFromFile(demoSrc);
  const work = store.workDir(id, "main");
  writeFileSync(join(work, "notes.md"), "# Notes\n\nprototype edit\n", "utf8");
  if (!store.isDirty(id, "main")) die("expected dirty after edit", 1);
  const v = store.save(id, { note: "proto edit" });
  if (store.isDirty(id, "main")) die("expected clean after save", 1);
  store.branchNew(id, "try-zh");
  store.workOn(id, "try-zh");
  writeFileSync(join(store.workDir(id, "try-zh"), "notes.md"), "zh trial\n", "utf8");
  store.save(id, { note: "zh" });
  store.workOn(id, "main");
  // main notes should still be prototype edit
  const mainNotes = readFileSync(join(store.workDir(id, "main"), "notes.md"), "utf8");
  if (!mainNotes.includes("prototype edit")) die("main branch isolation failed", 1);
  store.restore(id, v.id);
  console.log("demo OK");
  console.log(`try: SKILLCOFFER_HOME=${store.home} skillcoffer status ${id} -v`);
}

function resolveDemoSkill(): string {
  const candidates = [
    join(dirname(fileURLToPath(import.meta.url)), "../examples/demo-skill"),
    join(process.cwd(), "examples/demo-skill"),
  ];
  for (const c of candidates) if (existsSync(join(c, "SKILL.md"))) return c;
  die("examples/demo-skill not found (package examples/ or cwd)");
}

function cmdBundle(store: Store, pos: string[], flags: Flags) {
  const sub = pos.shift() || die("bundle create|add|path|list");
  if (sub === "create") {
    const name = pos[0] || die("bundle create <name>");
    store.bundleCreate(name);
    console.log(`bundle created: ${name}`);
    console.log(`path: ${store.bundlePath(name)}`);
    return;
  }
  if (sub === "add") {
    const name = pos[0] || die("bundle add <name> <skill>");
    const skill = pos[1] || die("bundle add <name> <skill>");
    store.bundleAdd(name, skill, { pin: has(flags, "pin") });
    const mode = has(flags, "pin") ? "pin" : "live";
    console.log(`bundle ${name} += ${skill} (${mode})`);
    console.log(`path: ${store.bundlePath(name)}`);
    return;
  }
  if (sub === "path") {
    const name = pos[0] || die("bundle path <name>");
    console.log(store.bundlePath(name));
    return;
  }
  if (sub === "list") {
    const all = store.bundleList();
    if (!all.length) {
      console.log("(no bundles)");
      return;
    }
    for (const b of all) {
      const members =
        b.members.map((m) => `${m.skill}:${m.mode}`).join(", ") || "(empty)";
      console.log(`${b.name}\t${members}`);
    }
    return;
  }
  die(`unknown bundle subcommand: ${sub}`);
}

function cmdPi(
  store: Store,
  pos: string[],
  flags: Flags,
  rest: string[],
) {
  const names = pos;
  if (!names.length) die("pi <skill|bundle>... [--pin] [-- <pi args>]");
  const paths = store.resolvePiSkillPaths(names, { pin: has(flags, "pin") });
  const piArgs: string[] = [];
  for (const p of paths) {
    piArgs.push("--skill", p);
  }
  piArgs.push(...rest);

  console.log(`exec: pi ${piArgs.map((a) => (a.includes(" ") ? JSON.stringify(a) : a)).join(" ")}`);

  const dry = has(flags, "dry-run") || has(flags, "print");
  if (dry) return;

  const r = spawnSync("pi", piArgs, { stdio: "inherit" });
  process.exit(r.status ?? 1);
}

function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv[0] === "-h" || argv[0] === "--help") usage();
  const { pos, flags, rest } = parseCliArgs(argv);
  const cmd = pos.shift() || usage();
  const store = new Store(defaultHome());

  try {
    switch (cmd) {
      case "add":
        cmdAdd(store, pos, flags);
        break;
      case "list":
        for (const m of store.list()) {
          console.log(`${m.localId}\tactive=${m.activeBranch}\tlinks=${m.links.length}`);
        }
        break;
      case "status":
        cmdStatus(store, pos, flags);
        break;
      case "path":
        console.log(store.pathOf(needName(store, pos[0]), flag(flags, "ref")));
        break;
      case "versions":
        cmdVersions(store, pos);
        break;
      case "save": {
        const name = needName(store, pos[0]);
        const before = store.status(name);
        const b = flag(flags, "branch") ?? before.manifest.activeBranch;
        const wasDirty = before.dirty[b];
        const note = flag(flags, "message");
        const ver = store.save(name, { branch: flag(flags, "branch"), note });
        if (!wasDirty) console.log(`clean — already at ${ver.id}`);
        else console.log(`saved ${ver.id} on ${b}${note ? ` — ${note}` : ""}`);
        console.log(`pins unchanged`);
        break;
      }
      case "restore": {
        const name = needName(store, pos[0]);
        const vid = pos[1] || die("restore <name> <versionId>");
        store.restore(name, vid, { branch: flag(flags, "branch"), force: has(flags, "force") });
        console.log(`restored ${vid} (work + 存档点已对齐)`);
        console.log(`pins unchanged`);
        break;
      }
      case "discard": {
        const name = needName(store, pos[0]);
        store.discard(name, { branch: flag(flags, "branch") });
        console.log(`discarded unsaved edits on ${flag(flags, "branch") ?? store.status(name).manifest.activeBranch}`);
        break;
      }
      case "branch": {
        const sub = pos.shift() || die("branch list|new …");
        if (sub === "list") {
          const name = needName(store, pos[0]);
          const { manifest: m, dirty } = store.status(name);
          for (const [b, st] of Object.entries(m.branches)) {
            const mark = b === m.activeBranch ? "*" : " ";
            console.log(`${mark} ${b}\thead=${st.head}${dirty[b] ? "\tdirty" : ""}`);
          }
        } else if (sub === "new") {
          const name = needName(store, pos[0]);
          const bname = pos[1] || die("branch new <name> <branchName>");
          store.branchNew(name, bname, { from: flag(flags, "from") });
          console.log(`created branch ${bname} (from HEAD tree, not dirty work)`);
        } else {
          die(`unknown branch subcommand: ${sub}`);
        }
        break;
      }
      case "work-on": {
        const name = needName(store, pos[0]);
        const b = pos[1] || die("work-on <name> <branchName>");
        const m = store.workOn(name, b);
        console.log(`CLI 正在编辑 ${m.activeBranch}; 已有挂载不变:`);
        for (const l of m.links) console.log(`  ${l.mode} @${l.ref} -> ${l.to}`);
        if (!m.links.length) console.log("  (no links)");
        break;
      }
      case "link": {
        const name = needName(store, pos[0]);
        const to = flag(flags, "to") || die("link requires --to <leaf>");
        const rec = store.link(name, to, {
          ref: flag(flags, "ref"),
          pin: has(flags, "pin"),
          force: has(flags, "force"),
          repin: has(flags, "repin"),
        });
        console.log(`linked ${rec.mode.toUpperCase()} @${rec.ref} -> ${rec.to}`);
        console.log(printLiveWarning(rec.mode));
        break;
      }
      case "unlink": {
        const name = needName(store, pos[0]);
        const to = flag(flags, "to") || die("unlink requires --to <leaf>");
        store.unlink(name, to);
        console.log(`unlinked ${to}`);
        break;
      }
      case "diff":
        cmdDiff(store, pos, flags);
        break;
      case "check":
        cmdCheck(store, pos, flags);
        break;
      case "update":
        cmdUpdate(store, pos, flags);
        break;
      case "remove":
        store.remove(needName(store, pos[0]), { force: has(flags, "force") });
        console.log("removed");
        break;
      case "doctor":
        cmdDoctor(store);
        break;
      case "demo":
        cmdDemo(store);
        break;
      case "bundle":
        cmdBundle(store, pos, flags);
        break;
      case "pi":
        cmdPi(store, pos, flags, rest);
        break;
      case "ui": {
        const portRaw = flag(flags, "port");
        const port = portRaw ? Number(portRaw) : 7526;
        if (!Number.isInteger(port) || port < 1 || port > 65535) die("invalid --port");
        import("./ui/server.js")
          .then(({ startUi }) => {
            startUi({ port, open: has(flags, "open"), home: store.home });
          })
          .catch((e: unknown) => die(e instanceof Error ? e.message : String(e)));
        break;
      }
      default:
        die(`unknown command: ${cmd}`);
    }
  } catch (e) {
    die(e instanceof Error ? e.message : String(e));
  }
}

main();
