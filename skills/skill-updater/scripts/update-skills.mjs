#!/usr/bin/env node
/**
 * update-skills.mjs
 * Pull updates for installed skills.
 * 
 * Usage:
 *   node scripts/update-skills.mjs --skills-dir ~/.claude/skills --all
 *   node scripts/update-skills.mjs --skills-dir ~/.claude/skills --skill caveman --skill extract-design
 * 
 * Output (stdout): JSON array of { name, success, message }
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import https from "https";

const HOME = homedir();
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (f) => args.includes(f) ? args[args.indexOf(f) + 1] : null;
  const getAll = (f) => {
    const v = []; args.forEach((a, i) => { if (a === f && args[i+1]) v.push(args[i+1]); }); return v;
  };
  return {
    skillsDir: get("--skills-dir"),
    skills: getAll("--skill"),
    all: args.includes("--all"),
  };
}

function isGitRepo(dir) { return existsSync(join(dir, ".git")); }

function hasLocalChanges(dir) {
  try {
    const out = execSync(`git -C "${dir}" status --porcelain`, { encoding: "utf8" });
    return out.trim().length > 0;
  } catch { return false; }
}

function gitPull(dir) {
  try {
    const out = execSync(`git -C "${dir}" pull --ff-only`, { encoding: "utf8", timeout: 30000 });
    return { success: true, message: out.trim() || "Updated successfully" };
  } catch (e) {
    return { success: false, message: e.message.split("\n")[0] };
  }
}

function githubHeaders() {
  const h = { "Accept": "application/vnd.github+json", "User-Agent": "skill-updater/1.0" };
  if (GITHUB_TOKEN) h["Authorization"] = `Bearer ${GITHUB_TOKEN}`;
  return h;
}

function parseGitHub(url) {
  const m = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  return m ? { owner: m[1], repo: m[2].replace(/\.git$/, "") } : null;
}

function httpsGet(url, headers) {
  return new Promise((res, rej) => {
    const req = https.request(url, { headers, timeout: 15000 }, (resp) => {
      if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
        httpsGet(resp.headers.location, headers).then(res).catch(rej);
        return;
      }
      let body = Buffer.alloc(0);
      resp.on("data", d => body = Buffer.concat([body, d]));
      resp.on("end", () => res({ status: resp.statusCode, body }));
    });
    req.on("error", rej);
    req.on("timeout", () => rej(new Error("timeout")));
    req.end();
  });
}

async function fetchFromGitHub(skillDir, source) {
  const parts = parseGitHub(source.url);
  if (!parts) return { success: false, message: "cannot parse GitHub URL" };
  const { owner, repo } = parts;
  const branch = source.branch || "main";
  const subdir = source.subdir || "";
  const headers = githubHeaders();

  // Get file tree
  const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
  let treeData;
  try {
    const { body, status } = await httpsGet(treeUrl, headers);
    if (status === 403) return { success: false, message: "GitHub rate limited — set GITHUB_TOKEN" };
    if (status === 404) return { success: false, message: "repo not found (private repo needs GITHUB_TOKEN)" };
    treeData = JSON.parse(body.toString());
  } catch (e) {
    return { success: false, message: `tree fetch failed: ${e.message}` };
  }

  const prefix = subdir ? subdir.replace(/\/?$/, "/") : "";
  const files = (treeData.tree || []).filter(
    f => f.type === "blob" && f.path.startsWith(prefix)
  );
  if (!files.length) return { success: false, message: `no files found at subdir='${subdir}' branch='${branch}'` };

  // Backup
  const bak = skillDir + ".bak";
  try {
    if (existsSync(bak)) execSync(`rm -rf "${bak}"`);
    cpSync(skillDir, bak, { recursive: true });
  } catch {}

  let downloaded = 0;
  for (const file of files) {
    const relPath = file.path.slice(prefix.length);
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${file.path}`;
    const dest = join(skillDir, relPath);
    try {
      mkdirSync(dirname(dest), { recursive: true });
      const { body, status } = await httpsGet(rawUrl, headers);
      if (status !== 200) return { success: false, message: `HTTP ${status} for ${relPath}` };
      writeFileSync(dest, body);
      downloaded++;
    } catch (e) {
      // Restore backup
      try { execSync(`rm -rf "${skillDir}" && cp -r "${bak}" "${skillDir}"`); } catch {}
      return { success: false, message: `download failed for ${relPath}: ${e.message}` };
    }
  }

  return { success: true, message: `Downloaded ${downloaded} file(s) from ${owner}/${repo}` };
}

async function updateSkill(skillDir, source) {
  if (isGitRepo(skillDir)) {
    if (hasLocalChanges(skillDir)) {
      return { success: false, message: "local changes detected — stash or commit first" };
    }
    return gitPull(skillDir);
  }
  if (source?.url) {
    return fetchFromGitHub(skillDir, source);
  }
  return { success: false, message: "no source registered — cannot update" };
}

async function main() {
  const { skillsDir, skills: filterSkills, all } = parseArgs();

  if (!skillsDir) {
    console.error(JSON.stringify({ error: "--skills-dir required" }));
    process.exit(1);
  }

  const dir = skillsDir.replace("~", HOME);
  if (!existsSync(dir)) {
    console.error(JSON.stringify({ error: `skills dir not found: ${dir}` }));
    process.exit(1);
  }

  const { readdirSync, statSync } = await import("fs");
  const { join: pj } = await import("path");

  const toUpdate = [];
  for (const entry of readdirSync(dir).sort()) {
    const fullPath = pj(dir, entry);
    if (!statSync(fullPath).isDirectory()) continue;
    if (!existsSync(pj(fullPath, "SKILL.md"))) continue;
    if (!all && filterSkills.length && !filterSkills.includes(entry)) continue;

    // Load source
    let source = null;
    const srcFile = pj(fullPath, ".skill-source");
    if (existsSync(srcFile)) {
      const lines = readFileSync(srcFile, "utf8").split("\n");
      let url = null, subdir = null, branch = "main";
      for (const l of lines) {
        const t = l.trim();
        if (!t || t.startsWith("#")) continue;
        if (t.startsWith("subdir=")) subdir = t.slice(7);
        else if (t.startsWith("branch=")) branch = t.slice(7);
        else if (t.startsWith("http")) url = t;
      }
      if (url) source = { url, subdir, branch };
    }
    if (!source) {
      try {
        const url = execSync(`git -C "${fullPath}" remote get-url origin 2>/dev/null`, {
          encoding: "utf8"
        }).trim();
        if (url) source = { url, subdir: null, branch: "main" };
      } catch {}
    }

    toUpdate.push({ name: entry, dir: fullPath, source });
  }

  const results = [];
  for (const skill of toUpdate) {
    const result = await updateSkill(skill.dir, skill.source);
    results.push({ name: skill.name, ...result });
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch(err => {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
});
