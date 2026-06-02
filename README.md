# pi-essentials

A small pack of [Pi coding-agent](https://github.com/badlogic/pi-mono) extensions I keep across every pi profile. First-party-quality tools, versioned and tag-pinned like sibling packages ([`pi-context-prune`](https://github.com/jjuraszek/pi-context-prune), [`pi-superpowers`](https://github.com/jjuraszek/pi-superpowers)).

## Extensions

| Extension | Tool | What it does |
|---|---|---|
| `fetch.ts` | `fetch` | Retrieve URLs over HTTP(S). HTML → text with links inlined as `text (url)`. **Context-safe:** large bodies are written to a temp file and only a preview + file path are returned, so a single fetch can't flood the context window. |

### fetch — context hygiene

`fetch` is the main way an agent pulls external bytes into context, so an unbounded inline return is the biggest single-shot context polluter. This build:

- Downloads up to **1 MB** (hard cap, as before).
- Returns the body **inline** when it is small (≤ 50 KB and ≤ 2000 lines — the same limits the `read` tool truncates at).
- Otherwise **spills the full body to `${TMPDIR}/pi-fetch/<stamp>-<host>-<hash>.<ext>`** and returns:
  - HTTP status, content-type, charset, byte/line counts
  - the file path (`Saved-To:`)
  - a 60-line preview
  - an instruction to `read` slices (offset/limit) or `grep` the file rather than read it whole

The agent then pulls only the parts it needs, addressable on demand, instead of all-or-nothing.

## Install

Consumed as a pi package via a **git tag pin** — same scheme as sibling [`pi-context-prune`](https://github.com/jjuraszek/pi-context-prune).

**User scope** (all repos under your pi profile):

```bash
pi install git:github.com/jjuraszek/pi-essentials@v0.1.0
```

**Project scope** (current repo only, committable via `.pi/settings.json`):

```bash
pi install -l git:github.com/jjuraszek/pi-essentials@v0.1.0
```

**Try without installing**:

```bash
pi -e git:github.com/jjuraszek/pi-essentials@v0.1.0
```

**From a local checkout** (for hacking on the extensions):

```bash
git clone git@github.com:jjuraszek/pi-essentials.git ~/repos/pi-essentials
pi -e ~/repos/pi-essentials/fetch.ts
```

## Release

This package is consumed via git tag pins; there is no npm publish step. Cut a
release with the helper script (also exposed as the `/release` prompt + the
`release` skill at `.agents/skills/release/`):

```bash
bash .agents/skills/release/scripts/release.sh patch    # or minor / major
bash .agents/skills/release/scripts/release.sh --dry-run patch
```

It bumps `package.json`, creates and pushes the `vX.Y.Z` tag, then rewrites
every `~/.pi/agent*/settings.json` that pins this repo to the new tag.
