# pi-essentials

A small pack of [Pi coding-agent](https://github.com/badlogic/pi-mono) extensions I keep across every pi profile. First-party-quality tools, versioned and tag-pinned like sibling packages ([`pi-context-prune`](https://github.com/jjuraszek/pi-context-prune), [`pi-superpowers`](https://github.com/jjuraszek/pi-superpowers)).

## Extensions

| Extension | Tool | What it does |
|---|---|---|
| `fetch.ts` | `fetch` | Retrieve URLs over HTTP(S). HTML → Markdown (main-content extraction, stripped boilerplate). Binary content saved untouched to a temp file. **Context-safe:** output over 32 KB or 1000 lines is written to a temp file with a preview + file path. Prevents a single fetch from flooding the context window. |

### fetch — content routing & context hygiene

`fetch` is the main way an agent pulls external bytes into context. This extension routes responses by type to keep context tight:

**HTML → Markdown:**
- Mozilla Readability extracts main content, strips navigation/chrome/boilerplate
- Turndown converts to Markdown with GFM support (pipe tables, fenced code blocks, ATX headings)
- Page title becomes a top-level `#` heading
- Download cap: **1 MB**

**Binary (images, PDFs, archives, fonts, audio/video) → temp file:**
- Streamed untouched to `${TMPDIR}/pi-fetch/<stamp>-<host>-<hash>.<ext>` without decoding
- Detection: content-type check + NUL-byte sniff in first ≤64 KB (catches mislabeled payloads)
- Returns: status, content-type, size, file path — **no preview**
- Download cap: **50 MB**

**Text / Markdown / JSON size gate:**
- Inline when **≤ 32 KB AND ≤ 1000 lines** (converted output size)
- Otherwise **spills to file** with:
  - HTTP status, content-type, charset, byte/line counts
  - File path (`Saved-To:`)
  - 60-line preview
  - Instruction to `grep` (Markdown is grep-able by heading: `^#`) or `read` slices

**JSON:** Pretty-printed with 2-space indent before the gate.

**Parameters:**
- `raw=true`: Skip HTML→Markdown and JSON pretty-printing; return decoded body as-is (still subject to the size gate).

**Truncation:** Parsable content over 1 MB is truncated with a `(truncated to 1MB)` note; binary over 50 MB notes `(truncated to 50MB)`.

**Runtime dependencies:** `jsdom`, `@mozilla/readability`, `turndown`, `turndown-plugin-gfm`. When consumed via a git tag pin, pi installs these automatically — no manual setup needed.

## Install

Consumed as a pi package via a **git tag pin** — same scheme as sibling [`pi-context-prune`](https://github.com/jjuraszek/pi-context-prune).

**User scope** (all repos under your pi profile):

```bash
pi install git:github.com/jjuraszek/pi-essentials@v0.2.0
```

**Project scope** (current repo only, committable via `.pi/settings.json`):

```bash
pi install -l git:github.com/jjuraszek/pi-essentials@v0.2.0
```

**Try without installing**:

```bash
pi -e git:github.com/jjuraszek/pi-essentials@v0.2.0
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
