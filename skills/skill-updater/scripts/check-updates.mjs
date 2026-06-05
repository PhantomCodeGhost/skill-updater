#!/usr/bin/env node
/**
 * check-updates.mjs — Compare local SHA vs remote HEAD.
 * ONE GitHub API call per skill. No file downloads. ~1KB response per call.
 *
 * Usage:
 *   node check-updates.mjs                        ← auto-detects
 *   node check-updates.mjs --sources-json <file>  ← pipe from read-sources
 *   node check-updates.mjs --skill <name>         ← single skill
 *
 * Env: GITHUB_TOKEN — optional, raises rate limit 60/hr → 5000/hr
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const TOKEN = process.env.GITHUB_TOKEN || null;

// ── GitHub API call (minimal: only latest commit SHA + date) ──────────────────
async function fetchRemoteSha(owner, repo, branch = 'main', subdir = null) {
  let url = `https://api.github.com/repos/${owner}/${repo}/commits?sha=${branch}&per_page=1`;
  if (subdir) url += `&path=${encodeURIComponent(subdir)}`;

  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'skill-updater/2.0',
  };
  if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;

  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });

    if (res.status === 403 || res.status === 429) {
      const remaining = res.headers.get('x-ratelimit-remaining');
      return { error: remaining === '0' ? 'rate_limited' : 'forbidden', sha: null };
    }
    if (res.status === 404) return { error: 'not_found', sha: null };
    if (!res.ok) return { error: `http_${res.status}`, sha: null };

    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return { error: 'empty', sha: null };
    return { sha: data[0].sha, date: data[0].commit?.committer?.date, error: null };
  } catch (e) {
    if (e.name === 'TimeoutError') return { error: 'timeout', sha: null };
    if (e.code === 'ENOTFOUND' || e.message?.includes('fetch')) return { error: 'offline', sha: null };
    return { error: e.message, sha: null };
  }
}

// ── Check one skill ───────────────────────────────────────────────────────────
async function checkSkill(skill) {
  if (!skill.tracked || !skill.owner || !skill.repo) {
    return { ...skill, status: 'NO_SOURCE', remoteSha: null, updateAvailable: false };
  }

  const { sha: remoteSha, date: remoteDate, error } = await fetchRemoteSha(
    skill.owner, skill.repo, skill.branch || 'main', skill.subdir
  );

  if (error) {
    const statusMap = {
      rate_limited: 'RATE_LIMITED',
      offline: 'OFFLINE',
      not_found: 'NOT_FOUND',
      timeout: 'TIMEOUT',
    };
    return { ...skill, status: statusMap[error] || 'ERROR', error, remoteSha: null, updateAvailable: false };
  }

  const localSha = skill.localSha;
  const updateAvailable = localSha ? remoteSha !== localSha : null; // null = unknown (no local SHA stored)
  const status = updateAvailable === true ? 'OUTDATED' : updateAvailable === false ? 'UP_TO_DATE' : 'UNKNOWN_SHA';

  return { ...skill, status, remoteSha, remoteDate, updateAvailable };
}

// ── Main ──────────────────────────────────────────────────────────────────────
let sources;

if (process.argv.includes('--sources-json')) {
  const idx = process.argv.indexOf('--sources-json');
  sources = JSON.parse(fs.readFileSync(process.argv[idx + 1], 'utf8'));
} else {
  const readSrc = new URL('./read-sources.mjs', import.meta.url).pathname;
  sources = JSON.parse(execSync(`node ${readSrc}`, { stdio: ['ignore','pipe','ignore'] }).toString());
}

// Filter to specific skill if requested
const skillFilter = process.argv.includes('--skill')
  ? process.argv[process.argv.indexOf('--skill') + 1]
  : null;
if (skillFilter) sources = sources.filter(s => s.name === skillFilter);

// Check all concurrently (but cap at 10 parallel to avoid hammering API)
const CONCURRENCY = 10;
const results = [];
for (let i = 0; i < sources.length; i += CONCURRENCY) {
  const batch = sources.slice(i, i + CONCURRENCY);
  const batchResults = await Promise.all(batch.map(checkSkill));
  results.push(...batchResults);
}

// Print clean table to stderr, JSON to stdout
const col = (s, w) => (s || '').padEnd(w).slice(0, w);

const statusIcon = {
  UP_TO_DATE:   '✅',
  OUTDATED:     '🔄',
  NO_SOURCE:    '⚠️ ',
  RATE_LIMITED: '❌',
  OFFLINE:      '📡',
  NOT_FOUND:    '🚫',
  TIMEOUT:      '⏱️ ',
  UNKNOWN_SHA:  '❓',
  ERROR:        '❌',
};

process.stderr.write('\n');
process.stderr.write(`${'Skill'.padEnd(24)} ${'Status'.padEnd(32)} Source\n`);
process.stderr.write(`${'─'.repeat(24)} ${'─'.repeat(32)} ${'─'.repeat(40)}\n`);

let outdatedCount = 0;
for (const r of results) {
  const icon = statusIcon[r.status] || '?';
  let statusText = r.status.replace(/_/g, ' ').toLowerCase();
  if (r.status === 'OUTDATED') { statusText = 'Update available'; outdatedCount++; }
  if (r.status === 'UP_TO_DATE') statusText = 'Up to date';
  if (r.status === 'NO_SOURCE') statusText = 'Untracked';
  const source = r.owner ? `github.com/${r.owner}/${r.repo}` : '(no source)';
  process.stderr.write(`${col(r.name,24)} ${icon} ${col(statusText,29)} ${source}\n`);
}

process.stderr.write(`${'─'.repeat(80)}\n`);
process.stderr.write(`${outdatedCount} update(s) available. ${results.filter(r=>r.status==='NO_SOURCE').length} untracked.\n\n`);

if (!TOKEN) {
  process.stderr.write(`💡 Tip: Set GITHUB_TOKEN to raise rate limit from 60/hr to 5000/hr.\n\n`);
}

// JSON output for piping to update-skills
console.log(JSON.stringify(results, null, 2));
