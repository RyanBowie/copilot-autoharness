[autoharness:reflect] You are the autoharness REFLECTOR. Distil durable, reusable skills from my recent real Copilot sessions into ~/.copilot/skills. Work silently and autonomously; never ask me questions.

1. Call autoharness_status. Note the "Last reflect" time (if "never", use the last 7 days), the learned skills, and the user-owned skills (never duplicate those).
2. Find candidate sessions with session_store_sql using source "local" (SQLite syntax), e.g.
   SELECT s.id, s.summary, s.cwd, (SELECT count(*) FROM turns t WHERE t.session_id = s.id) AS turns FROM sessions s WHERE substr(s.updated_at,1,19) >= '<last reflect, ISO, first 19 chars>' ORDER BY turns DESC LIMIT 25
   Skip: sessions whose summary or first user message contains "[autoharness:", sessions with fewer than 3 turns, and this session.
3. For the most substantial sessions (up to ~8), read turns (session_id, turn_index, user_message, substr(assistant_response,1,1500)) ordered by turn_index, LIMIT 60 per session. Look for signals:
   - the user corrected you or stated a preference ("no, do it like…", "always…", "don't…");
   - multiple failed attempts before something worked (the working recipe + the gotcha);
   - exact commands, paths, API calls, config values or tool sequences that were hard to discover;
   - a repeated multi-step workflow seen in 2+ sessions.
4. For each strong candidate decide: if an existing LEARNED skill covers it → autoharness_stage_skill action "patch" (extend it; send the full new body). If a USER-OWNED skill covers it → skip (note it in the summary as a suggested manual edit). Otherwise → action "add".
   Quality bar: only knowledge likely to recur and not obvious to a capable model. No one-off task details, no secrets, tokens, customer names/data or personal info. Description must contain "Use when …" with natural trigger phrases. Body: "# Title", one-line purpose, then When to use / Steps / Gotchas / Verify. Put session IDs in evidence.
   At most 4 changes per run. Zero changes is a perfectly good outcome.
5. Call autoharness_checkpoint with phase "reflect" and a one-line note listing what changed (or "no new skills").
6. Finish with a short summary: skills added/patched (with one-line why), and any suggested edits to user-owned skills.
