---
name: release
description: Cut a pi-essentials release (major/minor/patch) — bump version, tag, push, rewrite settings.json pins.
---

Run a release of this package using the `release` skill at
`.agents/skills/release/SKILL.md`.

Requested bump type: {{args}}

If no bump type (`major`, `minor`, or `patch`) was given, ask for it before
doing anything. Then follow the skill: run the helper script, and report the
old version, new version, created tag, push confirmation, and which
`~/.pi/agent*/settings.json` pins were bumped.
