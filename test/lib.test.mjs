// Run: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "autoharness-test-"));
process.env.AUTOHARNESS_HOME = home;
const lib = await import("../extension/autoharness/lib.mjs");

const body = `# Example skill\nA durable, non-obvious procedure used for testing the promoter.\n\n## Steps\n1. Do the first specific thing with the exact command.\n2. Then verify the output matches the expected value.\n\n## Gotchas\n- The obvious approach fails silently; use the explicit flag instead.\n`;
const desc = "Example skill for tests. Use when the user asks to exercise the autoharness promoter in unit tests.";

test("add lints and writes a self-authored skill", () => {
    const r = lib.stage({ action: "add", name: "example-skill", description: desc, body, reason: "unit test add" });
    assert.equal(r.ok, true, r.message);
    const text = fs.readFileSync(path.join(home, "skills", "example-skill", "SKILL.md"), "utf8");
    assert.match(text, /^---\nname: example-skill/);
    assert.ok(text.includes(lib.MARKER));
    assert.equal(lib.isSelfAuthored("example-skill"), true);
});

test("rejects bad input", () => {
    assert.equal(lib.stage({ action: "add", name: "Bad Name", description: desc, body, reason: "unit test bad" }).ok, false);
    assert.equal(lib.stage({ action: "add", name: "no-use-when", description: "x".repeat(60), body, reason: "unit test bad" }).ok, false);
    assert.equal(lib.stage({ action: "add", name: "short-body", description: desc, body: "# Hi\nshort", reason: "unit test bad" }).ok, false);
    assert.equal(lib.stage({ action: "add", name: "no-reason", description: desc, body, reason: "" }).ok, false);
});

test("secret scan blocks credentials", () => {
    const leaky = body + "\nexport GITHUB_TOKEN=ghp_" + "a".repeat(36) + "\n";
    const r = lib.stage({ action: "add", name: "leaky-skill", description: desc, body: leaky, reason: "unit test secret" });
    assert.equal(r.ok, false);
    assert.match(r.message, /secret|token/i);
});

test("never modifies user-owned skills", () => {
    const dir = path.join(home, "skills", "my-own");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), "---\nname: my-own\ndescription: 'mine. Use when testing'\n---\n# Mine\n");
    assert.equal(lib.isSelfAuthored("my-own"), false);
    for (const action of ["patch", "delete"]) {
        const r = lib.stage({ action, name: "my-own", description: desc, body, reason: "unit test owned" });
        assert.equal(r.ok, false, action);
    }
    assert.ok(fs.existsSync(path.join(dir, "SKILL.md")));
    const listed = lib.listSkills().find((s) => s.name === "my-own");
    assert.equal(listed.description, "mine. Use when testing");
});

test("patch, merge and delete archive instead of destroying", () => {
    assert.equal(lib.stage({ action: "patch", name: "example-skill", body: body + "\n- extra gotcha line\n", reason: "unit test patch" }).ok, true);
    assert.equal(lib.stage({ action: "add", name: "other-skill", description: desc, body, reason: "unit test add 2" }).ok, true);
    const m = lib.stage({ action: "merge", name: "example-skill", sources: ["other-skill"], description: desc, body, reason: "unit test merge" });
    assert.equal(m.ok, true, m.message);
    assert.equal(fs.existsSync(path.join(home, "skills", "other-skill")), false);
    const d = lib.stage({ action: "delete", name: "example-skill", reason: "unit test delete" });
    assert.equal(d.ok, true, d.message);
    assert.ok(fs.readdirSync(path.join(home, "autoharness", "archive")).length >= 2);
});

test("usage, stats, status and checkpoint", () => {
    lib.stage({ action: "add", name: "used-skill", description: desc, body, reason: "unit test usage" });
    lib.recordUsage("used-skill", "read", "s1");
    const s = lib.stats().learned.find((x) => x.name === "used-skill");
    assert.ok(s && s.reads >= 1 && s.stage === "probation" && s.recommendation === "keep");
    lib.checkpoint("reflect", "test", "s1");
    assert.ok(lib.readCursors().reflect);
    assert.match(lib.statusMarkdown(), /used-skill/);
});
