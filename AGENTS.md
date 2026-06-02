# pi-essentials

Personal pack of Pi coding-agent extensions, versioned and git-tag-pinned like sibling pi-* packages. Each extension is a standalone default-exported function listed in `package.json` `pi.extensions`. Currently ships `fetch` (context-safe URL retrieval).

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
package.json                              # pi.extensions = ["./fetch.ts"], @earendil-works peerDeps
.agents/skills/release/SKILL.md           # release flow (git-tag-pin model)
.agents/skills/release/scripts/release.sh # authoritative release script
prompts/release.md                        # /release prompt template
```

## Workflow

- **Adding an extension:** drop `<name>.ts` exporting `default function (pi: ExtensionAPI)`, add `"./<name>.ts"` to `pi.extensions`, document it in `README.md`, add a `CHANGELOG.md` entry.
- **Typecheck before committing.** No package script is wired; install deps transiently and run tsc:
  ```bash
  npm install --no-save @earendil-works/pi-coding-agent @earendil-works/pi-tui @sinclair/typebox @types/node
  bun x tsc --noEmit --target es2022 --module nodenext --moduleResolution nodenext --strict --skipLibCheck --esModuleInterop --resolveJsonModule --lib es2022 --types node fetch.ts
  ```
- **Releases use the `release` skill.** Consumed via git **tag** pins (`git:github.com/jjuraszek/pi-essentials@vX.Y.Z`); the script bumps the version, pushes the tag, then rewrites matching pins in `~/.pi/agent*/settings.json`. No npm publish. See `.agents/skills/release/SKILL.md` (`--dry-run` / `--no-update-pins` flags).
- **Smoke-test** with `pi -e ./fetch.ts -p "fetch https://example.com"`.
