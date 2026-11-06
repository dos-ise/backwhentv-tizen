// BackWhenTV for Samsung Tizen TV (adapted from the Windows app): guide, Internet Archive channels (on the shared clock), live Pluto channels (hls.js), the weather channel,
// and our own bumper clips covering Pluto's looping placeholder. Same rules as the Android app.
const BASE = "https://backwhen.stream";
const VERSION = "1.0";
const $ = (s) => document.querySelector(s);
const v = $("#v"), v2 = $("#v2");
let channels = [], schedules = {}, epg = {}, plutoUrls = {}, plutoAt = 0, anchor = 0;
let tuned = 0, sel = 0, mode = "tv", tuneGen = 0, started = false, hls = null, wxTimer = null;
const totals = {};
const bad = new Set();

const clock = (ms) => { const d = new Date(ms); let h = d.getHours(); const m = d.getMinutes(); const ap = h >= 12 ? "P" : "A"; h = h % 12 || 12; return h + ":" + String(m).padStart(2, "0") + ap; };
const jget = (path) => fetch(BASE + path, { cache: "no-store" }).then((r) => { if (!r.ok) throw new Error(path + " " + r.status); return r.json(); });

/* ---------- schedules (Internet Archive channels loop on a wall clock) ---------- */
function slotAt(ch, nowSec) {
  const s = schedules[ch.id];
  if (!s || !s.items.length) return null;
  if (!totals[ch.id]) totals[ch.id] = s.items.reduce((a, i) => a + i.d, 0);
  const total = totals[ch.id];
  const pos = (((nowSec - (s.anchor || anchor)) % total) + total) % total;
  let acc = 0;
  for (let i = 0; i < s.items.length; i++) {
    const it = s.items[i];
    if (pos < acc + it.d) return { i, it, start: nowSec - (pos - acc), offset: pos - acc };
    acc += it.d;
  }
  return null;
}
const nextOf = (ch, slot) => { const it = schedules[ch.id].items; let i = slot.i; do { i = (i + 1) % it.length; } while (it[i].a && i !== slot.i); return it[i]; }; // skips breaks

function plutoNow(ch, nowSec) {
  const list = epg[ch.pluto];
  if (!list) return null;
  for (let i = 0; i < list.length; i++) if (nowSec >= list[i][0] && nowSec < list[i][1]) return { cur: list[i], next: list[i + 1] };
  return null;
}
function nowLine(ch, nowSec) {
  if (ch.kind === "pluto") {
    const p = plutoNow(ch, nowSec);
    return p ? { t: p.cur[2] + (p.cur[3] ? " - " + p.cur[3] : ""), n: p.next ? p.next[2] : "" } : { t: ch.blurb || "Live", n: "" };
  }
  if (ch.kind === "weather") return { t: "Local forecast", n: "" };
  const slot = slotAt(ch, nowSec);
  return slot ? { t: slot.it.a ? "COMMERCIAL BREAK" : slot.it.t, n: nextOf(ch, slot).t } : { t: "LOADING GUIDE DATA...", n: "" };
}

async function boot() {
  const [lu, all] = await Promise.all([jget("/api/lineup"), jget("/api/schedules?pods=1")]);
  anchor = all.anchor;
  schedules = all.schedules;
  channels = lu.channels.filter((c) => c.kind !== "board" && (c.kind === "pluto" || c.kind === "weather" || schedules[c.id])).sort((a, b) => a.num - b.num);
  jget("/api/epg").then((e) => { epg = e.programs || {}; if (mode === "guide") renderGuide(); }).catch(() => {});
  loadClips();
  const last = localStorage.getItem("bw-last");
  tuned = Math.max(0, channels.findIndex((c) => c.id === last));
  sel = tuned;

  renderGuide();
}

