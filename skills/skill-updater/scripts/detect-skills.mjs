#!/usr/bin/env node
/**
 * detect-skills.mjs — Find all installed skills across all known agent paths.
 * Outputs JSON array to stdout. No network calls.
 *
 * Usage: node detect-skills.mjs [--json]
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const HOME = os.homedir();

// All known agent skill directories (global + common project-local)
const KNOWN_DIRS = [
  { agent: 'claude-code',  path: path.join(HOME, '.claude', 'skills') },
  { agent: 'gemini-cli',   path: path.join(HOME, '.gemini', 'skills') },
  { agent: 'codex',        path: path.join(HOME, '.codex', 'skills') },
  { agent: 'cursor',       path: path.join(HOME, '.cursor', 'skills') },
  { agent: 'opencode',     path: path.join(HOME, '.opencode', 'skills') },
  { agent: 'amp',          path: path.join(HOME, '.config', 'agents', 'skills') },
  { agent: 'goose',        path: path.join(HOME, '.config', 'goose', 'skills') },
  // project-local (cwd)
  { agent: 'claude-code',  path: path.join(process.cwd(), '.claude', 'skills') },
  { agent: 'gemini-cli',   path: path.join(process.cwd(), '.gemini', 'skills') },
  { agent: 'codex',        path: path.join(process.cwd(), '.codex', 'skills') },
];

const seen = new Set();
const results = [];

for (const { agent, path: dir } of KNOWN_DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillDir = path.join(dir, entry.name);
    const skillMd = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(skillMd)) continue;
    // Deduplicate by resolved real path
    const real = fs.realpathSync(skillDir);
    if (seen.has(real)) continue;
    seen.add(real);
    results.push({ name: entry.name, path: skillDir, agent });
  }
}

console.log(JSON.stringify(results, null, 2));
