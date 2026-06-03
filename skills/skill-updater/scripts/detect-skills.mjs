#!/usr/bin/env node
/**
 * detect-skills.mjs
 * Scan all known agent skill directories and return installed skills as JSON.
 * 
 * Usage:
 *   node scripts/detect-skills.mjs
 *   node scripts/detect-skills.mjs --skills-dir ~/.claude/skills
 * 
 * Output (stdout): JSON { skillsDir, skills: [{ name, dir, source }] }
 */

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";

const HOME = homedir();

/** All known agent skill directories, in priority order */
const KNOWN_DIRS = [
  // Global paths
  `${HOME}/.claude/skills`,
  `${HOME}/.gemini/skills`,
  `${HOME}/.cursor/skills`,
  `${HOME}/.codex/skills`,
  `${HOME}/.config/opencode/skills`,
  `${HOME}/.codeium/windsurf/skills`,
  `${HOME}/.config/goose/skills`,
  `${HOME}/.config/agents/skills`,
  `${HOME}/.agents/skills`,
  // Project paths (relative to cwd)
  `.claude/skills`,
  `.agents/skills`,
  `.windsurf/skills`,
  `.goose/skills`,
];

function parseArgs() {
  const args = process.argv.slice(2);
  const skillsDir = args.includes("--skills-dir")
    ? args[args.indexOf("--skills-dir") + 1]
    : null;
  return { skillsDir };
}

function findSkillsDirs() {
  const found = [];
  for (const dir of KNOWN_DIRS) {
    const abs = dir.startsWith("/") ? dir : resolve(process.cwd(), dir);
    if (existsSync(abs)) found.push(abs);
  }
  return found;
}

function extractFrontmatterField(skillMdPath, field) {
  try {
    const content = readFileSync(skillMdPath, "utf8");
    const lines = content.split("\n");
    let inFront = false;
    for (const line of lines) {
      if (line.trim() === "---") {
        if (!inFront) { inFront = true; continue; }
        else break;
      }
      if (inFront && line.startsWith(field + ":")) {
        return line.split(":").slice(1).join(":").trim().replace(/^['"]|['"]$/g, "");
      }
    }
  } catch {}
  return null;
}

function readSkillSource(skillDir) {
  // 1. .skill-source file
  const sourceFile = join(skillDir, ".skill-source");
  if (existsSync(sourceFile)) {
    try {
      const lines = readFileSync(sourceFile, "utf8").split("\n");
      let url = null, subdir = null, branch = "main";
      for (const line of lines) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        if (t.startsWith("subdir=")) subdir = t.slice(7);
        else if (t.startsWith("branch=")) branch = t.slice(7);
        else if (t.startsWith("http")) url = t;
      }
      if (url) return { url, subdir, branch };
    } catch {}
  }

  // 2. skill_source frontmatter in SKILL.md
  const skillMd = join(skillDir, "SKILL.md");
  if (existsSync(skillMd)) {
    const src = extractFrontmatterField(skillMd, "skill_source");
    if (src) return { url: src, subdir: null, branch: "main" };
  }

  // 3. git remote
  try {
    const { execSync } = await import("child_process");
    const url = execSync(`git -C "${skillDir}" remote get-url origin 2>/dev/null`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (url) return { url, subdir: null, branch: "main" };
  } catch {}

  return null;
}

function getSkillName(skillDir) {
  const skillMd = join(skillDir, "SKILL.md");
  if (existsSync(skillMd)) {
    const name = extractFrontmatterField(skillMd, "name");
    if (name) return name;
  }
  // Fallback: directory name
  return skillDir.split("/").pop();
}

function discoverSkillsInDir(dir) {
  const skills = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries.sort()) {
      const fullPath = join(dir, entry);
      if (!statSync(fullPath).isDirectory()) continue;
      if (!existsSync(join(fullPath, "SKILL.md"))) continue;
      const name = getSkillName(fullPath);
      const source = readSkillSource(fullPath);
      skills.push({ name, dir: fullPath, source });
    }
  } catch {}
  return skills;
}

async function main() {
  const { skillsDir: argDir } = parseArgs();

  let searchDirs;
  if (argDir) {
    searchDirs = [resolve(argDir.replace("~", HOME))];
  } else {
    searchDirs = findSkillsDirs();
  }

  if (searchDirs.length === 0) {
    console.log(JSON.stringify({ skillsDir: null, skills: [], error: "no-skills-dir-found" }));
    process.exit(0);
  }

  const allSkills = [];
  for (const dir of searchDirs) {
    const found = discoverSkillsInDir(dir);
    allSkills.push(...found);
  }

  // Deduplicate by name (prefer first found)
  const seen = new Set();
  const unique = allSkills.filter(s => {
    if (seen.has(s.name)) return false;
    seen.add(s.name);
    return true;
  });

  console.log(JSON.stringify({ skillsDir: searchDirs[0], skills: unique }, null, 2));
}

main().catch(err => {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
});
