/* Runs inside GitHub Actions (never in the browser).
   Reads SinCityRyd3r_702's real status from the official Twitch API with app authentication
   (client credentials) and writes data/stream-status.json for the website.
   Secrets come from the repository's Actions secrets: TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET. */
import fs from "node:fs";

const CHANNEL = (process.env.TWITCH_CHANNEL_LOGIN || "sincityryd3r_702").toLowerCase();
const OUT = "data/stream-status.json";
const HEARTBEAT_MS = 30 * 60 * 1000;   // republish at least every 30 min so visitors can tell the data is fresh

const id = process.env.TWITCH_CLIENT_ID, secret = process.env.TWITCH_CLIENT_SECRET;
const prev = (() => { try { return JSON.parse(fs.readFileSync(OUT, "utf8")); } catch { return null; } })();
const now = new Date();

async function timed(url, opts = {}, ms = 10000) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...opts, signal: c.signal }); } finally { clearTimeout(t); }
}
async function token() {
  const r = await timed("https://id.twitch.tv/oauth2/token", { method: "POST", body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: "client_credentials" }) });
  if (!r.ok) throw new Error(`Twitch authentication failed (HTTP ${r.status})`);
  return (await r.json()).access_token;
}
async function helix(path, params, tok, retried = false) {
  const u = new URL("https://api.twitch.tv/helix" + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await timed(u, { headers: { "Client-Id": id, Authorization: `Bearer ${tok}` } });
    if (r.status === 404) return { notFound: true, data: [] };
    if (r.status === 429 || r.status >= 500) { await new Promise(z => setTimeout(z, 2000 * (attempt + 1))); continue; }
    if (r.status === 401 && !retried) return helix(path, params, await token(), true);
    if (!r.ok) throw new Error(`Twitch API error ${r.status} on ${path}`);
    return r.json();
  }
  throw new Error(`Twitch API busy on ${path}, will retry next run`);
}

let out;
try {
  if (!id || !secret) throw new Error("TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET are not set in the repository secrets");
  const tok = await token();
  const u = (await helix("/users", { login: CHANNEL }, tok)).data?.[0];
  if (!u) throw new Error(`Twitch channel "${CHANNEL}" not found`);
  const s = (await helix("/streams", { user_id: u.id, type: "live" }, tok)).data?.[0] || null;
  let next = null;
  try {
    const sc = await helix("/schedule", { broadcaster_id: u.id, first: "10" }, tok);
    const seg = (sc.data?.segments || []).find(x => !x.canceled_until && new Date(x.start_time) > new Date(now - 60000));
    if (seg) next = { start: seg.start_time, end: seg.end_time, title: seg.title || null, category: seg.category?.name || null };
    const vac = sc.data?.vacation;
    if (next && vac && new Date(vac.end_time) > now && new Date(next.start) < new Date(vac.end_time)) next = null;
  } catch (e) { console.log("Schedule not available:", e.message); }
  out = {
    ok: true, source: "twitch-helix", channel: { login: u.login, id: u.id, display_name: u.display_name, url: `https://www.twitch.tv/${u.login}` },
    live: !!s, stream: s ? { title: s.title, game: s.game_name, started_at: s.started_at, viewer_count: s.viewer_count } : null,
    nextScheduled: next, checkedAt: now.toISOString()
  };
} catch (e) {
  console.error(e.message);
  out = { ok: false, live: null, error: e.message, channel: { login: CHANNEL }, checkedAt: now.toISOString() };
}

/* publish only when something visitors care about changed, or for the hourly freshness heartbeat */
const sig = o => JSON.stringify(o && { ok: o.ok, live: o.live, title: o.stream?.title, game: o.stream?.game, next: o.nextScheduled, err: o.error });
const changed = !prev || sig(prev) !== sig(out) || now - new Date(prev.checkedAt) > HEARTBEAT_MS;
console.log(`Channel ${CHANNEL}: ${out.ok ? (out.live ? "LIVE" : "OFFLINE") : "ERROR " + out.error}${changed ? " (publishing)" : " (unchanged)"}`);
if (changed) { fs.mkdirSync("data", { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n"); }
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\nlive=${out.live}\nok=${out.ok}\n`);