/* ---------- UI bits ---------- */
function showMsg(t) { const m = $("#msg"); m.textContent = t || ""; m.style.display = t ? "flex" : "none"; }
let msgTimer;
function flash(t) { showMsg(t); clearTimeout(msgTimer); msgTimer = setTimeout(() => showMsg(""), 1400); }
let bannerTimer;
function banner() {
  const ch = channels[tuned];
  if (!ch) return;
  const l = nowLine(ch, Date.now() / 1000);
  $("#bnum").textContent = ch.num; $("#bname").textContent = ch.name;
  $("#btitle").textContent = l.t;
  $("#bnext").textContent = l.n ? "NEXT: " + l.n : "";
  $("#bclock").textContent = clock(Date.now());
  $("#banner").classList.add("on");
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => $("#banner").classList.remove("on"), 4500);
}
const loadingOn = (on) => { $("#bars").style.display = on ? "flex" : "none"; };

/* ---------- tuning ---------- */
function stopAll() {
  clearTimeout(podTimer);
  endSwap("tune", true);
  if (hls) { try { hls.destroy(); } catch { /* gone */ } hls = null; }
  clearInterval(wxTimer); wxTimer = null;
  $("#wx").classList.remove("on");
  v.onloadedmetadata = v.onplaying = v.onended = v.onerror = null;
  v.removeAttribute("src"); v.load();
  slate.reset();
}

function tune(idx, showBanner = true) {
  if (!channels.length) return;
  tuned = ((idx % channels.length) + channels.length) % channels.length;
  const ch = channels[tuned], gen = ++tuneGen;
  localStorage.setItem("bw-last", ch.id);
  stopAll();
  showMsg("");
  usage.switchTo(ch.id);
  if (ch.kind === "pluto") playPluto(ch, gen, false);
  else if (ch.kind === "weather") playWeather(ch, gen);
  else playSlot(ch, gen, 0);
  if (showBanner) banner();
  renderGuide();
}

function playSlot(ch, gen, skip) {
  const slot = slotAt(ch, Date.now() / 1000);
  if (!slot) { loadingOn(false); return showMsg("NO SIGNAL"); }
  if (slot.it.a && allClips.length) return playPod(ch, gen, slot);
  prefetchPod(ch, slot);
  const s = schedules[ch.id];
  let it = slot.it, offset = slot.offset;
  for (let k = 0; k < skip + s.items.length && bad.has(it.u + (it._fb ? "#f" : "")); k++) { // skip broken files; start the next show from the top
    it = s.items[(slot.i + 1 + k) % s.items.length]; offset = 0;
  }
  loadingOn(true);
  const src = it._fb && it.f ? it.f : it.u;
  v.onloadedmetadata = () => { if (gen === tuneGen && offset > 1 && offset < (v.duration || 1e9)) v.currentTime = offset; };
  v.onplaying = () => { if (gen === tuneGen) loadingOn(false); };
  v.onended = () => { if (gen === tuneGen) playSlot(ch, gen, 0); };
  v.onerror = () => {
    if (gen !== tuneGen) return;
    if (it.f && !it._fb) { it._fb = true; playSlot(ch, gen, 0); } // storage server moved? try archive.org's own link
    else { bad.add(it.u + (it._fb ? "#f" : "")); loadingOn(false); showMsg("NO SIGNAL"); setTimeout(() => { if (gen === tuneGen) { showMsg(""); playSlot(ch, gen, 1); } }, 1500); }
  };
  v.src = src;
  v.play().catch(() => {});
}

/* ---------- Pluto (live) ---------- */
async function plutoUrl(id, force) {
  if (force || !plutoUrls[id] || Date.now() - plutoAt > 20 * 60000) {
    plutoUrls = (await jget("/api/pluto")).urls || {};
    plutoAt = Date.now();
  }
  if (!plutoUrls[id]) throw new Error("no stream");
  return plutoUrls[id];
}
async function playPluto(ch, gen, retried) {
  loadingOn(true);
  try {
    const url = await plutoUrl(ch.pluto, retried);
    if (gen !== tuneGen) return;
    if (!Hls.isSupported()) throw new Error("no hls");
    hls = new Hls({ liveSyncDurationCount: 3, maxBufferLength: 30, backBufferLength: 20, manifestLoadingMaxRetry: 2, levelLoadingMaxRetry: 3, fragLoadingMaxRetry: 4 });
    hls.on(Hls.Events.LEVEL_UPDATED, (e, d) => slate.check(ch, d.details));
    hls.on(Hls.Events.ERROR, (e, d) => {
      if (!d.fatal || gen !== tuneGen) return;
      if (!retried) { stopAll(); playPluto(ch, gen, true); } // the link may have rotated: fetch a fresh one once
      else { loadingOn(false); showMsg("NO SIGNAL"); }
    });
    v.onplaying = () => { if (gen === tuneGen) loadingOn(false); };
    hls.loadSource(url);
    hls.attachMedia(v);
    v.play().catch(() => {});
  } catch {
    if (gen !== tuneGen) return;
    loadingOn(false); showMsg("NO SIGNAL");
  }
}


