// Extension: autoharness
// Self-learning skill layer for the GitHub Copilot app: learns skills from real sessions into
// ~/.copilot/skills, tracks which ones get used, and prunes the ones that stop earning their keep.
// Reflection/curation runs from the "Autoharness · Reflect/Curate" automations; this extension
// provides the safe promoter tools, usage ledger and in-session nudges.

import { joinSession } from "@github/copilot-sdk/extension";
import { checkpoint, loadConfig, recordUsage, stage, statusMarkdown, stats } from "./lib.mjs";

const MAINT_RE = /\[autoharness:(reflect|curate|maint)\]/i;
const SKILL_PATH_RE = /[\\/]skills[\\/]([a-z0-9][a-z0-9-]*)[\\/]SKILL\.md/i;

let maintenance = false; // reflect/curate sessions don't count usage or get nudged
let toolCalls = 0;
let stagesThisSession = 0;
const seen = new Set();

function track(skill, kind, sessionId) {
    if (maintenance || !skill) return;
    const key = `${kind}:${skill}`;
    if (seen.has(key)) return;
    seen.add(key);
    try {
        recordUsage(skill, kind, sessionId);
    } catch {
        /* never break the session over telemetry */
    }
}

function nudge() {
    const cfg = loadConfig();
    if (maintenance || !cfg.nudges || cfg.nudgeEveryNToolCalls <= 0) return undefined;
    toolCalls++;
    if (toolCalls % cfg.nudgeEveryNToolCalls !== 0) return undefined;
    return {
        additionalContext:
            `[autoharness] ${toolCalls} tool calls this session. Silently consider: did the recent work reveal a ` +
            `reusable, non-obvious procedure, gotcha or user preference that an existing skill doesn't already cover ` +
            `(e.g. you were corrected, retried several approaches, or discovered an undocumented quirk)? If so, call ` +
            `autoharness_stage_skill once (add, or patch an existing learned skill). If not, ignore this note and ` +
            `don't mention it to the user.`,
    };
}

const session = await joinSession({
    hooks: {
        onSessionStart: async (input) => {
            if (input?.initialPrompt && MAINT_RE.test(input.initialPrompt)) maintenance = true;
            if (maintenance) return undefined;
            let learned = 0;
            try {
                learned = stats().learned.length;
            } catch {
                /* ignore */
            }
            return {
                additionalContext:
                    `[autoharness] Self-learning skills are on (${learned} learned skill(s) in ~/.copilot/skills, marked ` +
                    `"autoharness:self-authored"). When the user says "remember this", "learn this" or "make this a skill", ` +
                    `or you discover a durable reusable procedure, use autoharness_stage_skill. Never stage secrets, ` +
                    `customer data or one-off details.`,
            };
        },
        onUserPromptSubmitted: async (input) => {
            if (input?.prompt && MAINT_RE.test(input.prompt)) maintenance = true;
            return undefined;
        },
        onPostToolUse: async (input, invocation) => {
            const sid = invocation?.sessionId;
            const args = input?.toolArgs || {};
            if (input?.toolName === "skill" && typeof args.skill === "string") track(args.skill, "invoke", sid);
            else if (input?.toolName === "view" && typeof args.path === "string") {
                const m = args.path.match(SKILL_PATH_RE);
                if (m) track(m[1], "read", sid);
            }
            return nudge();
        },
        onPostToolUseFailure: async () => nudge(),
    },
    tools: [
        {
            name: "autoharness_stage_skill",
            description:
                "Autoharness promoter: create, update, merge or prune a LEARNED skill in ~/.copilot/skills. It lints the " +
                "skill (name, 'Use when' description, real body, secret scan, capacity cap) and writes it atomically. " +
                "It never modifies user-owned skills; deletes and merge sources are archived, not destroyed.\n" +
                "Good skills capture durable, non-obvious knowledge that will recur: a multi-step procedure that worked, " +
                "a gotcha that cost retries, a user preference or correction, or exact commands/paths/APIs. Bad skills " +
                "restate generic knowledge, describe a one-off task, or duplicate an existing skill (patch that one instead).\n" +
                "Body format: '# Title', a one-line purpose, then sections such as 'When to use', 'Steps', 'Gotchas' and " +
                "'Verify'. Keep it imperative, specific and under ~150 lines. Do not include frontmatter; it is generated.",
            parameters: {
                type: "object",
                properties: {
                    action: { type: "string", enum: ["add", "patch", "merge", "delete"] },
                    name: {
                        type: "string",
                        description: "kebab-case skill name (target name for merge)",
                    },
                    description: {
                        type: "string",
                        description:
                            "40-1024 chars: what the skill does plus a 'Use when ...' clause with the trigger phrases a user would say. Required for add/merge.",
                    },
                    body: {
                        type: "string",
                        description: "Markdown body (no frontmatter). Required for add/merge; optional for patch (full replacement).",
                    },
                    sources: {
                        type: "array",
                        items: { type: "string" },
                        description: "merge only: learned skills folded into the target and archived",
                    },
                    reason: { type: "string", description: "Why this change is worth making (logged to the ledger)" },
                    evidence: {
                        type: "array",
                        items: { type: "string" },
                        description: "Optional session IDs or short pointers backing the change",
                    },
                },
                required: ["action", "name", "reason"],
            },
            skipPermission: true,
            handler: async (args, invocation) => {
                const cfg = loadConfig();
                if (stagesThisSession >= cfg.maxStagesPerSession)
                    return {
                        textResultForLlm: `Stage limit reached for this session (${cfg.maxStagesPerSession}). Prioritise; no more changes.`,
                        resultType: "failure",
                    };
                const res = stage(args, invocation?.sessionId);
                if (!res.ok) return { textResultForLlm: res.message, resultType: "failure" };
                stagesThisSession++;
                await session.log(`🧠 autoharness: ${res.message}`);
                return res.message;
            },
        },
        {
            name: "autoharness_status",
            description:
                "Show autoharness state: learned skills with lifecycle stage, usage counts, idle days and prune/keep " +
                "recommendations; user-owned skills (to avoid duplicates); last reflect/curate cursors; recent decisions.",
            parameters: { type: "object", properties: {} },
            skipPermission: true,
            handler: async () => statusMarkdown(),
        },
        {
            name: "autoharness_checkpoint",
            description:
                "Record that a reflect or curate pass finished, moving its cursor to now so the next pass only reviews newer sessions.",
            parameters: {
                type: "object",
                properties: {
                    phase: { type: "string", enum: ["reflect", "curate"] },
                    note: { type: "string", description: "One-line summary of what the pass did" },
                },
                required: ["phase"],
            },
            skipPermission: true,
            handler: async (args, invocation) => {
                maintenance = true;
                const c = checkpoint(args.phase, args.note, invocation?.sessionId);
                return `Checkpoint '${args.phase}' set to ${c.at}`;
            },
        },
    ],
});
