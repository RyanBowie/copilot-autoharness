// Autoharness core: promoter (the only writer of learned skills), usage ledger and lifecycle stats.
// Pure Node, no dependencies. Paths can be redirected with AUTOHARNESS_HOME for testing.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const MARKER = "<!-- autoharness:self-authored -->";
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DAY = 86_400_000;

export const DEFAULT_CONFIG = {
    nudges: true,
    nudgeEveryNToolCalls: 50,
    maxSkills: 25,
    maxStagesPerSession: 6,
    probationDays: 14,
    matureUses: 3,
    staleDays: 60,
    maxBodyBytes: 16000,
};

const SECRET_PATTERNS = [
    [/gh[pousr]_[A-Za-z0-9]{30,}/, "GitHub token"],
    [/github_pat_[A-Za-z0-9_]{30,}/, "GitHub PAT"],
    [/sk-[A-Za-z0-9_-]{20,}/, "API key (sk-)"],
    [/AKIA[0-9A-Z]{16}/, "AWS access key"],
    [/xox[abpr]-[A-Za-z0-9-]{10,}/, "Slack token"],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
    [/eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/, "JWT"],
    [/\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/, "bearer token"],
    [/(?:password|passwd|pwd|secret|client_secret|api[_-]?key)\s*[:=]\s*["']?[^\s"'<>{}$]{8,}/i, "credential assignment"],
    [/AccountKey=[A-Za-z0-9+/=]{20,}/, "storage account key"],
];

export function paths() {
    const home = process.env.AUTOHARNESS_HOME || path.join(os.homedir(), ".copilot");
    const state = path.join(home, "autoharness");
    return {
        home,
        skills: path.join(home, "skills"),
        state,
        archive: path.join(state, "archive"),
        config: path.join(state, "config.json"),
        ledger: path.join(state, "ledger.jsonl"),
        usage: path.join(state, "usage.jsonl"),
        cursors: path.join(state, "cursors.json"),
    };
}

function ensureDirs() {
    const p = paths();
    for (const d of [p.skills, p.state, p.archive]) fs.mkdirSync(d, { recursive: true });
    if (!fs.existsSync(p.config)) fs.writeFileSync(p.config, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return p;
}

export function loadConfig() {
    const p = ensureDirs();
    try {
        return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(p.config, "utf8")) };
    } catch {
        return { ...DEFAULT_CONFIG };
    }
}

function readJsonl(file) {
    if (!fs.existsSync(file)) return [];
    const out = [];
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
            out.push(JSON.parse(line));
        } catch {
            /* skip torn line */
        }
    }
    return out;
}

function appendJsonl(file, obj) {
    fs.appendFileSync(file, JSON.stringify(obj) + "\n");
}

function atomicWrite(file, content) {
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, file);
}

export function readCursors() {
    const p = ensureDirs();
    try {
        return JSON.parse(fs.readFileSync(p.cursors, "utf8"));
    } catch {
        return {};
    }
}

export function checkpoint(phase, note, sessionId) {
    const p = ensureDirs();
    const cursors = readCursors();
    cursors[phase] = { at: new Date().toISOString(), note: note || "", session: sessionId || null };
    atomicWrite(p.cursors, JSON.stringify(cursors, null, 2));
    appendJsonl(p.ledger, { ts: cursors[phase].at, action: `checkpoint:${phase}`, note, session: sessionId });
    return cursors[phase];
}

// ---------- skill inspection ----------

function skillFile(name) {
    return path.join(paths().skills, name, "SKILL.md");
}

export function isSelfAuthored(name) {
    try {
        return fs.readFileSync(skillFile(name), "utf8").includes(MARKER);
    } catch {
        return false;
    }
}

function parseFrontmatter(text) {
    const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const fm = {};
    if (!m) return fm;
    for (const line of m[1].split(/\r?\n/)) {
        const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
        if (!kv) continue;
        let v = kv[2].trim();
        if (v.startsWith('"')) {
            try {
                v = JSON.parse(v);
            } catch {
                /* keep raw */
            }
        } else if (v.startsWith("'") && v.endsWith("'") && v.length > 1) {
            v = v.slice(1, -1).replace(/''/g, "'");
        }
        fm[kv[1]] = v;
    }
    return fm;
}