/* ---------- commercial breaks between episodes ---------- */
// A pod slot (item flagged a:1) is filled with: a sponsor spot (paid sponsor if there is one, else our own "your ad here"), a trivia card,
// and a donate/sponsor ask, with stingers up front to fill the time. Everything is chosen from the pod's start time, so every viewer sees the same break.
function podRng(seed) {
  let a = 2166136261;
  for (const ch of String(seed)) a = Math.imul(a ^ ch.charCodeAt(0), 16777619) >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function podPlan(chId, startSec, total) {
  const of = (type) => allClips.filter((c) => c.type === type);
  const rand = podRng(chId + ":" + startSec);
  const pick = (arr) => (arr.length ? arr[Math.floor(rand() * arr.length)] : null);
  const sponsored = of("sponsored"), house = of("sponsor");
  const spots = [
    pick(sponsored.length ? sponsored : house),
    pick(of("trivia")),
    sponsored.length && rand() < 0.5 ? pick(house) : pick(of("donate")),
  ].filter(Boolean);
  let fill = total - spots.reduce((a, c) => a + c.dur, 0);
  const stingers = of("stinger").sort((a, b) => b.dur - a.dur);
  const lead = [];
  for (const s of stingers) while (fill >= s.dur - 0.01 && fill >= 2 && lead.length < 4) { lead.push(s); fill -= s.dur; }
  return lead.concat(spots);
}
const warmed = new Set();
function prefetchPod(ch, slot) {
  const items = schedules[ch.id].items, nx = items[(slot.i + 1) % items.length];
  if (!nx || !nx.a || !allClips.length) return;
  const start = Math.round(slot.start + slot.it.d);
  const key = ch.id + ":" + start;
  if (warmed.has(key)) return;
  warmed.add(key);
  for (const c of podPlan(ch.id, start, nx.d)) fetch(c.url).catch(() => {});
}
let podTimer = null;
function playPod(ch, gen, slot) {
  const plan = podPlan(ch.id, Math.round(slot.start), slot.it.d);
  let acc = 0, idx = 0;
  for (; idx < plan.length; idx++) { if (slot.offset < acc + plan[idx].dur) break; acc += plan[idx].dur; }
  clearTimeout(podTimer);
  podTimer = setTimeout(() => { if (gen === tuneGen) playSlot(ch, gen, 0); }, Math.max(300, (slot.it.d - slot.offset) * 1000 + 250)); // then straight into the next episode
  if (idx >= plan.length) return;
  const go = (i, off) => {
    if (gen !== tuneGen) return;
    v.onloadedmetadata = () => { if (gen === tuneGen && off > 0.5) v.currentTime = off; };
    v.onplaying = () => { if (gen === tuneGen) loadingOn(false); };
    v.onended = () => { if (i + 1 < plan.length) go(i + 1, 0); };
    v.onerror = () => { if (i + 1 < plan.length) go(i + 1, 0); };
    v.src = plan[i].url;
    v.play().catch(() => {});
  };
  loadingOn(false);
  go(idx, slot.offset - acc);
}

/* ---------- weather channel: our own screens over the smooth-jazz audio ---------- */
let wxData = null, wxExtra = null, wxPage = 0;
async function playWeather(ch, gen) {
  loadingOn(false);
  $("#wx").classList.add("on");
  $("#wxbody").textContent = "";
  playSlot({ id: "ia-retro-weather", kind: "ia" }, gen, 0); // the music
  loadingOn(false);
  try { [wxData, wxExtra] = await Promise.all([jget("/api/weather"), jget("/api/weather/extra").catch(() => null)]); } catch { /* keep going without */ }
  wxPage = 0;
  drawWx();
  wxTimer = setInterval(() => { wxPage++; drawWx(); }, 11000);
}
function wxPages() {
  const d = wxData, x = wxExtra;
  if (!d) return [() => ["LOCAL FORECAST", `<div class="sm">Getting the forecast...</div>`]];
  const p = d.periods || [];
  const pages = [
    () => ["CURRENT CONDITIONS", `<div class="big">${d.now.tempF}&deg;</div><div>${d.now.text}</div><div class="sm">Wind ${d.now.windDir || ""} ${d.now.windMph} mph &nbsp;|&nbsp; Humidity ${d.now.humidity != null ? d.now.humidity : "--"}% &nbsp;|&nbsp; Pressure ${d.now.pressureIn != null ? d.now.pressureIn : "--"} in &nbsp;|&nbsp; Visibility ${d.now.visibilityMi != null ? d.now.visibilityMi : "--"} mi</div><div class="sm">${d.city}, ${d.state}</div>`],
    () => ["LOCAL FORECAST", p.slice(0, 3).map((q) => `<div><span style="color:var(--yellow)">${q.name.toUpperCase()}</span><div class="sm">${q.detail}</div></div>`).join("")],
    () => ["EXTENDED FORECAST", p.slice(0, 8).map((q) => `<div class="row2"><span>${q.name.toUpperCase()}</span><span>${q.short}</span><span>${q.tempF}&deg;</span></div>`).join("")],
  ];
  if (x && x.cities && x.cities.length) pages.push(() => ["AROUND THE REGION", x.cities.slice(0, 8).map((c) => `<div class="row2"><span>${c.name.toUpperCase()}</span><span>${c.text}</span><span>${c.tempF}&deg; &nbsp; ${c.hi}/${c.lo}</span></div>`).join("")]);
  if (x && x.radar && x.radar.loop) pages.push(() => ["REGIONAL RADAR", `<img src="${x.radar.loop}" alt="radar">`]);
  if (x) pages.push(() => {
    const al = x.alerts || [];
    if (al.length) return ["WEATHER ALERTS", al.slice(0, 2).map((a) => `<div><span style="color:#ff6b6b">${(a.event || "ALERT").toUpperCase()}</span><div class="sm">${a.headline || ""}</div></div>`).join("")];
    const b = x.briefing;
    return [b && b.title ? "FORECAST DISCUSSION" : "WEATHER ALERTS", b && b.text ? `<div class="sm">${b.text}</div>` : `<div>NO ACTIVE ALERTS</div>`];
  });
  return pages;
}
function drawWx() {
  const pages = wxPages();
  const [title, html] = pages[wxPage % pages.length]();
  $("#wxtitle").textContent = title;
  $("#wxbody").innerHTML = html;
  $("#wxpage").textContent = `PAGE ${(wxPage % pages.length) + 1} OF ${pages.length}`;
  $("#wxclock").textContent = clock(Date.now());
}

/* ---------- our bumper clips over Pluto's looping placeholder ---------- */
let allClips = [];
async function loadClips() {
  try {
    const m = await jget("/clips/manifest.json");
    allClips = m.clips.map((c) => ({ id: c.id, type: c.type, dur: c.dur, url: BASE + "/clips/" + c.file }));
    allClips.forEach((c) => fetch(c.url).catch(() => {})); // warm the cache so a swap starts instantly
  } catch { allClips = []; }
}
function plan(seconds, used) {
  const cands = [];
  const clips = allClips.filter((c) => c.type !== "sponsor" || Math.random() < 0.1); // the "advertise here" house ad turns up about one break in four (0.1 per pick, three picks per break)
  const consider = (c) => {
    const diff = Math.abs(c.reduce((a, x) => a + x.dur, 0) - seconds);
    const reps = c.filter((x) => used.some((u) => u.id === x.id)).length;
    cands.push([diff + 0.4 * c.length + 6 * reps, c]);
  };
  for (const a of clips) { consider([a]); for (const b of clips) if (b !== a) { consider([a, b]); for (const c of clips) if (c !== a && c !== b) consider([a, b, c]); } }
  if (!cands.length) return [];
  const best = Math.min(...cands.map((x) => x[0]));
  const pool = cands.filter((x) => x[0] <= best + 2.5);
  const pick = pool[Math.floor(Math.random() * pool.length)][1].slice();
  for (let i = pick.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pick[i], pick[j]] = [pick[j], pick[i]]; }
  return pick; // nearly-best combinations are all fair game, in random order, so breaks vary
}

