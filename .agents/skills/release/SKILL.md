---
name: release
description: Creates a repository release for the pi-essentials Pi package. Use when the user asks to do a major, minor, or patch release, bump the package version, and create and push a git tag. This package is consumed via git tag pins (`git:github.com/jjuraszek/pi-essentials@vX.Y.Z`); no npm publish step is involved.
---

# Release

Use this skill when asked to release this package, especially through `/release major`, `/release minor`, or `/release patch`.

## Repository-specific release model

This package is consumed via **git tag pins** in pi `settings.json` (e.g.
`"git:github.com/jjuraszek/pi-essentials@v0.1.0"`), not via npm. A release
here means:

1. bump the version in `package.json`
2. create the release commit and the matching `vX.Y.Z` git tag
3. push `main` and the tag to `origin`
4. rewrite every `~/.pi/agent*/settings.json` that pins this repo so its
   `@<old-ref>` becomes `@vX.Y.Z` (done by the helper script — no manual
   bump anymore)

There is no CI publish workflow. **Do not run `npm publish`** — nothing
consumes the npm package.

The tag scheme (`v` prefix, semver) matches sibling pi packages, e.g.
[`pi-context-prune`](https://github.com/jjuraszek/pi-context-prune/tags) and
[`pi-superpowers`](https://github.com/jjuraszek/pi-superpowers/tags).

## Inputs

Accepted release types: `major`, `minor`, `patch`. If the user does not specify
one of those three values, ask for clarification.

## Safety checks before releasing

- the repo working tree is clean
- the release should go from `main`
- the local checkout can fast-forward cleanly from `origin/main`
- the current package version comes from `package.json`

If any check fails, stop and explain why.

## Preferred execution path

```bash
bash .agents/skills/release/scripts/release.sh <major|minor|patch>
```

For a no-side-effects validation run:

```bash
bash .agents/skills/release/scripts/release.sh --dry-run patch
```

To release without touching the user's settings.json pins:

```bash
bash .agents/skills/release/scripts/release.sh --no-update-pins patch
```

## What the helper script does

1. validates the requested bump type
2. ensures the working tree is clean
3. fetches from `origin`
4. switches to `main` if needed
5. fast-forwards `main` from `origin/main`
6. runs `npm run build --if-present`
7. runs `npm run check --if-present`
8. runs `npm version <type> -m "Release %s"` (creates commit + `vX.Y.Z` tag)
9. pushes `main` and the new tag
10. rewrites every `~/.pi/agent*/settings.json` that pins
    `git:github.com/jjuraszek/pi-essentials@<ref>` so `<ref>` becomes the
    new tag. Anything not matching that exact prefix is left alone.

## After the script succeeds

Report back with: the old version, the new version, the created tag (sha +
name), confirmation that `main` and the tag were pushed, and which
`~/.pi/agent*/settings.json` files got their pin bumped (one line per file in
the script's stdout).

If `--no-update-pins` was used, remind the user to bump pins manually:

```bash
grep -nrH 'git:github.com/jjuraszek/pi-essentials@' $HOME/.pi/agent*/settings.json
```

## Failure handling

- do not guess; quote the failing command or stderr
- explain whether the release partially completed
- if `npm version` created a commit/tag but push failed, say exactly what
  happened before any cleanup
- if the tag pushed but the pin rewrite failed, the release is still valid —
  re-running the pin step is safe (pins already on `vX.Y.Z` are skipped)

## Notes

- Paired with the prompt template at `prompts/release.md` so the user can
  invoke it with `/release <major|minor|patch>`.
- Keep release responses concise and operational.
