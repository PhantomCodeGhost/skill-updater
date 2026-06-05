---
name: skill-updater
description: >
  Check for updates to installed AI agent skills and update them safely.
  Triggers on: /skills-update, /skills-check, "update my skills", "check skill updates",
  "are my skills outdated", "update skill <name>", "skills status".
  Scans installed skills, compares local commit SHA vs remote HEAD using one GitHub API
  call per skill (no file downloads until update confirmed), shows status table,
  updates only with approval. Tracks sources via .skill-source files.
  Use whenever user wants to keep skills fresh or diagnose stale skills.
---

# skill-updater

> Token-efficient skill update checker. One API call per skill to detect updates. Downloads nothing until you approve.

---

## Commands

| Phrase | Action |
|--------|--------|
| `/skills-update` | Check all → show table → prompt to update |
| `/skills-check` | Check only, no update |
| `/skills-update <name>` | Update one specific skill |
| `/skills-update --all` | Update all outdated without prompting |
| `/skills-update --dry-run` | Show what would update, write nothing |
| `register source <skill> <url>` | Write `.skill-source` for untracked skill |

---

## How Update Detection Works (token-efficient)

**Never download files to check for updates.** Use GitHub commits API — returns only metadata.

```
For each installed skill:
  1. Read local SHA from .skill-source or SKILL.md frontmatter
  2. GET https://api.github.com/repos/{owner}/{repo}/commits/{branch}?path={subdir}&per_page=1
     → returns latest commit SHA + date. ~1KB response. No file content.
  3. Compare local_sha vs remote_sha
     → match = up to date
     → differ = update available (show commit count diff if possible)
  4. Only download files AFTER user approves update
```

**Single API call per skill. No cloning. No file downloads until confirmed.**

---

## Source Tracking (read in this order)

For each skill folder, find its source using this priority:

### 1. `.skill-source` file (canonical, preferred)
```
https://github.com/owner/repo
# subdir=skills/my-skill
# branch=main
# sha=abc1234def5678
```
All fields after `#` are optional comments parsed as `key=value`.

### 2. `skill_source:` + `skill_sha:` in SKILL.md frontmatter
```yaml
---
name: my-skill
skill_source: https://github.com/owner/repo
skill_sha: abc1234def5678
skill_subdir: skills/my-skill
---
```

### 3. `git remote get-url origin` (if skill dir is a git repo)
Run: `git -C <skill-dir> rev-parse HEAD` → local SHA
Run: `git -C <skill-dir> remote get-url origin` → remote URL

### 4. Untracked — prompt user
Ask: "Skill `<name>` has no source registered. Provide GitHub URL to track it, or skip."
Then write `.skill-source` so it's tracked forever.

---

## Execution Flow

### Step 1 — Detect skills dirs
Run `scripts/detect-skills.mjs` → finds all installed skills across all known agent paths.
Outputs JSON array: `[{ name, path, agent }]`

Known paths (check all that exist):
```
~/.claude/skills/          Claude Code global
~/.gemini/skills/          Gemini CLI global
~/.codex/skills/           Codex global
~/.cursor/skills/          Cursor global
~/.opencode/skills/        OpenCode global
~/.config/agents/skills/   Amp global
.claude/skills/            project-local (Claude Code)
.gemini/skills/            project-local (Gemini)
```

### Step 2 — Read sources
Run `scripts/read-sources.mjs` → for each skill, resolve source URL + local SHA using priority order above.
Outputs: `[{ name, path, source, owner, repo, subdir, branch, localSha, tracked }]`

### Step 3 — Check updates (batched, minimal API calls)
Run `scripts/check-updates.mjs` → for each tracked skill, one GitHub API call.
**Use `GITHUB_TOKEN` env var if set** — raises rate limit from 60/hr to 5000/hr.

For each skill:
```
GET https://api.github.com/repos/{owner}/{repo}/commits?sha={branch}&path={subdir}&per_page=1
Headers: { Authorization: "Bearer $GITHUB_TOKEN" }  // only if token set
```
Parse: `response[0].sha` = remote HEAD SHA.
Compare to `localSha`. Flag as `OUTDATED` | `UP_TO_DATE` | `NO_SOURCE` | `ERROR`.

### Step 4 — Show status table
```
Skill              Status                  Source
─────────────────────────────────────────────────────────────────
caveman            ✅ Up to date           github.com/user/caveman
obsidian-god       🔄 Update available     github.com/you/obsidian-god
frontend-design    ✅ Up to date           github.com/vercel-labs/skills
my-local-skill     ⚠️  Untracked           (no source — run: register source my-local-skill <url>)
old-skill          ❌ Error (rate limited) Set GITHUB_TOKEN env var
─────────────────────────────────────────────────────────────────
1 update available. Update? [all / <names> / no]
```

### Step 5 — Update (only if approved)
Run `scripts/update-skills.mjs --skills <name1,name2>`:
1. Backup existing skill to `~/.claude/skills/.skill-updater-backup/<name>-<timestamp>/`
2. Fetch only the SKILL.md + scripts/ + references/ from GitHub (sparse, no full clone)
3. Write files
4. Update local SHA in `.skill-source`
5. Report what changed

---

## Scripts

| Script | Purpose | Output |
|--------|---------|--------|
| `scripts/detect-skills.mjs` | Find all installed skills | JSON array |
| `scripts/read-sources.mjs` | Resolve source + local SHA per skill | JSON array |
| `scripts/check-updates.mjs` | Compare local vs remote SHA | JSON array with status |
| `scripts/update-skills.mjs` | Download + install updates | Log |
| `scripts/register-source.mjs` | Write `.skill-source` for a skill | Confirmation |

All scripts: clean JSON to stdout, errors to stderr, exit 0 on success.

---

## Rate Limits & Token Usage

| Condition | API calls | Notes |
|-----------|-----------|-------|
| No token, 10 skills | 10 calls | ~60/hr limit, fine for normal use |
| With `GITHUB_TOKEN` | 10 calls | 5000/hr limit |
| Private repos | Requires token | Warns clearly if missing |
| Offline | 0 calls | Graceful "offline" status per skill |

**Token usage:** Only metadata returned (~1KB/skill). Actual skill files (~10-50KB each) only downloaded after approval.

---

## Edge Cases

| Situation | Handling |
|-----------|---------|
| Local edits in skill | Detect via content hash diff → warn before overwriting |
| Monorepo skill | `subdir=` in `.skill-source` scopes API path filter |
| Non-main branch | `branch=` in `.skill-source` |
| Private repo | Needs `GITHUB_TOKEN`; warns clearly |
| Rate limited | Shows `❌ Error (rate limited)` — suggests token |
| No internet | Shows `⚠️ Offline` per skill |
| Duplicate installs (same skill, multiple agents) | Updates all copies |
| SHA missing from source file | Falls back to always-download check |
