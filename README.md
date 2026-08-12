# skillcoffer

Local manager for [Agent Skills](https://agentskills.io): install from disk or **public GitHub**, version/branch, group into **bundles**, launch **pi** with session-scoped `--skill` (no global symlink required).

Default store: `~/.skillcoffer` (override with `SKILLCOFFER_HOME`).

## Install

```bash
# from clone
git clone https://github.com/Howryann/skillcoffer.git
cd skillcoffer
npm install          # runs prepare → tsc → dist/
npm install -g .     # or: npm link

skillcoffer --help
skco --help          # same binary
```

Private GitHub install (with `gh` auth / token):

```bash
npm install -g git+https://github.com/Howryann/skillcoffer.git
```

Dev without install:

```bash
npm run skco -- --help
```

## Quick start

```bash
# local sample
skillcoffer add ./examples/demo-skill   # from repo; or any path with SKILL.md
skillcoffer status demo-skill -v
skillcoffer path demo-skill             # edit ONLY this work tree

# public GitHub (needs git)
skillcoffer add anthropics/skills/skills/pdf --ref main
skillcoffer check pdf
skillcoffer diff pdf --upstream
skillcoffer update pdf --apply

# multi-skill for one pi session
skillcoffer bundle create coding
skillcoffer bundle add coding pdf
skillcoffer bundle add coding demo-skill
skillcoffer pi coding --print           # show: pi --skill <bundle>
skillcoffer pi coding                   # exec pi
skillcoffer pi pdf demo-skill --pin     # pin HEAD trees
```

## Mental model

| Word | Meaning |
|------|---------|
| work | editable tree for a branch (default `main`) |
| version | immutable snapshot after `save` / install / update |
| bundle | named group of skills → one directory for `pi --skill` |
| `pi` subcommand | expands skill/bundle names → `pi --skill …` (this process only) |

Do **not** edit `examples/` after install; use `skillcoffer path <name>`.

## Commands (summary)

```
skillcoffer add|list|status|path|versions|save|restore|discard
skillcoffer branch|work-on|link|unlink|diff|check|update|remove|doctor|demo
skillcoffer bundle create|add|path|list
skillcoffer pi <skill|bundle>... [--pin] [--print] [-- <pi args>]
```

## Layout

```
$SKILLCOFFER_HOME/
  skills/<id>/manifest.json
  skills/<id>/versions/<ver>/{version.json,tree/}
  skills/<id>/branches/<branch>/work/
  bundles/<name>/<skill> -> ...
```

## Not yet

Collection install, private GitHub as first-class, publish/Hub, shell completion.
