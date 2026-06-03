---
name: skill-updater
description: >
  Keep installed agent skills up to date. Scans all installed skills, checks their
  source repos for newer commits, shows a status table, then lets you pick "update all"
  or update specific skills by name. Works on Claude Code, Gemini CLI, Cursor, Codex,
  OpenCode, and any agent with bash access. Trigger phrases: /skills-update,
  "update my skills", "check skill updates", "are my skills outdated",
  "update skill NAME", "skill upgrade", "refresh skills".
---

# skill-updater

Keep every installed skill fresh. Checks source repos → shows status → lets you pick what to update.

## When to Use

Invoke when:
- User types `/skills-update`
- User says "update my skills", "check skill updates", "are my skills outdated"
- User says "update skill `<name>`" for a specific skill
- User wants to refresh or upgrade their skill set

---

## How Skills Are Located

Run the detection script to find all skill directories:

```bash
node scripts/detect-skills.mjs
```

This outputs JSON: `{ skillsDir: string, skills: [{ name, dir, source }] }`

Skills dirs checked (in order, first found wins):

| Agent | Global path | Project path |
|---|---|---|
| Claude Code | `~/.claude/skills/` | `.claude/skills/` |
| Gemini CLI | `~/.gemini/skills/` | `.agents/skills/` |
| Cursor | `~/.cursor/skills/` | `.agents/skills/` |
| Codex | `~/.codex/skills/` | `.agents/skills/` |
| OpenCode | `~/.config/opencode/skills/` | `.agents/skills/` |
| Windsurf | `~/.codeium/windsurf/skills/` | `.windsurf/skills/` |
| Goose | `~/.config/goose/skills/` | `.goose/skills/` |

---

## Step-by-Step Agent Instructions

### Step 1 — Detect & List Skills

```bash
node scripts/detect-skills.mjs
```

If detection returns no skills, ask the user: *"Where are your skills installed? (e.g. `~/.claude/skills`)"*

### Step 2 — Check for Updates

```bash
node scripts/check-updates.mjs --skills-dir <path>
```

Output: JSON array of `{ name, status, behind, source, detail }`

Status values:
- `up-to-date` — no updates
- `update-available` — commits exist on remote
- `untracked` — no source registered
- `error` — fetch failed
- `offline` — no network

### Step 3 — Display Status Table

Render a clear table to the user:

```
┌─────────────────────┬────────────────────────────────┬─────────────────────────────────┐
│ Skill               │ Status                         │ Source                          │
├─────────────────────┼────────────────────────────────┼─────────────────────────────────┤
│ caveman             │ ✅ Up to date                  │ github.com/user/caveman-skill   │
│ extract-design      │ 🔄 Update available (3 behind) │ github.com/user/extract-design  │
│ frontend-design     │ ✅ Up to date                  │ github.com/vercel-labs/skills   │
│ my-custom-skill     │ ⚠️  Untracked                  │ (no source registered)          │
└─────────────────────┴────────────────────────────────┴─────────────────────────────────┘
```

### Step 4 — Ask User What to Update

If updates are available, ask:
> "Found **N** skill(s) with updates. Update **all**, or name specific ones? (e.g. `all` / `caveman extract-design`)"

Wait for response, then run:

```bash
# Update all
node scripts/update-skills.mjs --skills-dir <path> --all

# Update specific
node scripts/update-skills.mjs --skills-dir <path> --skill caveman --skill extract-design
```

### Step 5 — Report Results

Show success/failure per skill. If any failed due to local changes, tell the user:
> "Skill `X` has local edits — stash or commit them first, then re-run `/skills-update`."

---

## Source Registration

Skills declare their source repo three ways (checked in order):

1. **`.skill-source` file** in the skill directory (recommended):
   ```
   https://github.com/owner/repo
   # subdir=skills/my-skill   (optional, for monorepos)
   # branch=main              (optional)
   ```

2. **`skill_source:` frontmatter** in `SKILL.md`:
   ```yaml
   skill_source: https://github.com/owner/repo
   ```

3. **Git remote** — auto-detected if skill folder is a git repo

If no source found → status is `untracked`. Offer to register:
> "Skill `X` has no source registered. Do you know its GitHub URL? I can track it for updates."

Then run:
```bash
node scripts/register-source.mjs --skill <name> --repo <url> --skills-dir <path>
```

---

## Scripts Reference

| Script | Purpose |
|---|---|
| `scripts/detect-skills.mjs` | Find all installed skills and their dirs |
| `scripts/check-updates.mjs` | Check each skill for updates via git/GitHub API |
| `scripts/update-skills.mjs` | Pull/download updates |
| `scripts/register-source.mjs` | Write `.skill-source` for a skill |

Read `references/github-api.md` for GitHub API patterns and rate limits.

---

## Manual One-Liner (git-based skills)

```bash
for d in ~/.claude/skills/*/; do
  [ -d "$d/.git" ] && echo "=== $(basename $d) ===" && git -C "$d" pull --ff-only
done
```