export function listSkills() {
    const p = ensureDirs();
    const out = [];
    for (const ent of fs.readdirSync(p.skills, { withFileTypes: true })) {
        if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
        const f = path.join(p.skills, ent.name, "SKILL.md");
        if (!fs.existsSync(f)) continue;
        const text = fs.readFileSync(f, "utf8");
        const fm = parseFrontmatter(text);
        out.push({
            name: ent.name,
            description: fm.description || "",
            selfAuthored: text.includes(MARKER),
            bytes: Buffer.byteLength(text),
        });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- lint ----------

export function scanSecrets(text) {
    return SECRET_PATTERNS.filter(([re]) => re.test(text)).map(([, label]) => label);
}

function lintSkill({ name, description, body }, cfg) {
    const errors = [];
    if (!name || !NAME_RE.test(name) || name.length < 3 || name.length > 64)
        errors.push("name must be 3-64 chars, lowercase kebab-case (a-z, 0-9, hyphens)");
    if (description !== undefined) {
        const d = String(description).trim();
        if (d.length < 40 || d.length > 1024) errors.push("description must be 40-1024 chars");
        if (!/\buse (?:this |it )?when\b/i.test(d))
            errors.push('description must say when to use the skill (include a "Use when ..." clause)');
    }
    if (body !== undefined) {
        const b = String(body).trim();
        if (b.startsWith("---")) errors.push("body must not include YAML frontmatter; it is generated");
        if (!/^#\s+\S/m.test(b)) errors.push("body must contain a markdown '# Title' heading");
        if (b.length < 200) errors.push("body is too thin (<200 chars); skills must carry real, reusable procedure");
        if (Buffer.byteLength(b) > cfg.maxBodyBytes) errors.push(`body exceeds ${cfg.maxBodyBytes} bytes; tighten it`);
    }
    const secrets = scanSecrets(`${description || ""}\n${body || ""}`);
    if (secrets.length) errors.push(`possible secrets detected (${secrets.join(", ")}); redact before staging`);
    return errors;
}

function render({ name, description, body, created }) {
    const desc = String(description).replace(/\s+/g, " ").trim();
    const meta = `${MARKER}\n<!-- created: ${created} | updated: ${new Date().toISOString()} | edit freely; delete the marker line to take ownership -->`;
    return `---\nname: ${name}\ndescription: ${JSON.stringify(desc)}\n---\n\n${meta}\n\n${String(body).trim()}\n`;
}

function createdOf(name) {
    try {
        const m = fs.readFileSync(skillFile(name), "utf8").match(/<!-- created: (\S+)/);
        if (m) return m[1];
    } catch {
        /* ignore */
    }
    return new Date().toISOString();
}

function writeSkill(name, description, body) {
    const p = ensureDirs();
    const dir = path.join(p.skills, name);
    const exists = fs.existsSync(path.join(dir, "SKILL.md"));
    const content = render({ name, description, body, created: exists ? createdOf(name) : new Date().toISOString() });
    if (exists) {
        atomicWrite(path.join(dir, "SKILL.md"), content);
    } else {
        const tmpDir = path.join(p.skills, `.${name}.tmp-${process.pid}-${Date.now()}`);
        fs.mkdirSync(tmpDir, { recursive: true });
        fs.writeFileSync(path.join(tmpDir, "SKILL.md"), content);
        fs.renameSync(tmpDir, dir);
    }
}

function archiveSkill(name, why) {
    const p = ensureDirs();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dest = path.join(p.archive, `${name}--${stamp}`);
    fs.renameSync(path.join(p.skills, name), dest);
    fs.writeFileSync(path.join(dest, "ARCHIVED.txt"), `${why}\nRestore: move this folder back to ${path.join(p.skills, name)} (drop the --timestamp suffix).\n`);
    return dest;
}

// ---------- promoter ----------

/**
 * Lint and land a skill intent. Only self-authored skills can be modified or removed;
 * user-owned skills are never touched.
 */
export function stage(intent, sessionId) {
    const p = ensureDirs();
    const cfg = loadConfig();
    const { action, name, description, body, sources = [], reason = "", evidence = [] } = intent || {};
    const fail = (msg) => ({ ok: false, message: msg });

    if (!["add", "patch", "merge", "delete"].includes(action)) return fail("action must be add, patch, merge or delete");
    if (String(reason).trim().length < 10) return fail("reason is required (why this is worth keeping/changing)");
    if (!name || !NAME_RE.test(name)) return fail("name must be lowercase kebab-case");

    const exists = fs.existsSync(skillFile(name));
    const owned = exists && isSelfAuthored(name);
    if (exists && !owned && action !== "add")
        return fail(`'${name}' is a user-owned skill; autoharness never modifies it. Pick another name.`);

    const selfCount = listSkills().filter((s) => s.selfAuthored).length;
    const log = (extra) =>
        appendJsonl(p.ledger, { ts: new Date().toISOString(), action, name, reason, evidence, session: sessionId || null, ...extra });

    if (action === "add") {
        if (exists)
            return fail(owned ? `'${name}' already exists (self-authored); use action "patch"` : `'${name}' is a user-owned skill; choose a different name`);
        if (selfCount >= cfg.maxSkills)
            return fail(`capacity reached (${cfg.maxSkills} learned skills). Merge or delete one first.`);
        const errors = lintSkill({ name, description: description ?? "", body: body ?? "" }, cfg);
        if (errors.length) return fail(`lint failed:\n- ${errors.join("\n- ")}`);
        writeSkill(name, description, body);
        log({});
        return { ok: true, message: `Learned new skill '${name}' at ${skillFile(name)}` };
    }

    if (action === "patch") {
        if (!exists) return fail(`'${name}' does not exist; use action "add"`);
        if (description === undefined && body === undefined) return fail("patch needs description and/or body");
        const cur = fs.readFileSync(skillFile(name), "utf8");
        const curDesc = parseFrontmatter(cur).description || "";
        const curBody = cur
            .replace(/^---[\s\S]*?\n---\s*/, "")
            .replace(MARKER, "")
            .replace(/<!-- created: [^\n]*?-->/, "")
            .trim();
        const next = { name, description: description ?? curDesc, body: body ?? curBody };
        const errors = lintSkill(next, cfg);
        if (errors.length) return fail(`lint failed:\n- ${errors.join("\n- ")}`);
        writeSkill(name, next.description, next.body);
        log({});
        return { ok: true, message: `Updated skill '${name}'` };
    }

    if (action === "merge") {
        const srcs = [...new Set(sources)].filter((s) => s !== name);
        if (!srcs.length) return fail("merge needs sources: other learned skills to fold into the target");
        for (const s of srcs) {
            if (!fs.existsSync(skillFile(s))) return fail(`source '${s}' does not exist`);
            if (!isSelfAuthored(s)) return fail(`source '${s}' is user-owned; only learned skills can be merged away`);
        }
        if (description === undefined || body === undefined) return fail("merge needs the full merged description and body");
        if (!exists && selfCount - srcs.length + 1 > cfg.maxSkills) return fail("capacity reached");
        const errors = lintSkill({ name, description, body }, cfg);
        if (errors.length) return fail(`lint failed:\n- ${errors.join("\n- ")}`);
        writeSkill(name, description, body);
        const archived = srcs.map((s) => archiveSkill(s, `Merged into '${name}': ${reason}`));
        log({ sources: srcs, archived });
        return { ok: true, message: `Merged ${srcs.join(", ")} into '${name}' (sources archived)` };
    }

    // delete
    if (!exists) return fail(`'${name}' does not exist`);
    const dest = archiveSkill(name, `Pruned: ${reason}`);
    log({ archived: dest });
    return { ok: true, message: `Pruned '${name}' (archived to ${dest})` };
}

// ---------- usage + lifecycle ----------

export function recordUsage(skill, kind, sessionId) {
    const p = ensureDirs();
    appendJsonl(p.usage, { ts: new Date().toISOString(), skill, kind, session: sessionId || null });
}

function aliasMap() {
    // merged source -> merge target, so usage history follows the surviving skill
    const map = {};
    for (const e of readJsonl(paths().ledger)) if (e.action === "merge") for (const s of e.sources || []) map[s] = e.name;
    const resolve = (n, seen = new Set()) => (map[n] && !seen.has(n) ? resolve(map[n], seen.add(n)) : n);
    return resolve;
}

export function stats() {
    const cfg = loadConfig();
    const p = paths();
    const resolve = aliasMap();
    const usage = {};
    for (const u of readJsonl(p.usage)) {
        const n = resolve(u.skill);
        const s = (usage[n] ||= { invokes: 0, reads: 0, sessions: new Set(), last: null });
        if (u.kind === "invoke") s.invokes++;
        else s.reads++;
        if (u.session) s.sessions.add(u.session);
        if (!s.last || u.ts > s.last) s.last = u.ts;
    }
    const now = Date.now();
    const skills = listSkills().map((s) => {
        const u = usage[s.name] || { invokes: 0, reads: 0, sessions: new Set(), last: null };
        const row = {
            ...s,
            invokes: u.invokes,
            reads: u.reads,
            sessions: u.sessions.size,
            lastUsed: u.last,
        };
        if (s.selfAuthored) {
            const created = Date.parse(createdOf(s.name));
            const ageDays = Math.floor((now - created) / DAY);
            const idleDays = Math.floor((now - Date.parse(u.last || createdOf(s.name))) / DAY);
            const used = u.invokes + u.reads;
            row.ageDays = ageDays;
            row.idleDays = idleDays;
            row.stage = u.sessions.size >= cfg.matureUses ? "mature" : "probation";
            row.recommendation =
                row.stage === "probation" && ageDays >= cfg.probationDays && used === 0
                    ? "prune: never used during probation"
                    : idleDays >= cfg.staleDays
                      ? `prune: unused for ${idleDays} days`
                      : row.stage === "probation" && ageDays >= cfg.probationDays * 2
                        ? "review: still in probation after 2x window"
                        : "keep";
        }
        return row;
    });
    const learned = skills.filter((s) => s.selfAuthored);
    return { config: cfg, cursors: readCursors(), learned, others: skills.filter((s) => !s.selfAuthored), capacity: `${learned.length}/${cfg.maxSkills}` };
}

export function statusMarkdown() {
    const s = stats();
    const ledger = readJsonl(paths().ledger).slice(-10);
    const lines = [];
    lines.push(`# Autoharness status`);
    lines.push(`Learned skills: ${s.capacity} · skills dir: ${paths().skills}`);
    lines.push(
        `Last reflect: ${s.cursors.reflect?.at || "never"} · Last curate: ${s.cursors.curate?.at || "never"}`,
    );
    lines.push(
        `Policy: probation ${s.config.probationDays}d, mature after use in ${s.config.matureUses} sessions, stale after ${s.config.staleDays}d idle.`,
    );
    lines.push("");
    lines.push("## Learned (self-authored) skills");
    if (!s.learned.length) lines.push("_none yet_");
    else {
        lines.push("| name | stage | age d | idle d | invokes | reads | sessions | recommendation | description |");
        lines.push("|---|---|---|---|---|---|---|---|---|");
        for (const k of s.learned)
            lines.push(
                `| ${k.name} | ${k.stage} | ${k.ageDays} | ${k.idleDays} | ${k.invokes} | ${k.reads} | ${k.sessions} | ${k.recommendation} | ${k.description.slice(0, 160).replace(/\|/g, "/")} |`,
            );
    }
    lines.push("");
    lines.push("## User-owned skills (never modified; avoid duplicating them)");
    for (const k of s.others)
        lines.push(`- ${k.name} (invokes ${k.invokes}): ${k.description.slice(0, 140)}`);
    lines.push("");
    lines.push("## Recent decisions");
    if (!ledger.length) lines.push("_none_");
    for (const e of ledger) lines.push(`- ${e.ts} ${e.action} ${e.name || ""} ${e.reason || e.note || ""}`.trim());
    return lines.join("\n");
}
