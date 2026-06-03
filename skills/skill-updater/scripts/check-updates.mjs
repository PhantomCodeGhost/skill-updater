#!/usr/bin/env node
/**
 * check-updates.mjs
 * Check each installed skill for available updates.
 * 
 * Usage:
 *   node scripts/check-updates.mjs --skills-dir ~/.claude/skills
 *   node scripts/check-updates.mjs --skills-dir ~/.claude/skills --skill caveman
 * 
 * Output (stdout): JSON array of skill status objects
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const HOME = homedir();
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => args.includes(flag) ? args[args.indexOf(flag) + 1] : null;
  const getAll = (flag) => {
    const vals = [];
    args.forEach((a, i) => { if (a === flag && args[i + 1]) vals.push(args[i + 1]); });
    return vals;
  };
  return {
    skillsDir: get("--skills-dir"),
    skills: getAll("--skill"),
  };
}

function isGitRepo(dir) {
  return existsSync(join(dir, ".git"));
}

function githubApiHeaders() {
  const h = { "Accept": "application/vnd.github+json", "User-Agent": "skill-updater/1.0" };
  if (GITHUB_TOKEN) h["Authorization"] = `Bearer ${GITHUB_TOKEN}`;
  return h;
}

function parseGitHubOwnerRepo(url) {
  const m = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  return m ? { owner: m[1], repo: m[2].replace(/\.git$/, "") } : null;
}

async function checkGitRepo(skillDir) {
  try {
    execSync(`git -C "${skillDir}" fetch --quiet 2>/dev/null`, { timeout: 15000 });
    const result = execSync(
      `git -C "${skillDir}" rev-list --count HEAD..@{u} 2>/dev/null`,
      { encoding: "utf8", timeout: 10000 }
    ).trim();
    const behind = parseInt(result || "0", 10);
    return { status: behind > 0 ? "update-available" : "up-to-date", behind };
  } catch (e) {
    const msg = e.message || "";
    if (msg.includes("no upstream")) return { status: "untracked-branch", behind: 0, detail: "no upstream branch" };
    if (msg.includes("ETIMEDOUT") || msg.includes("timeout")) return { status: "error", behind: 0, detail: "fetch timed out" };
    return { status: "error", behind: 0, detail: msg.split("\n")[0] };
  }
}

async function checkGitHubApi(skillDir, source) {
  const parts = parseGitHubOwnerRepo(source.url);
  if (!parts) return { status: "error", detail: "cannot parse GitHub URL" };

  const { owner, repo } = parts;
  const branch = source.branch || "main";
  const url = `https://api.github.com/repos/${owner}/${repo}/commits?sha=${branch}&per_page=1`;

  try {
    const { default: https } = await import("https");
    const data = await new Promise((res, rej) => {
      const req = https.request(url, { headers: githubApiHeaders(), timeout: 10000 }, (resp) => {
        if (resp.statusCode === 403) { rej(new Error("rate-limited")); return; }
        if (resp.statusCode === 404) { rej(new Error("repo not found or private")); return; }
        let body = "";
        resp.on("data", d => body += d);
        resp.on("end", () => {
          try { res(JSON.parse(body)); }
          catch { rej(new Error("invalid JSON")); }
        });
      });
      req.on("error", rej);
      req.on("timeout", () => rej(new Error("timeout")));
      req.end();
    });

    if (!Array.isArray(data) || !data[0]) return { status: "error", detail: "empty commits response" };

    const remoteDate = new Date(data[0].commit.committer.date);
    const skillMd = join(skillDir, "SKILL.md");
    const localMtime = new Date(statSync(skillMd).mtime);

    if (remoteDate > localMtime) {
      const diffDays = Math.round((remoteDate - localMtime) / 86400000);
      return { status: "update-available", behind: null, detail: `remote ~${diffDays}d newer` };
    }
    return { status: "up-to-date", behind: 0 };
  } catch (e) {
    const msg = e.message || "";
    if (msg === "rate-limited") return { status: "error", detail: "GitHub rate limited — set GITHUB_TOKEN env var" };
    if (msg.includes("ENOTFOUND") || msg.includes("ENETUNREACH")) return { status: "offline", detail: "no internet" };
    return { status: "error", detail: msg };
  }
}

async function checkSkill(skill) {
  const { name, dir, source } = skill;

  if (!source || !source.url) {
    return { name, dir, status: "untracked", behind: null, source: null, detail: "no source registered" };
  }

  let result;
  if (isGitRepo(dir)) {
    result = await checkGitRepo(dir);
  } else {
    result = await checkGitHubApi(dir, source);
  }

  return { name, dir, source, ...result };
}

async function main() {
  const { skillsDir, skills: filterSkills } = parseArgs();

  if (!skillsDir) {
    console.error(JSON.stringify({ error: "--skills-dir is required" }));
    process.exit(1);
  }

  // Load skill list (from detect-skills output piped in, or discover inline)
  let skills = [];
  const { readdirSync, existsSync: ex } = await import("fs");
  const { join: pjoin } = await import("path");
  const dir = skillsDir.replace("~", HOME);

  try {
    const entries = readdirSync(dir);
    for (const entry of entries.sort()) {
      const fullPath = pjoin(dir, entry);
      const { statSync: st } = await import("fs");
      if (!st(fullPath).isDirectory()) continue;
      if (!ex(pjoin(fullPath, "SKILL.md"))) continue;
      if (filterSkills.length && !filterSkills.includes(entry)) continue;

      // Read source
      let source = null;
      const srcFile = pjoin(fullPath, ".skill-source");
      if (ex(srcFile)) {
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
        // Try git remote
        try {
          const url = execSync(`git -C "${fullPath}" remote get-url origin 2>/dev/null`, {
            encoding: "utf8", stdio: ["pipe", "pipe", "pipe"]
          }).trim();
          if (url) source = { url, subdir: null, branch: "main" };
        } catch {}
      }

      skills.push({ name: entry, dir: fullPath, source });
    }
  } catch (e) {
    console.error(JSON.stringify({ error: `Cannot read skills dir: ${e.message}` }));
    process.exit(1);
  }

  const results = await Promise.all(skills.map(checkSkill));
  console.log(JSON.stringify(results, null, 2));
}

main().catch(err => {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
});
