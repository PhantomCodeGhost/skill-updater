#!/usr/bin/env node
/**
 * read-sources.mjs — Resolve source URL + local SHA for each installed skill.
 * Zero network calls. Reads .skill-source, SKILL.md frontmatter, or git remote.
 *
 * Usage:
 *   node read-sources.mjs                        ← auto-detects via detect-skills
 *   node read-sources.mjs --skills-json <file>   ← pipe from detect-skills output
 *   echo '[...]' | node read-sources.mjs --stdin
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// ── Parse .skill-source file ──────────────────────────────────────────────────
function parseSkillSource(content) {
  const result = { url: null, subdir: null, branch: 'main', sha: null };
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      // parse key=value from comment lines
      const kv = trimmed.replace(/^#\s*/, '').match(/^(\w+)=(.+)$/);
      if (kv) result[kv[1]] = kv[2].trim();
      continue;
    }
    if (trimmed.startsWith('http')) result.url = trimmed;
  }
  return result;
}

// ── Parse SKILL.md frontmatter ────────────────────────────────────────────────
function parseFrontmatter(content) {
  if (!content.startsWith('---')) return {};
  const end = content.indexOf('\n---', 3);
  if (end === -1) return {};
  const fm = content.slice(4, end);
  const result = {};
  for (const line of fm.split('\n')) {
    const m = line.match(/^([\w_]+):\s*(.+)$/);
    if (m) result[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return result;
}

// ── Parse GitHub URL → owner/repo ────────────────────────────────────────────
function parseGitHubUrl(url) {
  if (!url) return null;
  const m = url.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/|$)/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

// ── Git helpers ───────────────────────────────────────────────────────────────
function gitExec(cmd, cwd) {
  try { return execSync(cmd, { cwd, stdio: ['ignore','pipe','ignore'] }).toString().trim(); }
  catch { return null; }
}

// ── Resolve source for one skill ──────────────────────────────────────────────
function resolveSource(skill) {
  const { name, path: skillPath } = skill;

  // Priority 1: .skill-source file
  const sourceFile = path.join(skillPath, '.skill-source');
  if (fs.existsSync(sourceFile)) {
    const parsed = parseSkillSource(fs.readFileSync(sourceFile, 'utf8'));
    const gh = parseGitHubUrl(parsed.url);
    return {
      ...skill,
      tracked: true,
      sourceFrom: '.skill-source',
      url: parsed.url,
      owner: gh?.owner,
      repo: gh?.repo,
      subdir: parsed.subdir || null,
      branch: parsed.branch || 'main',
      localSha: parsed.sha || null,
    };
  }

  // Priority 2: SKILL.md frontmatter
  const skillMd = path.join(skillPath, 'SKILL.md');
  if (fs.existsSync(skillMd)) {
    const fm = parseFrontmatter(fs.readFileSync(skillMd, 'utf8'));
    if (fm.skill_source) {
      const gh = parseGitHubUrl(fm.skill_source);
      return {
        ...skill,
        tracked: true,
        sourceFrom: 'SKILL.md frontmatter',
        url: fm.skill_source,
        owner: gh?.owner,
        repo: gh?.repo,
        subdir: fm.skill_subdir || null,
        branch: fm.skill_branch || 'main',
        localSha: fm.skill_sha || null,
      };
    }
  }

  // Priority 3: git remote
  const remote = gitExec('git remote get-url origin', skillPath);
  if (remote) {
    const localSha = gitExec('git rev-parse HEAD', skillPath);
    const gh = parseGitHubUrl(remote);
    return {
      ...skill,
      tracked: !!gh,
      sourceFrom: 'git remote',
      url: remote,
      owner: gh?.owner,
      repo: gh?.repo,
      subdir: null,
      branch: 'main',
      localSha,
    };
  }

  // No source found
  return { ...skill, tracked: false, sourceFrom: null, url: null, owner: null, repo: null, subdir: null, branch: 'main', localSha: null };
}

// ── Main ──────────────────────────────────────────────────────────────────────
let skills;

if (process.argv.includes('--stdin')) {
  const raw = fs.readFileSync('/dev/stdin', 'utf8');
  skills = JSON.parse(raw);
} else if (process.argv.includes('--skills-json')) {
  const idx = process.argv.indexOf('--skills-json');
  skills = JSON.parse(fs.readFileSync(process.argv[idx + 1], 'utf8'));
} else {
  // Run detect-skills inline
  const { execSync: ex } = await import('child_process');
  const detectScript = new URL('./detect-skills.mjs', import.meta.url).pathname;
  skills = JSON.parse(ex(`node ${detectScript}`, { stdio: ['ignore','pipe','ignore'] }).toString());
}

const results = skills.map(resolveSource);
console.log(JSON.stringify(results, null, 2));
