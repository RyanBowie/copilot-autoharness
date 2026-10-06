# copilot-autoharness

**A self-learning skill layer for the GitHub Copilot app.** It distils reusable skills from your real Copilot sessions, keeps them up to date as you work and prunes the ones you stop using. There is no daemon and no benchmark, just an app extension plus two scheduled Automations.

This is a port of the idea behind [tigerless-labs/autoharness](https://github.com/tigerless-labs/autoharness) (built for Claude Code) to the GitHub Copilot desktop app. The code was written from scratch for the Copilot app's extension SDK and Automations.

> **Community project, built with GitHub Copilot, under the [MIT licence](LICENSE).** Not a Microsoft product and not supported by Microsoft or GitHub; provided as is, without warranty. See [Licence and disclaimer](#licence-and-disclaimer).

## How it works

```
 your sessions ──► Reflect (daily automation) ──► autoharness_stage_skill ──► ~/.copilot/skills/<name>/SKILL.md
                                                   (lint · secret scan · cap · ledger)
 skill usage ────► extension hooks ──► usage.jsonl ──► Curate (weekly automation) ──► merge · sharpen · prune (archived)
```

| Piece | What it does |
|---|---|
| `extension/autoharness/extension.mjs` | A user-scope **Copilot app extension**. It adds the tools `autoharness_stage_skill`, `autoharness_status` and `autoharness_checkpoint`. Its hooks log skill usage (skill invocations and `SKILL.md` reads), add an occasional "worth saving as a skill?" nudge, and react when you say "remember this" or "make this a skill". |
| `extension/autoharness/lib.mjs` | The promoter (lint, secret scan, capacity cap, atomic writes), plus the ledger and lifecycle stats (probation → mature, stale → prune). |
| `automations/reflect.md` | The prompt for the **daily Reflect** automation. It reads the sessions since the last reflect via `session_store_sql`, then adds or patches up to 4 skills. |
| `automations/curate.md` | The prompt for the **weekly Curate** automation. It prunes unused skills, merges duplicates and sharpens descriptions. |

Learned skills are ordinary Copilot skills, so every Copilot session can use them straight away.

## Install

Requirements: the GitHub Copilot app with extensions and Automations, and Node 20 or later (the app ships its own runtime).

1. **Install the extension**
   ```powershell
   git clone https://github.com/RyanBowie/copilot-autoharness
   cd copilot-autoharness
   ./install.ps1        # Windows
   # sh install.sh      # macOS / Linux
   ```
   This copies two files to `~/.copilot/extensions/autoharness/`.
2. **Load it.** In the Copilot app, tell the agent *"run extensions_reload"* or restart the app. Then ask *"call autoharness_status"*; it should list your skills.
3. **Create the two automations.** Paste the prompt from [`automations/SETUP-PROMPT.md`](automations/SETUP-PROMPT.md) into a new chat. Or create them by hand in the **Automations** view:

   | Name | Schedule | Mode | Prompt |
   |---|---|---|---|
   | Autoharness · Reflect (learn skills) | Daily 18:30 | Autopilot, global (no project) | `automations/reflect.md` |
   | Autoharness · Curate (merge & prune skills) | Weekly, Sunday 19:00 | Autopilot, global (no project) | `automations/curate.md` |

4. Optionally, run **Reflect** once now so it learns from your existing history.

## Safety

- **Your skills are never modified.** Autoharness only edits skills that carry the `<!-- autoharness:self-authored -->` marker it writes, and the promoter refuses anything else.
- **Nothing is destroyed.** Deleted and merged skills move to `~/.copilot/autoharness/archive/`. To restore one, move its folder back to `~/.copilot/skills/<name>/`.
- **There is a quality gate on every write.** Rules:
  - names must be kebab-case;
  - the description must include a "Use when …" clause;
  - the body has a minimum and maximum size;
  - a secret scan rejects tokens, keys and connection strings;
  - the number of learned skills is capped (default 25);
  - there is a limit of 6 writes per session.
- **Everything is audited.** Each decision is appended to `ledger.jsonl` along with its reason.
- Maintenance runs are tagged `[autoharness:…]`, so they don't count as usage and don't get nudges.

## State: `~/.copilot/autoharness/`

| File | Contents |
|---|---|
| `config.json` | `nudges` (true), `nudgeEveryNToolCalls` (50), `maxSkills` (25), `maxStagesPerSession` (6), `probationDays` (14), `matureUses` (3 sessions), `staleDays` (60) |
| `ledger.jsonl` | Every promoter decision |
| `usage.jsonl` | Skill usage, one line per skill, kind and session |
| `cursors.json` | When Reflect and Curate last ran |
| `archive/` | Pruned and merged skills |

**Lifecycle.** A new skill starts in *probation*. It becomes *mature* once it has been used in 3 or more sessions. It is recommended for pruning if it was never used during probation (14 days) or has been idle for 60 days.

## Develop

```sh
node --test test/lib.test.mjs
```
The tests set `AUTOHARNESS_HOME` to a temporary directory, so they never touch your real skills.

## Uninstall

1. Delete the two Automations.
2. Delete `~/.copilot/extensions/autoharness/`. Optionally delete `~/.copilot/autoharness/` too.
3. Learned skills stay in `~/.copilot/skills/`. Delete any you don't want; the learned ones contain `autoharness:self-authored`.

## Credits

The concept comes from [tigerless-labs/autoharness](https://github.com/tigerless-labs/autoharness) (MIT). This repo is an independent implementation for the GitHub Copilot app, also under the MIT license.

## Licence and disclaimer

**Community project, built with GitHub Copilot.** Released under the [MIT licence](LICENSE). It isn't a Microsoft or GitHub product and isn't supported by Microsoft or GitHub. Provided "as is", without warranty of any kind; no SLA or support commitment. Review what the extension and Automations do before installing them.
