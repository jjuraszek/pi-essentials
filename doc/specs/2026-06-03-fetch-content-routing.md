# Spec: fetch content routing — readability Markdown, binary-to-file, tightened gates

- **Date:** 2026-06-03
- **Package:** pi-essentials (`fetch.ts`, sole extension)
- **Branch / worktree:** `fetch-content-routing` @ `.worktrees/fetch-content-routing`
- **Status:** awaiting user review

## 1. Problem

`fetch` is the agent's primary path for pulling external bytes into context, so its output quality and size discipline dominate context health. The current build has four concrete failures:

1. **Weak conversion.** HTML→text is regex-based: it strips tags, inlines links as `text (url)`, decodes a tiny entity table, and collapses block elements to newlines. All document structure (headings, lists, tables, code) is flattened. Nav/footer/sidebar/cookie boilerplate is converted verbatim and counts toward the size gate.
2. **No targeting.** Flattened text has no stable structure, so the only targeting mechanism is the spill-to-file + `grep`/`read`-slice dance on shapeless text.
3. **No binary handling.** Every response is UTF-8 decoded. Binary payloads (images, PDFs, archives) get mangled into garbage text and can flood context.
4. **Coarse size discipline.** A 1 MB body that decodes to ~12–15K tokens can still land inline (50 KB gate), a meaningful single-call context hit.

## 2. Goals / Non-Goals

### Goals

- Convert HTML to **structured Markdown** via a proven, community-standard pipeline (headings, lists, tables, code fences, blockquotes preserved; main content extracted, boilerplate stripped).
- Route **binary** content straight to a temp file untouched — never decode, never preview, never inline.
- Treat large parsable output as a **file handle + metadata + head preview**, with the structured Markdown making the spilled file grep-able by heading.
- Tighten the inline gate so only genuinely small results reach context.
- Keep distinct, well-defined **download caps**: parsable content vs. file-destined content.

### Non-Goals (explicit)

- **No caching.** Every call is a fresh fetch.
- **No retries.** A failed request fails.
- **No robots.txt** parsing or politeness policy.
- **No redirect policy change.** Keep native `fetch` default (`redirect: "follow"`).
- **No hybrid/regex fallback** for HTML. When the parser can't produce usable content, fall back to a raw-body **file write**, not a second-rate converter.
- No new selector/section-extraction parameter. Structured Markdown + `grep`/`read`-slice is the targeting mechanism; `raw=true` is the escape hatch for over-stripped pages.

## 3. Dependencies

Added to `package.json` `dependencies` (pi runs `npm install` on git-tag-pinned packages, so runtime deps resolve on the consumer side):

| Dependency | Role | Why this one |
|---|---|---|
| `jsdom` | DOM document for readability | The DOM backend Mozilla **officially documents and tests** readability against — lowest "might break" risk. Its only real downside (perf/OOM on multi-MB docs) is neutralized by the 1 MB parsable cap; parse time on ≤1 MB is tens of ms against a network round-trip that dominates. |
| `@mozilla/readability` | Main-content extraction | The standard extractor (Firefox Reader View). Strips nav/chrome/boilerplate. 2.4M weekly downloads. |
| `turndown` | HTML→Markdown | De facto standard (4.9M weekly downloads). Brings its own Node DOM (`@mixmark-io/domino`) internally; takes an HTML string. |
| `turndown-plugin-gfm` | GFM tables / strikethrough / task lists | Official turndown companion. Turndown alone passes tables through as raw HTML; the GFM plugin emits pipe tables — a real structure-preservation win for the targeting goal. |

Type packages (`@types/jsdom`, `@types/turndown`) are added to the transient typecheck install command in AGENTS.md, not to runtime deps.

**Liability note:** jsdom is a heavy install. Accepted deliberately — quality and "won't break" were the stated priorities, and the install happens once per tag pin.

## 4. Architecture

Single tool, single `execute`. The body is streamed and classified **before** committing to a cap, then routed through one of three terminal paths. Pure, network-free helpers do the classification and transformation so they are unit-testable.

### 4.1 Content categories

```
category = binary | markdown | text | json
```

- **binary** → save raw bytes to file (50 MB cap), metadata only, no preview, no decode.
- **markdown** → HTML run through readability + turndown; gated.
- **json** → pretty-printed (2-space); gated.
- **text** → decoded as-is; gated. (also the `raw=true` path for HTML, and the fallback path when readability yields nothing.)

### 4.2 Classification (pure: `categorize(contentType, sniffBytes, raw)`)

Precedence:

