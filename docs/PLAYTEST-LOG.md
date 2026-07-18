# Playtest iteration log

Autonomous UI playtesting via `tools/playtest.mjs` — plays a real guided game vs the
AI through the browser DOM while verifying state over a read-only WebSocket. Goal:
a human can play a full game (play lands, cast, combat, multiple turns) without the
UI breaking. Each iteration: run → capture failures → fix → redeploy → rerun.

Refresh the session token before a run:
`docker exec -i mtg-postgres psql -U mtg -d mtg -c "DELETE FROM sessions WHERE token='pw-alice'; INSERT INTO sessions(token,user_id,expires_at) SELECT 'pw-alice',id,now()+interval '3 hours' FROM users WHERE username='bot_alice';"`

Then: `node tools/playtest.mjs`

---