let swapActive = false, swapCap = null, swapCooldown = 0;
const slate = {
  sn: -1, asset: null, cc: -1, runSec: 0, prevRunSec: 0,
  reset() { this.sn = -1; this.asset = null; this.cc = -1; this.runSec = 0; this.prevRunSec = 0; },
  check(ch, details) {
    if (!details || !details.fragments) return;
    for (const f of details.fragments) {
      if (f.sn <= this.sn) continue; // only segments we have not seen
      this.sn = f.sn;
      const url = f.url || "";
      const a = url.indexOf("/clip/");
      const asset = a >= 0 ? url.slice(a + 6).split("/")[0] : url.includes("/sign/") ? "AD" : "OTHER";
      if (asset === this.asset && f.cc === this.cc) { this.runSec += f.duration; continue; } // still the same run of the same clip
      const placeholder = /ptv[_-]/i.test(asset);
      const prev = this.runSec;
      if (asset === this.asset && placeholder && f.cc > this.cc) { // the same Pluto placeholder starting again right after itself: a slate
        if (!swapActive && performance.now() >= swapCooldown) startSwap(Math.min(Math.max(prev, 2), 45));
      } else if (swapActive && !placeholder) {
        endSwap("real content");
      }
      this.asset = asset; this.cc = f.cc; this.runSec = f.duration;
    }
  },
};