1. `image/*` content-type → **binary** (includes `image/svg+xml`: technically XML, but useless as inline text and conceptually an image; predictable rule wins).
2. Content-type in the **text allowlist** → text-candidate, subject to NUL downgrade (step 5):
   - `text/*`
   - `application/json`, `*+json`
   - `application/xml`, `application/xhtml+xml`, `*+xml`
   - `application/javascript`
3. Content-type is `application/octet-stream`, empty, or **otherwise unknown** (any content-type matched by neither step 2's allowlist nor step 4's known-binary list; `*+json`/`*+xml` in step 2 cover vendor subtypes) → **NUL sniff decides** (NUL byte present → binary; clean → text-candidate).
4. Any other known non-text type (`application/pdf`, `application/zip`, `font/*`, `audio/*`, `video/*`, …) → **binary**.
5. **NUL-byte downgrade:** for any text-candidate from steps 2–3, if a `0x00` byte appears in the **sniff window** (the first streamed chunk, ≤ 64 KB — see §5 step 4a), downgrade to **binary** (catches mislabeled payloads). A NUL byte beyond the sniff window intentionally does not downgrade; the window is a fixed-cost heuristic, not a full scan.

A text-candidate is then refined: HTML content-type (`text/html`, `application/xhtml+xml`) → **markdown** (unless `raw=true` → **text**); JSON content-type → **json**; everything else text-candidate → **text**.

### 4.3 HTML→Markdown (pure: `htmlToMarkdown(html, url)`)

```
const dom = new JSDOM(html, { url });                 // url = res.url (final URL after redirects), resolves relative links
const article = new Readability(dom.window.document).parse();
if (!article || !article.content) return null;        // → caller falls back to raw text file
let md = turndown(article.content);                   // turndown + gfm plugin
if (article.title) md = `# ${article.title}\n\n${md}`; // stable top-level heading
return md.trim();
```

Turndown config: ATX headings (`#`), fenced code blocks, `-` bullets, GFM plugin enabled. Code-fence language labels are **passthrough** from the source `<code class="language-…">`; no active language detection. `null` return is the **fallback trigger** — caller writes the raw HTML body to a file (text path) so nothing is silently lost.

### 4.4 JSON (pure: `prettyJson(text)`)

`JSON.parse` → `JSON.stringify(value, null, 2)`. On parse failure, return the original text unchanged (treat as plain text). Result is gated like any text.

### 4.5 Size gate (pure: `applyGate(body)`)

```
INLINE_MAX_BYTES = 32_000      // was 50_000
INLINE_MAX_LINES = 1_000       // was 2_000
```

Applied to the **converted output** (Markdown / pretty JSON / text), not the raw download. Boilerplate-stripped Markdown is typically far smaller than its source HTML, so a 1 MB page that converts small still inlines; one that converts large spills. `> 32 KB` **or** `> 1000 lines` → spill to file.

**Truncation does not override the gate.** A source truncated at the 1 MB parsable cap may still convert to output under 32 KB / 1000 lines and inline. When it does, the inline body is prepended with `[Note: source truncated at 1 MB — content may be partial]` and `truncated: true` is set in `details`. The gate decision is made on converted-output size alone; the truncation flag is informational, not a forced spill.

## 5. Data / request flow

```
1. Validate URL (http/https only). Build headers (UA, Accept, Accept-Language) unless overridden.
2. fetch(url, { method, headers, body, redirect: "follow", signal }) with timeout + abort wiring.
3. HEAD or empty body → return headers only, inline. (no category processing)
4. Read `res.body` via `getReader()` in chunks (no `arrayBuffer()` — classify before committing to a cap):
   a. Accumulate the first chunk(s) up to a ≤ 64 KB sniff window → NUL sniff + content-type → categorize().
   b. binary  → open `fs.createWriteStream(tmpPath)` immediately, write the buffered prefix, then pipe remaining
               chunks; cap 50 MB, then stop + flag truncated. Propagate stream write errors as a tool error
               (and clean up the partial file).
      text/*  → concatenate chunks into an in-memory Buffer, cap 1 MB; stop + flag truncated past cap.
5. Terminal path:
   - binary:  write bytes to ${TMPDIR}/pi-fetch/<stamp>-<host>-<hash>.<ext>; return
              { status, content-type, size, Saved-To } + "binary — saved for processing".
              No preview.
   - markdown: decode (charset from Content-Type header, UTF-8 fallback) → htmlToMarkdown(); null → text fallback on raw HTML.
   - json:     decode (charset → UTF-8 fallback) → prettyJson().
   - text:     decode (charset → UTF-8 fallback) as-is.
   - markdown/json/text → applyGate():
       ≤ gate → inline (headers + body)
       > gate → spill to file (.md/.json/.txt) + metadata + 60-line / 4 KB head preview
                + instruction to grep / read-slice.
```

