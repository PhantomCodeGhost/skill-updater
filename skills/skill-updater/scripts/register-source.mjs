#!/usr/bin/env node
/**
 * register-source.mjs — Write .skill-source for an untracked skill.
 *
 * Usage:
 *   node register-source.mjs --skill caveman --repo https://github.com/user/caveman-skill
 *   node register-source.mjs --skill my-skill --repo https://github.com/user/repo --subdir skills/my-skill
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

const args = process.argv;
const get = (flag) => { const i = args.indexOf(flag); return i > -1 ? args[i + 1] : null; };

const skillName = get('--skill');
const repo = get('--repo');
const subdir = get('--subdir');
const branch = get('--branch') || 'main';
const skillsDir = get('--skills-dir') || path.join(os.homedir(), '.claude', 'skills');

if (!skillName || !repo) {
  console.error('Usage: node register-source.mjs --skill <name> --repo <github-url> [--subdir <path>] [--branch <branch>]');
  process.exit(1);
}

const skillPath = path.join(skillsDir, skillName);
if (!fs.existsSync(skillPath)) {
  console.error(`Skill directory not found: ${skillPath}`);
  process.exit(1);
}

// Fetch current remote HEAD SHA (one API call)
const TOKEN = process.env.GITHUB_TOKEN || null;
const m = repo.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/|$)/);
let sha = null;

if (m) {
  try {
    const apiUrl = `https://api.github.com/repos/${m[1]}/${m[2]}/commits?sha=${branch}&per_page=1${subdir ? `&path=${encodeURIComponent(subdir)}` : ''}`;
    const headers = { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'skill-updater/2.0' };
    if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;
    const res = await fetch(apiUrl, { headers, signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const data = await res.json();
      sha = data[0]?.sha || null;
    }
  } catch {}
}

let content = `${repo}\n`;
if (subdir) content += `# subdir=${subdir}\n`;
if (branch !== 'main') content += `# branch=${branch}\n`;
if (sha) content += `# sha=${sha}\n`;

const sourceFile = path.join(skillPath, '.skill-source');
fs.writeFileSync(sourceFile, content);

console.log(`✅ Source registered for '${skillName}'`);
console.log(`   File: ${sourceFile}`);
console.log(`   Repo: ${repo}`);
if (subdir) console.log(`   Subdir: ${subdir}`);
if (sha) console.log(`   SHA: ${sha.slice(0, 7)}`);
else console.log(`   SHA: (not recorded — will check on next /skills-update)`);
