# skill-updater

> Keep your AI agent skills fresh. Token-efficient — one API call per skill to detect updates, zero file downloads until you approve.

[![skills.sh](https://skills.sh/b/PhantomCodeGhost/skill-updater)](https://skills.sh/PhantomCodeGhost/skill-updater)[![skills.sh](https://skills.sh/b/PhantomCodeGhost/skill-updater)](https://skills.sh/PhantomCodeGhost/skill-updater)
---

## The Problem with Naive Skill Updaters

Most skill updaters either:
- **Clone the entire repo** to check for updates (slow, wasteful)
- **Download all files** before asking if you want them (bad)
- **Forget source URLs** between sessions (unreliable)
- **Consume hundreds of tokens** scanning files (expensive)

## How This One Works

```
1. Read local SHA from .skill-source (zero network)
2. GET /repos/{owner}/{repo}/commits?per_page=1  ← ~1KB, one call
3. Compare SHA → OUTDATED or UP_TO_DATE
4. Show table. Ask user.
5. ONLY THEN download files.
```

**10 skills = 10 tiny API calls (~10KB total). No cloning. No wasted bandwidth.**

---

## Install

```bash
npx skills add PhantomCodeGhost/skill-updater -g
```

---

## Usage

```
/skills-update              ← check all + prompt to update
/skills-check               ← check only, no update
/skills-update caveman      ← update one skill
/skills-update --all        ← update all outdated
/skills-update --dry-run    ← preview only
```

Output:
```
Skill                    Status                           Source
──────────────────────────────────────────────────────────────────────────
caveman                  ✅ Up to date                    github.com/user/caveman
obsidian-god             🔄 Update available              github.com/you/obsidian-god
frontend-design          ✅ Up to date                    github.com/vercel-labs/skills
my-local-skill           ⚠️  Untracked                   (no source)
──────────────────────────────────────────────────────────────────────────
1 update available. Update? [all / <names> / no]
```

---

## Source Tracking

Every skill needs a `.skill-source` file to be trackable. Three ways it gets set:

### Auto (best) — `.skill-source` in the skill folder
```
https://github.com/owner/repo
# subdir=skills/my-skill
# branch=main
# sha=abc1234def5678    ← updated automatically after each update
```

### Via frontmatter in SKILL.md
```yaml
skill_source: https://github.com/owner/repo
skill_sha: abc1234def5678
skill_subdir: skills/my-skill
```

### Register manually
```bash
node ~/.claude/skills/skill-updater/scripts/register-source.mjs \
  --skill my-skill \
  --repo https://github.com/owner/repo

# Or ask the agent:
# "Register source for skill my-skill: https://github.com/owner/repo"
```

---

## Rate Limits

| Condition | Limit |
|-----------|-------|
| No token | 60 req/hr (fine for ≤60 skills/hr) |
| With `GITHUB_TOKEN` | 5000 req/hr |

```bash
export GITHUB_TOKEN=ghp_xxxxxxxxxxxx
```

---

## Backup & Rollback

Every update backs up the old skill first:
```
~/.claude/skills/.skill-updater-backup/
└── caveman-2026-06-05T14-30-00/
    ├── SKILL.md
    └── scripts/
```

To restore: copy backup folder back to skills directory.

---

## Scripts

| Script | Purpose |
|--------|---------|
| `detect-skills.mjs` | Find all installed skills (all agents, all paths) |
| `read-sources.mjs` | Resolve source URL + local SHA — zero network |
| `check-updates.mjs` | One API call per skill, compare SHA |
| `update-skills.mjs` | Download + install updates (post-approval only) |
| `register-source.mjs` | Write `.skill-source` for untracked skill |

---

## Requirements

- Node.js ≥ 18
- Internet access for GitHub API
- `GITHUB_TOKEN` env var (optional, recommended)

---

## License

MIT
