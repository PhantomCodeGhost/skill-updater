#!/usr/bin/env node
/**
 * register-source.mjs
 * Register or update the source repo for an installed skill.
 * 
 * Usage:
 *   node scripts/register-source.mjs --skill caveman --repo https://github.com/owner/repo --skills-dir ~/.claude/skills
 *   node scripts/register-source.mjs --skill my-skill --repo https://github.com/org/mono --subdir skills/my-skill --branch dev --skills-dir ~/.claude/skills
 * 
 * Output (stdout): JSON { success, skillDir, sourceFile }
 */

import { existsSync, writeFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const HOME = homedir();

const KNOWN_DIRS = [
  `${HOME}/.claude/skills`,
  `${HOME}/.gemini/skills`,
  `${HOME}/.cursor/skills`,
  `${HOME}/.codex/skills`,
  `${HOME}/.config/opencode/skills`,
  `${HOME}/.codeium/windsurf/skills`,
  `.claude/skills`,
  `.agents/skills`,
];

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (f) => args.includes(f) ? args[args.indexOf(f) + 1] : null;
  return {
    skill: get("--skill"),
    repo: get("--repo"),
    subdir: get("--subdir"),
    branch: get("--branch") || "main",
    skillsDir: get("--skills-dir"),
  };
}

function findSkillDir(skillName, skillsDir) {
  const searchDirs = skillsDir
    ? [skillsDir.replace("~", HOME)]
    : KNOWN_DIRS;

  for (const base of searchDirs) {
    const p = join(base, skillName);
    if (existsSync(p) && existsSync(join(p, "SKILL.md"))) return p;
  }
  return null;
}

function main() {
  const { skill, repo, subdir, branch, skillsDir } = parseArgs();

  if (!skill || !repo) {
    console.error(JSON.stringify({ error: "--skill and --repo are required" }));
    process.exit(1);
  }

  const skillDir = findSkillDir(skill, skillsDir);
  if (!skillDir) {
    console.error(JSON.stringify({
      error: `skill '${skill}' not found`,
      searched: skillsDir ? [skillsDir] : KNOWN_DIRS,
    }));
    process.exit(1);
  }

  const lines = [
    `# Source repo for skill: ${skill}`,
    `# Managed by skill-updater — edit manually if needed.`,
    repo,
  ];
  if (subdir) lines.push(`subdir=${subdir}`);
  if (branch !== "main") lines.push(`branch=${branch}`);

  const sourceFile = join(skillDir, ".skill-source");
  writeFileSync(sourceFile, lines.join("\n") + "\n", "utf8");

  console.log(JSON.stringify({
    success: true,
    skill,
    skillDir,
    sourceFile,
    repo,
    ...(subdir ? { subdir } : {}),
    branch,
  }, null, 2));
}

main();
