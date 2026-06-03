# skill-updater

> Keep your AI agent skills fresh across Claude Code, Gemini CLI, Cursor, Codex, and more.

[![skills.sh](https://skills.sh/b/your-github-username/skill-updater)](https://skills.sh/your-github-username/skill-updater)

---

## What It Does

`skill-updater` is an agent skill that scans all your installed skills, checks their source repos for newer commits, shows you a status table, and lets you update **all at once** or **pick specific ones** by name.

Just type `/skills-update` in any supported agent.

```
┌─────────────────────┬────────────────────────────────┬─────────────────────────────────┐
│ Skill               │ Status                         │ Source                          │
├─────────────────────┼────────────────────────────────┼─────────────────────────────────┤
│ caveman             │ ✅ Up to date                  │ github.com/user/caveman-skill   │
│ extract-design      │ 🔄 Update available (3 behind) │ github.com/user/extract-design  │
│ frontend-design     │ ✅ Up to date                  │ github.com/vercel-labs/skills   │
│ my-custom-skill     │ ⚠️  Untracked                  │ (no source registered)          │
└─────────────────────┴────────────────────────────────┴─────────────────────────────────┘

Found 1 skill with updates. Update all, or name specific ones?
> all
```

---

## Install

```bash
# Install globally (available in all your projects)
npx skills add your-github-username/skill-updater -g

# Install for a specific agent
npx skills add your-github-username/skill-updater -g -a claude-code
npx skills add your-github-username/skill-updater -g -a gemini-cli
```

---

## Usage

Trigger in any supported agent:

| Phrase | Action |
|---|---|
| `/skills-update` | Check all skills and prompt to update |
| `update my skills` | Same as above |
| `check skill updates` | Show status table, no update |
| `are my skills outdated` | Show status table |
| `update skill caveman` | Update one specific skill |

### Interactive Flow

1. Agent scans your skills directory
2. Checks each skill's source repo for newer commits
3. Shows status table
4. Asks: **"Update all"** or **name specific skills** (e.g. `caveman extract-design`)
5. Pulls updates and reports results

---

## How Source Tracking Works

Each skill can declare its source repo in one of three ways (checked in order):

### 1. `.skill-source` file (recommended)
Place a `.skill-source` file inside the skill's folder:
```
https://github.com/owner/repo-name
# subdir=skills/my-skill   ← optional, for monorepos
# branch=main              ← optional, default is main
```

### 2. `skill_source:` frontmatter in `SKILL.md`
```yaml
---
name: my-skill
description: ...
skill_source: https://github.com/owner/repo
---
```

### 3. Auto-detect git remote
If the skill directory is itself a git repo, the `origin` remote is used automatically.

### Register a source manually
If a skill has no source, ask the agent to register one:
> "Register source for skill `my-skill`: https://github.com/owner/repo"

Or run directly:
```bash
node ~/.claude/skills/skill-updater/scripts/register-source.mjs \
  --skill my-skill \
  --repo https://github.com/owner/repo \
  --skills-dir ~/.claude/skills
```

---

## Supported Agents

Works with any agent that has bash + Node.js access:

| Agent | Status |
|---|---|
| Claude Code | ✅ |
| Gemini CLI | ✅ |
| Cursor | ✅ |
| Codex (OpenAI) | ✅ |
| OpenCode | ✅ |
| Windsurf | ✅ |
| Goose | ✅ |
| Any bash-capable agent | ✅ |

---

## Requirements

- Node.js ≥ 18
- `git` (for git-based skills)
- Internet access (for GitHub API checks)
- Optional: `GITHUB_TOKEN` env var for private repos or if you hit rate limits

```bash
export GITHUB_TOKEN=ghp_xxxxxxxxxxxx
```

---

## Scripts

| Script | Purpose |
|---|---|
| `scripts/detect-skills.mjs` | Find all installed skills and their dirs |
| `scripts/check-updates.mjs` | Check each skill for updates |
| `scripts/update-skills.mjs` | Pull / download updates |
| `scripts/register-source.mjs` | Write `.skill-source` for a skill |

All scripts output clean JSON to stdout.

---

## Manual One-Liner

For git-based skills only, no Node.js needed:
```bash
for d in ~/.claude/skills/*/; do
  [ -d "$d/.git" ] && echo "=== $(basename $d) ===" && git -C "$d" pull --ff-only
done
```

---

## Edge Cases

| Situation | Handling |
|---|---|
| Local edits in skill | Warns before overwriting; skips if uncommitted changes |
| Monorepo skill | Supports `subdir=` in `.skill-source` |
| Non-main branch | Supports `branch=` in `.skill-source` |
| Private repo | Needs `GITHUB_TOKEN`; warns clearly if missing |
| Rate limited | Warns and suggests setting `GITHUB_TOKEN` |
| No internet | Graceful "offline" status |

---

## Contributing

PRs welcome. If you add support for a new agent, update the `KNOWN_DIRS` list in `scripts/detect-skills.mjs` and `scripts/register-source.mjs`.

---

## License

MIT