function startSwap(loopSec) {
  if (!allClips.length || !hls) return;
  swapActive = true;
  loadingOn(false); showMsg("");
  const used = [], queue = [];
  for (let i = 0; i < 3; i++) { const p = plan(loopSec, used); queue.push(...p); used.push(...p); }
  v.pause();
  v.muted = true;
  v2.style.display = "block";
  v2.volume = v.volume;
  let n = 0;
  const next = () => { if (!swapActive) return; if (n >= queue.length) return endSwap("clips done"); v2.src = queue[n++].url; v2.play().catch(() => endSwap("clip error")); };
  v2.onended = next;
  v2.onerror = () => endSwap("clip error");
  next();
  clearTimeout(swapCap);
  swapCap = setTimeout(() => endSwap("90 s cap"), 90000);
  console.log("swap started, loop", loopSec.toFixed(1), "s,", queue.map((c) => c.id).join(","));
}
function endSwap(why, quiet) {
  if (!swapActive) return;
  swapActive = false;
  clearTimeout(swapCap);
  v2.onended = v2.onerror = null;
  v2.pause(); v2.removeAttribute("src"); v2.load(); v2.style.display = "none";
  swapCooldown = performance.now() + 20000;
  v.muted = muted;
  if (!quiet && hls) {
    try { hls.startLoad(-1); } catch { /* ignore */ }
    if (hls.liveSyncPosition) v.currentTime = hls.liveSyncPosition; // back to Pluto's live edge
    v.play().catch(() => {});
  }
  console.log("swap ended:", why);
}

/* ---------- anonymous usage: random id, version, minutes per channel ---------- */
const usage = (() => {
  let id = localStorage.getItem("bw-id");
  if (!id) { id = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join(""); localStorage.setItem("bw-id", id); }
  const watched = {};
  let cur = null, since = 0;
  const flushCur = () => { if (cur && started) { const m = Math.round((Date.now() - since) / 60000); if (m > 0) { watched[cur] = (watched[cur] || 0) + m; since += m * 60000; } } };
  setInterval(() => {
    flushCur();
    const body = JSON.stringify({ id, p: "windows", v: VERSION, w: watched });
    fetch(BASE + "/api/ev", { method: "POST", headers: { "Content-Type": "application/json" }, body }).then(() => { for (const k of Object.keys(watched)) delete watched[k]; }).catch(() => {});
  }, 5 * 60000);
  return { switchTo(c) { flushCur(); cur = c; since = Date.now(); } };
})();

