# pi-essentials

A small pack of [Pi coding-agent](https://github.com/badlogic/pi-mono) extensions I keep across every pi profile. First-party-quality tools, versioned and tag-pinned like sibling packages ([`pi-context-prune`](https://github.com/jjuraszek/pi-context-prune), [`pi-superpowers`](https://github.com/jjuraszek/pi-superpowers)).

## Extensions

| Extension | Tool | What it does |
|---|---|---|
| `fetch.ts` | `fetch` | Retrieve URLs over HTTP(S). HTML → Markdown (main-content extraction, stripped boilerplate). Binary content saved untouched to a temp file. **Context-safe:** output over 32 KB or 1000 lines is written to a temp file with a preview + file path. Prevents a single fetch from flooding the context window. |
| `doc_to_md.ts` | `doc_to_md` | Convert a local PDF/DOCX/PPTX to Markdown. High-fidelity via `pymupdf4llm` (run through `uv`, fetched on first use); degraded pure-JS fallback (`unpdf`) when `uv`/Python is unavailable or conversion times out. DOCX/PPTX convert via LibreOffice (`soffice`) to PDF first. Same 32 KB / 1000-line size gate as `fetch`. |

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

### doc_to_md — local document → Markdown

`doc_to_md` takes a **local file path** (`.pdf`, `.docx`, `.pptx`) and returns Markdown. For remote documents, `fetch` the URL first (it saves binaries to a temp path), then pass that path here.

**Two engines, auto-selected:**

- **Primary — `pymupdf4llm`** (high fidelity: headings, tables, reading order). Runs as an arms-length subprocess via `uv run --with pymupdf4llm==<pin> --python 3.14`. `uv` fetches the wheel into its own cache on first use (one-time download); Python 3.14 is fixed. Warmed once per process: the first call probes/installs (generous budget), later calls reuse the warm cache with a shorter per-document budget.
- **Fallback — `unpdf`** (pure JS, bundled PDF.js). Used when `uv` is not on `PATH`, the warm probe fails, or a conversion times out. Output is plain text with page breaks — **no faithful tables/headings**. Degraded results are marked in the output (`[Note: degraded extraction via unpdf ...]`) and carry a `Fallback-Reason:` line.

**Office documents (`.docx`, `.pptx`):** converted to PDF by headless LibreOffice (`soffice`, isolated per-call profile), then fed through the same PDF pipeline. `soffice` must be on `PATH` for office inputs — otherwise the tool errors (there is no JS fallback for office→PDF). Spreadsheets and other formats are out of scope (spreadsheets paginate badly via PDF).

**Size gate:** identical to `fetch` — Markdown ≤ 32 KB and ≤ 1000 lines is inlined; larger output spills to `${TMPDIR}/pi-doc-to-md/<stamp>-<basename>-<hash>.md` with a 60-line preview + a grep/read-slice hint.

**Configuration (environment variables):**

| Variable | Default | Meaning |
|---|---|---|
| `PI_DOC_TO_MD_PYMUPDF_VERSION` | `1.27.2.3` | `pymupdf4llm` version pin passed to `uv --with` (digits/dots only) |
| `PI_DOC_TO_MD_WARM_TIMEOUT_MS` | `120000` | Warm/install call budget — covers the cold wheel (+ managed Python) download |
| `PI_DOC_TO_MD_CONVERT_TIMEOUT_MS` | `60000` | Per-document conversion budget (also bounds the `unpdf` fallback) |
| `PI_DOC_TO_MD_SOFFICE_TIMEOUT_MS` | `120000` | LibreOffice `.docx`/`.pptx` → PDF budget |

Python is pinned to **3.14** and is not configurable.

**Runtime dependencies:** `unpdf` (npm, installed automatically via the git tag pin). `uv` and LibreOffice (`soffice`) are optional system binaries detected at runtime: without `uv`, PDFs still convert via the `unpdf` fallback; without `soffice`, office inputs error while PDFs are unaffected.

**Licensing note:** `pymupdf4llm`/PyMuPDF are **AGPL-3.0**. This package ships none of their code — `uv` downloads the wheel from PyPI onto your machine at runtime, and it runs as a **separate subprocess** (never imported or linked into this TypeScript). The arms-length process boundary keeps pi-essentials' MIT license intact; the AGPL governs PyMuPDF itself, whose source is public. This holds only while the boundary stays subprocess-only (no vendoring/importing the wheel).

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
