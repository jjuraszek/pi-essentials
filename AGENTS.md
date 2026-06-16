# pi-essentials

Personal pack of Pi coding-agent extensions, versioned and git-tag-pinned like sibling pi-* packages. Each extension is a standalone default-exported function listed in `package.json` `pi.extensions`. Ships `fetch` (context-safe URL retrieval), `doc_to_md` (local PDF/DOCX/PPTX -> Markdown via pymupdf4llm with a pure-JS unpdf fallback), `session-name` (manual + opt-in automatic session naming with Ghostty tab rename, OFF by default), and `sword-header` (themed ASCII startup header, OFF by default). Opt-in extensions resolve their `settings.json` config via the shared `extension-config.ts` (`getAgentDir()`-based global + project layering).

## Communication Style

Same rules as the parent `~/.pi/agent.anthropic/AGENTS.md`. Applied to chat, commit messages, PR descriptions, code review, and any artifact authored here.

- **Suppress process narration.** No intent classification, phase announcements, tool/subagent preamble, status updates, pleasantries. Start with substance.
- **Output instead:** outcomes, decisions needing input, verification results, blockers.
- **Bullets over prose. Short paragraphs.** No wall-of-text, no tutorial tone unless asked.
- **End on the ask, not a summary.**

LLM-readable artifacts (`AGENTS.md`, `README.md`, `CHANGELOG.md`, skill files, code comments where *why* is non-obvious) stay structured. Optimize for retrieval over readability.

## Code & Documentation Discipline

- **Code is a liability.** Add only what the task requires. No premature abstractions, no helpers for hypothetical reuse, no fallbacks for branches that can't happen.
- **No belt-and-suspenders.** Validate at the boundary once.
- **Delete dead code, don't comment it out.**
- **Comments only when the *why* is non-obvious.** Don't restate the next line. No banner comments.

## Ground Truth Before Reasoning

Never guess Pi's API. Read the source. The pi runtime this package targets is
the **`@earendil-works`** namespace (matches the host pi install), not
`@mariozechner`.

- **Extension API:** `node_modules/@earendil-works/pi-coding-agent/dist/**/*.d.ts` — `ExtensionAPI`, `registerTool`, tool result/`details` shapes, exported helpers like `formatSize`, `keyHint`.
- **TUI:** `node_modules/@earendil-works/pi-tui` — `Text` and theme helpers used in `renderCall` / `renderResult`.

If the source contradicts an assumption, the source wins.

## Layout

```
fetch.ts                                  # fetch extension (entry in pi.extensions)
doc_to_md.ts                              # doc_to_md extension (entry in pi.extensions)
session-name.ts                           # session-name extension (entry in pi.extensions; OFF by default)
sword-header.ts                           # sword-header extension (entry in pi.extensions; OFF by default)
extension-config.ts                       # shared getAgentDir()-based settings.json resolution (resolveConfig)
scripts/pdf_to_md.py                      # doc_to_md Python conversion entry point
package.json                              # pi.extensions = ["./fetch.ts", "./doc_to_md.ts", "./session-name.ts", "./sword-header.ts"], @earendil-works peerDeps
.agents/skills/release/SKILL.md           # release flow (git-tag-pin model)
.agents/skills/release/scripts/release.sh # authoritative release script
prompts/release.md                        # /release prompt template
```

## Workflow

- **Adding an extension:** drop `<name>.ts` exporting `default function (pi: ExtensionAPI)`, add `"./<name>.ts"` to `pi.extensions`, document it in `README.md`, add a `CHANGELOG.md` entry.
- **Typecheck before committing.** The `test` (`node --test`) and `typecheck` (`bun x tsc`) scripts are wired; both require deps installed transiently first (see the install line below):
  ```bash
  npm install --no-save @earendil-works/pi-ai @earendil-works/pi-coding-agent @earendil-works/pi-tui @sinclair/typebox @types/node jsdom @mozilla/readability turndown turndown-plugin-gfm @types/jsdom @types/turndown unpdf
  bun x tsc --noEmit --allowImportingTsExtensions --target es2022 --module nodenext --moduleResolution nodenext --strict --skipLibCheck --esModuleInterop --resolveJsonModule --lib es2022 --types node fetch.ts fetch.test.ts doc_to_md.ts doc_to_md.test.ts session-name.ts session-name.test.ts types/turndown-plugin-gfm.d.ts
  ```
- **`doc_to_md` engines.** `scripts/pdf_to_md.py` is the Python conversion entry point, invoked via `uv run --with pymupdf4llm==<pin> --python 3.14` (not under `tsc`/`node --test`; verify by direct uv invocation). DOCX/PPTX route through `soffice` to PDF first. `uv` and `soffice` are optional runtime system binaries; absence degrades to the `unpdf` fallback (PDF) or hard-errors (office).
- **Releases use the `release` skill.** Consumed via git **tag** pins (`git:github.com/jjuraszek/pi-essentials@vX.Y.Z`); the script bumps the version, pushes the tag, then rewrites matching pins in `~/.pi/agent*/settings.json`. No npm publish. See `.agents/skills/release/SKILL.md` (`--dry-run` / `--no-update-pins` flags).
- **Smoke-test** with `pi -e ./fetch.ts -p "fetch https://example.com"`.