Streaming-with-early-sniff (step 4a) is what lets a binary mislabeled as text avoid the 1 MB truncation: the category is final before any cap binds.

Cap constants:

```
PARSABLE_MAX_BYTES = 1_000_000    // text/markdown/json download ceiling (unchanged)
BINARY_MAX_BYTES   = 50_000_000   // file-destined download ceiling (new)
```

## 6. Output shape

`details` (drives `renderResult`):

```ts
interface FetchToolDetails {
  url?: string;
  status?: number;
  contentType?: string;
  charset?: string;
  bytes?: number;          // bytes downloaded
  truncated?: boolean;     // hit the applicable cap
  category?: "binary" | "markdown" | "text" | "json";
  spilled?: boolean;       // text path written to file
  file?: string;           // path for binary or spilled text
  lines?: number;          // converted-output line count (text paths only)
}
```

- **Inline (text paths):** headers + converted body, as today.
- **Spilled (text paths):** headers + `Body: <size> across <n> lines — written to file` + `Saved-To:` + grep/read-slice instruction + 60-line/4 KB preview.
- **Binary:** headers + `Body: <size> binary (<content-type>) — saved for processing` + `Saved-To:`. No preview, no read-slice instruction (bytes aren't line-addressable).

`renderResult` gains a category chip (e.g. `→ file` for spills, `binary → file` for binary) alongside the existing status/type/size summary.

## 7. Tool surface changes

- **`description`** rewritten: "HTML → Markdown (readability + turndown). Binary saved to a temp file untouched. Text/JSON over 32 KB or 1000 lines spilled to a file with a preview."
- **`promptGuidelines`** updated: binary returns a file path for downstream processing; spilled Markdown is grep-able by heading (`^#`); `raw=true` returns unconverted HTML (still gated) as the escape hatch when readability over-strips.
- **Parameters unchanged.** `raw=true` now means "skip readability/turndown and JSON pretty-print; return decoded body as-is" (still subject to the gate). No new parameters.

## 8. Error handling & edge cases

| Case | Behavior |
|---|---|
| Non-http(s) protocol | Throw (as today). |
| Timeout / abort | Existing abort + timeout wiring preserved. |
| readability returns `null`/empty | Fall back to raw-HTML **text file** (gated). No regex converter. |
| Malformed JSON on json path | Return original text unchanged (plain text), gated. |
| Binary > 50 MB | Save first 50 MB, flag `truncated: true`, note partial in output. |
| Text/markdown source > 1 MB | Read first 1 MB, flag `truncated`, convert what we have. If converted output is under the gate it still inlines, with a `[Note: source truncated at 1 MB …]` prefix (see §4.5). |
| Binary stream write error | Propagate as tool error; remove the partial temp file. |
| Mislabeled binary served as `text/*` | NUL sniff on first chunk downgrades to binary before the 1 MB cap binds. |
| `image/svg+xml` | Binary → file (no inline SVG markup). |
| HEAD / empty body | Headers only, inline. |
| Charset decode failure | Fall back to UTF-8 (as today). |
| jsdom throws on pathological HTML | Caught; treated as readability-null → raw-HTML text-file fallback. |

## 9. Testing approach

- **Unit tests (no network, no new deps):** `node --test` over the pure helpers — `categorize()` (allowlist, NUL downgrade, octet-stream, image, svg), `htmlToMarkdown()` (heading/list/table/code fixtures + null-on-garbage), `prettyJson()` (valid + malformed), `applyGate()` (boundary at 32 KB / 1000 lines). Refactor `execute` to delegate to these helpers so they're importable. Wire `npm test` / `npm run check`.
- **Smoke tests (manual, network):**
  - `pi -e ./fetch.ts -p "fetch https://example.com"` — small HTML → inline Markdown.
  - A long article URL → spilled `.md`, grep-able headings.
  - A `.pdf` / `.png` URL → binary file path, no preview.
  - A JSON API URL → pretty-printed (inline or spilled by size).
- **Typecheck:** the AGENTS.md transient-install + `tsc --noEmit` command, extended with `@types/jsdom @types/turndown`.

## 10. Docs to update (same worktree commit)

- `README.md` — fetch section: Markdown pipeline, binary-to-file, 32 KB/1000-line gate, 50 MB binary cap, dependency note.
- `CHANGELOG.md` — new `vX.Y.Z` entry (minor: behavior change + new deps).
- `AGENTS.md` — extend the typecheck install line with `@types/jsdom @types/turndown`.

## 11. Open questions

None. All routing, caps, gate values, library choices, and binary rules are decided above.
```