/* ---------- guide ---------- */
function renderGuide() {
  const rows = $("#rows");
  if (!rows) return;
  const per = Math.max(5, Math.floor((window.innerHeight * 0.80) / (window.innerHeight * 0.084)));
  const top = Math.min(Math.max(0, sel - Math.floor(per / 2)), Math.max(0, channels.length - per));
  rows.innerHTML = "";
  const now = Date.now() / 1000;
  for (let i = top; i < Math.min(channels.length, top + per); i++) {
    const ch = channels[i], l = nowLine(ch, now);
    const r = document.createElement("div");
    r.className = "row" + (i === sel ? " sel" : "");
    r.innerHTML = `<b>${ch.num}</b><span class="n"></span><span class="t"></span>`;
    r.querySelector(".n").textContent = ch.name;
    const t = r.querySelector(".t");
    t.textContent = l.t;
    if (l.n) { const n = document.createElement("i"); n.textContent = "next: " + l.n; t.append(n); }
    r.onclick = () => { sel = i; tune(i); setMode("tv"); };
    rows.append(r);
  }
  $("#gclock").textContent = new Date().toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" }).toUpperCase() + "  " + clock(Date.now());
}
function setMode(m) {
  mode = m;
  $("#guide").classList.toggle("on", m === "guide");
  if (m === "guide") { sel = tuned; renderGuide(); $("#banner").classList.remove("on"); }
}

/* ---------- number entry ---------- */
let digits = "", digitTimer;
function typeDigit(d) {
  if (digits.length >= 3) digits = "";
  digits += d;
  const el = $("#digits"); el.textContent = digits; el.style.display = "block";
  clearTimeout(digitTimer);
  digitTimer = setTimeout(() => {
    const n = +digits; digits = ""; el.style.display = "none";
    const i = channels.findIndex((c) => c.num === n);
    if (i >= 0) { sel = i; tune(i); if (mode === "guide") setMode("tv"); }
  }, digits.length >= 2 ? 700 : 1800);
}

/* ---------- volume ---------- */
let muted = false;
function setVol(dv) {
  v.volume = Math.min(1, Math.max(0, v.volume + dv)); v2.volume = v.volume;
  localStorage.setItem("bw-vol", String(v.volume));
  flash("VOLUME " + Math.round(v.volume * 100));
}
function toggleMute() { muted = !muted; v.muted = muted || swapActive; v2.muted = muted; flash(muted ? "MUTE" : "VOLUME " + Math.round(v.volume * 100)); }
v.volume = +(localStorage.getItem("bw-vol") || 0.8);

/* ---------- input (remote control only) ---------- */
function begin() {
  if (started || !channels.length) return;
  started = true;
  tune(tuned, true);
}
addEventListener("keydown", (e) => {
  if (!channels.length) return;
  const g = mode === "guide", k = window.remoteKey ? window.remoteKey(e) : e.key;
  if (/^[0-9]$/.test(k)) typeDigit(k);
  else if (k === "ArrowUp" || k === "PageUp") g ? (sel = (sel - 1 + channels.length) % channels.length, renderGuide()) : tune(tuned + 1);
  else if (k === "ArrowDown" || k === "PageDown") g ? (sel = (sel + 1) % channels.length, renderGuide()) : tune(tuned - 1);
  else if (k === "ArrowLeft") g ? (sel = Math.max(0, sel - 6), renderGuide()) : setVol(-0.05);
  else if (k === "ArrowRight") g ? (sel = Math.min(channels.length - 1, sel + 6), renderGuide()) : setVol(0.05);
  else if (k === "Enter") { if (g) { tune(sel); setMode("tv"); } else setMode("guide"); }
  else if (k === "g") setMode(g ? "tv" : "guide");
  else if (k === "i") banner();
  else if (k === "m") toggleMute();
  else if (k === "Escape") { if (g) setMode("tv"); else if (window.exitApp) window.exitApp(); }
  else return;
  e.preventDefault();
});
setInterval(() => { if (mode === "guide") renderGuide(); }, 15000);
addEventListener("resize", () => mode === "guide" && renderGuide());

function bootRetry() {
  boot().then(begin).catch(() => { showMsg("NO SIGNAL - CHECK YOUR INTERNET"); setTimeout(bootRetry, 8000); });
}
bootRetry();