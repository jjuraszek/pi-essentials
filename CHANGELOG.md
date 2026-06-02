# Changelog

Format follows sibling pi packages (e.g. [`pi-context-prune`](https://github.com/jjuraszek/pi-context-prune/blob/main/CHANGELOG.md)):
one entry per `vX.Y.Z` tag, newest first, terse bullets, dated.

This package is consumed via git tag pins (`git:github.com/jjuraszek/pi-essentials@vX.Y.Z`).
The release helper at `.agents/skills/release/scripts/release.sh` cuts the tag and
automatically rewrites every `~/.pi/agent*/settings.json` that pins this repo.

## v0.1.0 — 2026-06-02

- Initial release. Extracts the personal `fetch` extension out of the per-profile
  `~/.pi/agent*/extensions/` dirs into a versioned, tag-pinned package.
- **`fetch` context hygiene:** bodies over 50 KB or 2000 lines are written to
  `${TMPDIR}/pi-fetch/` and returned as a preview + file path instead of being
  inlined whole. Small bodies are returned inline unchanged. Download stays
  capped at 1 MB. Prevents a single fetch from flooding the context window.
