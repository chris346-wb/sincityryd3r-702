/* SinCityRyd3r_702: smart stream countdown and live status (front end).
   Not active on the live site yet: it will be added once the Netlify function returns Chris's real Twitch status.
   One shared controller polls /api/twitch-status and drives every [data-stream-status] block on the page,
   so the homepage version and the Schedule page version can never disagree. All times are Las Vegas time. */
(function(){
  const CFG = {
    api: "data/stream-status.json",   // written by the GitHub Actions workflow from the official Twitch API
    staleAfterMs: 70 * 60000,          // the workflow republishes at least every 30 min; older than this means checks have stopped
    twitchUrl: "https://www.twitch.tv/SinCityRyd3r_702",
    tz: "America/Los_Angeles",
    /* Chris's usual habits, not appointments. Shown only as clearly labelled ESTIMATES, and only when his
       Twitch schedule has nothing confirmed. Edit these to change the estimates; nothing else needs to change.
       day: 0 = Sunday ... 6 = Saturday, start: Las Vegas time (24 h). */
    estimates: {
      enabled: true,
      windows: [
        { days: [1,2,3,4,5], start: "18:00", note: "Weekday evening" },
        { days: [6],         start: "18:00", note: "Saturday night, often a longer stream" }
        /* Sundays are only "sometimes", so no Sunday countdown is estimated. Add { days:[0], start:"18:00" } to include them. */
      ],
      lateGraceHours: 6          // after an estimated start passes, show "getting ready" this long before moving on
    },
    confirmedGraceHours: 3,      // same, for a confirmed Twitch schedule slot without an end time
    pollMs: 60000, pollFastMs: 30000
  };

  /* ---------- Las Vegas time helpers (DST handled by Intl) ---------- */
  const partsIn = (date, tz) => Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" }).formatToParts(date).map(p => [p.type, p.value]));
  function zonedToUtc(y, mo, d, h, mi, tz){
    let guess = Date.UTC(y, mo - 1, d, h, mi);
    for (let i = 0; i < 3; i++){ const p = partsIn(new Date(guess), tz); const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute); guess += Date.UTC(y, mo - 1, d, h, mi) - asUtc; }
    return guess;
  }
  const WD = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
  function estimateStarts(now){            // every estimated start from yesterday to 8 days ahead, Las Vegas time
    const out = [];
    for (let k = -1; k <= 8; k++){
      const p = partsIn(new Date(now + k * 86400000), CFG.tz), dow = WD[p.weekday];
      for (const w of CFG.estimates.windows){ if (!w.days.includes(dow)) continue;
        const [h, m] = w.start.split(":").map(Number);
        out.push({ t: zonedToUtc(+p.year, +p.month, +p.day, h, m, CFG.tz), note: w.note, kind: "estimate" }); }
    }
    return out.sort((a, b) => a.t - b.t);
  }
  const fmtVegas = (t, withDay = true) => new Intl.DateTimeFormat("en-US", { timeZone: CFG.tz, weekday: withDay ? "long" : undefined, hour: "numeric", minute: "2-digit" }).format(new Date(t));
  const tzLabel = t => (new Intl.DateTimeFormat("en-US", { timeZone: CFG.tz, timeZoneName: "short" }).formatToParts(new Date(t)).find(p => p.type === "timeZoneName") || {}).value || "PT";

  /* ---------- decide what to show ---------- */
  function decide(status, now){
    const stale = status && status.checkedAt && now - new Date(status.checkedAt).getTime() > CFG.staleAfterMs;
    if (status && status.live === true && !stale) return { state: "live", stream: status.stream };
    const unknown = !status || stale || status.live === null || status.ok === false;
    /* 1. a confirmed slot from his Twitch schedule */
    const ns = status && status.nextScheduled;
    if (ns){ const s = new Date(ns.start).getTime(), e = ns.end ? new Date(ns.end).getTime() : s + CFG.confirmedGraceHours * 3600000;
      if (now < s) return { state: "countdown", target: s, kind: "confirmed", title: ns.title, category: ns.category, unknown };
      if (now < e) return { state: "late", target: s, kind: "confirmed", unknown }; }
    /* 2. an estimate from his usual habits */
    if (CFG.estimates.enabled){
      const grace = CFG.estimates.lateGraceHours * 3600000;
      for (const e of estimateStarts(now)){
        if (now >= e.t && now < e.t + grace) return { state: "late", target: e.t, kind: "estimate", unknown };
        if (now < e.t) return { state: "countdown", target: e.t, kind: "estimate", note: e.note, unknown };
      }
    }
    return { state: "none", unknown };
  }

  /* ---------- render ---------- */
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));
  const tw = (label, cls = "") => `<a class="btn btn-p ssc-btn ${cls}" href="${CFG.twitchUrl}" target="_blank" rel="noopener">${label}</a>`;
  function html(d, big){
    if (d.state === "live"){
      const s = d.stream || {};
      return `<div class="ssc-live"><span class="ssc-badge"><i></i>Live now</span>
        <h3 class="ssc-h">We're live, Sin Squad!</h3>
        <p class="ssc-p">Chris is live right now! Come join the action.</p>
        ${big && (s.title || s.game) ? `<p class="ssc-meta">${esc(s.title || "")}${s.game ? ` <span>&middot; ${esc(s.game)}</span>` : ""}</p>` : ""}
        ${tw("Watch live", "ssc-cta-live")}</div>`;
    }
    if (d.state === "countdown"){
      const tag = d.kind === "confirmed" ? `<span class="ssc-tag ok">From Chris's Twitch schedule</span>` : `<span class="ssc-tag est">Estimate based on Chris's usual streaming times</span>`;
      return `<div class="ssc-count"><span class="ssc-kicker">${d.kind === "confirmed" ? "Next stream" : "Next expected stream"}</span>
        <h3 class="ssc-h">${esc(fmtVegas(d.target))} <small>${tzLabel(d.target)}, Las Vegas time</small></h3>
        ${d.title && big ? `<p class="ssc-meta">${esc(d.title)}${d.category ? ` <span>&middot; ${esc(d.category)}</span>` : ""}</p>` : ""}
        <div class="ssc-clock" data-to="${d.target}" role="timer" aria-live="off">${["Days","Hours","Mins","Secs"].map(l => `<div><b>00</b><small>${l}</small></div>`).join("")}</div>
        ${tag}${d.unknown ? `<p class="ssc-note">Live status is temporarily unavailable. Twitch always has the latest.</p>` : ""}
        <div class="ssc-actions">${tw("Follow on Twitch")}</div></div>`;
    }
    if (d.state === "late"){
      return `<div class="ssc-late"><span class="ssc-kicker">${d.kind === "confirmed" ? "Scheduled for " : "Usually starts around "}${esc(fmtVegas(d.target, false))} ${tzLabel(d.target)}</span>
        <h3 class="ssc-h">Chris is getting ready!</h3>
        <p class="ssc-p">Sometimes life gets busy. Chris might be running a little behind, but keep the good vibes going. We'll let you know when he goes live!</p>
        ${d.unknown ? `<p class="ssc-note">Live status is temporarily unavailable. Twitch always has the latest.</p>` : ""}
        <div class="ssc-actions">${tw("Follow on Twitch")}</div></div>`;
    }
    return `<div class="ssc-none"><h3 class="ssc-h">Stay close, Sin Squad!</h3>
      <p class="ssc-p">Follow Chris on Twitch so you don't miss the next stream.</p>
      ${d.unknown ? `<p class="ssc-note">Live status is temporarily unavailable. Twitch always has the latest.</p>` : ""}
      <div class="ssc-actions">${tw("Follow on Twitch")}</div></div>`;
  }

  /* ---------- one shared controller ---------- */
  let status = null, lastKey = "", timer = 0, tick = 0;
  const now = () => (window.__SSC_NOW__ ? window.__SSC_NOW__() : Date.now());   // test hook, unused on the live site
  function paint(force){
    const d = decide(status, now()), key = d.state + ":" + (d.target || "") + ":" + (d.kind || "") + ":" + !!d.unknown + ":" + (d.stream ? d.stream.title : "");
    if (!force && key === lastKey) return;
    lastKey = key;
    document.querySelectorAll("[data-stream-status]").forEach(el => {
      el.dataset.state = d.state;
      const box = el.querySelector(".ssc-body"); if (!box) return;
      box.classList.add("ssc-swap");
      setTimeout(() => { box.innerHTML = html(d, el.dataset.size === "large"); box.classList.remove("ssc-swap"); runClock(); }, force ? 0 : 260);
    });
  }
  function runClock(){
    clearInterval(tick);
    const clocks = document.querySelectorAll("[data-stream-status] .ssc-clock"); if (!clocks.length) return;
    const step = () => { const n = now(); let ended = false;
      clocks.forEach(c => { let s = Math.max(0, (+c.dataset.to - n) / 1000); if (s <= 0) ended = true;
        const v = [Math.floor(s / 86400), Math.floor(s % 86400 / 3600), Math.floor(s % 3600 / 60), Math.floor(s % 60)];
        c.querySelectorAll("b").forEach((b, i) => { const t = String(v[i]).padStart(2, "0"); if (b.textContent !== t) b.textContent = t; }); });
      if (ended){ clearInterval(tick); paint(false); poll(); } };
    step(); tick = setInterval(step, 1000);
  }
  async function poll(){
    clearTimeout(timer);
    try {
      const r = await fetch(CFG.api + "?t=" + Date.now(), { cache: "no-store", headers: { Accept: "application/json" } });
      const j = await r.json().catch(() => null);
      status = j && typeof j === "object" ? j : { ok: false, live: null };
    } catch { status = { ok: false, live: null }; }
    paint(false);
    const d = decide(status, now());
    const soon = d.state === "late" || d.state === "live" || (d.target && d.target - now() < 30 * 60000);
    if (!document.hidden) timer = setTimeout(poll, soon ? CFG.pollFastMs : CFG.pollMs);
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
  window.SSC = { start(){ paint(true); poll(); }, refresh: poll, decide, estimateStarts, zonedToUtc, CFG, _set(s){ status = s; paint(true); } };
})();
