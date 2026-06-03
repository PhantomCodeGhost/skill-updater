# GitHub API Reference

## Endpoints Used

### Latest commit on branch
```
GET https://api.github.com/repos/{owner}/{repo}/commits?sha={branch}&per_page=1
```
Response: `[{ commit: { committer: { date: "2024-01-15T10:30:00Z" } } }]`

### File tree (recursive)
```
GET https://api.github.com/repos/{owner}/{repo}/git/trees/{branch}?recursive=1
```
Response: `{ tree: [{ path, type, sha, url }] }`

### Raw file download
```
GET https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}
```
No auth needed for public repos (but rate-limited).

---

## Auth

Set `GITHUB_TOKEN` env var to avoid rate limits and access private repos:
```bash
export GITHUB_TOKEN=ghp_xxxxxxxxxxxx
```

| | Unauthenticated | Authenticated |
|---|---|---|
| Rate limit | 60 req/hr | 5000 req/hr |
| Private repos | ❌ | ✅ |

Rate limit response: HTTP 403 with `X-RateLimit-Remaining: 0`

Private repos return 404 (not 401) without auth.

---

## URL Parsing

Supported formats:
- `https://github.com/owner/repo`
- `https://github.com/owner/repo.git`
- `git@github.com:owner/repo.git`

Regex: `github\.com[/:]([^/]+)\/([^/.]+)`
