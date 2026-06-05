#!/usr/bin/env node
/**
 * update-skills.mjs — Download and install skill updates.
 * Only called AFTER user approves. Backs up first. Updates .skill-source SHA.
 *
 * Usage:
 *   node update-skills.mjs --skills caveman,obsidian-god
 *   node update-skills.mjs --all                          ← update all outdated
 *   node update-skills.mjs --dry-run --skills caveman
 *   node update-skills.mjs --results-json <file>          ← pipe from check-updates
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

const TOKEN = process.env.GITHUB_TOKEN || null;
const isDryRun = process.argv.includes('--dry-run');
const isAll = process.argv.includes('--all');

const skillsArg = process.argv.includes('--skills')
  ? process.argv[process.argv.indexOf('--skills') + 1].split(',').map(s => s.trim())
  : null;

// ── Load check-updates results ────────────────────────────────────────────────
let results;
if (process.argv.includes('--results-json')) {
  const idx = process.argv.indexOf('--results-json');
  results = JSON.parse(fs.readFileSync(process.argv[idx + 1], 'utf8'));
} else {
  const checkScript = new URL('./check-updates.mjs', import.meta.url).pathname;
  results = JSON.parse(execSync(`node ${checkScript}`, { stdio: ['ignore','pipe','pipe'] }).toString());
}

// Filter to skills that need updating
let toUpdate = results.filter(r => r.status === 'OUTDATED' || r.status === 'UNKNOWN_SHA');
if (!isAll && skillsArg) toUpdate = toUpdate.filter(r => skillsArg.includes(r.name));
if (!isAll && !skillsArg) {
  console.error('Specify --all or --skills <name1,name2>');
  process.exit(1);
}

if (toUpdate.length === 0) {
  console.log('Nothing to update.');
  process.exit(0);
}

// ── GitHub raw file fetch ─────────────────────────────────────────────────────
async function fetchFile(owner, repo, filePath, branch = 'main') {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
  const headers = { 'User-Agent': 'skill-updater/2.0' };
  if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!res.ok) return null;
  return res.text();
}

// ── GitHub tree fetch (list files in subdir, no content) ─────────────────────
async function fetchTree(owner, repo, branch = 'main', subdir = null) {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
  const headers = { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'skill-updater/2.0' };
  if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!res.ok) return [];
  const data = await res.json();
  let files = (data.tree || []).filter(f => f.type === 'blob').map(f => f.path);
  if (subdir) files = files.filter(f => f.startsWith(subdir + '/'));
  return files;
}

// ── Backup skill ─────────────────────────────────────────────────────────────
function backupSkill(skillPath, name) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(os.homedir(), '.claude', 'skills', '.skill-updater-backup', `${name}-${ts}`);
  if (!isDryRun) {
    fs.mkdirSync(backupDir, { recursive: true });
    copyDir(skillPath, backupDir);
  }
  return backupDir;
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// ── Update one skill ──────────────────────────────────────────────────────────
async function updateSkill(skill) {
  const { name, path: skillPath, owner, repo, branch, subdir, remoteSha } = skill;
  console.log(`\nUpdating ${name}...`);

  const backupPath = backupSkill(skillPath, name);
  console.log(`  Backed up → ${backupPath}`);

  // Fetch file list from tree (single API call, no content)
  const skillSubdir = subdir || `skills/${name}`;
  const allFiles = await fetchTree(owner, repo, branch || 'main', skillSubdir);

  if (allFiles.length === 0) {
    // Fallback: fetch just SKILL.md
    console.log(`  Tree empty for subdir=${skillSubdir}, fetching SKILL.md only`);
    const content = await fetchFile(owner, repo, `${skillSubdir}/SKILL.md`, branch || 'main');
    if (!content) { console.error(`  ❌ Could not fetch ${name}`); return false; }
    if (!isDryRun) fs.writeFileSync(path.join(skillPath, 'SKILL.md'), content);
    console.log(`  ✅ SKILL.md updated`);
  } else {
    // Download each file
    for (const filePath of allFiles) {
      const relToSkill = filePath.slice(skillSubdir.length + 1); // strip subdir prefix
      const destPath = path.join(skillPath, relToSkill);
      if (isDryRun) { console.log(`  [dry-run] would write ${relToSkill}`); continue; }
      const content = await fetchFile(owner, repo, filePath, branch || 'main');
      if (content === null) { console.warn(`  ⚠️  Could not fetch ${filePath} — skipping`); continue; }
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, content);
      console.log(`  wrote ${relToSkill}`);
    }
  }

  // Update SHA in .skill-source
  if (!isDryRun && remoteSha) {
    const sourceFile = path.join(skillPath, '.skill-source');
    let sourceContent = fs.existsSync(sourceFile) ? fs.readFileSync(sourceFile, 'utf8') : `${skill.url}\n`;
    // Replace or add sha= line
    if (/^# sha=/m.test(sourceContent)) {
      sourceContent = sourceContent.replace(/^# sha=.*/m, `# sha=${remoteSha}`);
    } else {
      sourceContent = sourceContent.trimEnd() + `\n# sha=${remoteSha}\n`;
    }
    fs.writeFileSync(sourceFile, sourceContent);
    console.log(`  SHA updated → ${remoteSha.slice(0,7)}`);
  }

  console.log(`  ✅ ${name} updated`);
  return true;
}

// ── Run ───────────────────────────────────────────────────────────────────────
let updated = 0, failed = 0;
for (const skill of toUpdate) {
  const ok = await updateSkill(skill);
  if (ok) updated++; else failed++;
}

console.log(`\n${'─'.repeat(40)}`);
console.log(`Updated: ${updated}  Failed: ${failed}`);
if (isDryRun) console.log('[dry-run — no files written]');
