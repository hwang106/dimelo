import { el, $, shuffle, toast, REG_LABEL } from "./ui.js";
import * as store from "./store.js";
import * as P from "./progress.js";
import * as audio from "./audio.js";
import { SECTIONS, UNITS, DIALOGUES, ALL_ITEMS } from "./content.js";
import { runLesson, lessonQueue, practiceQueue, unitReviewQueue, dueCount, customItems } from "./lesson.js";
import { runDialogue } from "./dialogue.js";
import { renderClips } from "./clips.js";
import { renderPartner } from "./partner.js";
import { strength } from "./srs.js";
import { startSync } from "./appsync.js";
import { RESEARCH } from "./research.js";

const view = $("#view");
let tab = "learn";
try { tab = sessionStorage.getItem("dimelo-tab") || "learn"; } catch (_) {}

// ---------- top bar ----------
function renderTop() {
  const st = P.streak(), t = P.dayTotals()[store.today()] || { xp: 0 }, goal = store.settings().goal;
  const pct = Math.min(1, t.xp / goal);
  $("#streak").textContent = st.n; $("#streak").parentElement.classList.toggle("lit", st.today);
  $("#streak").parentElement.title = st.today ? `${st.n}-day streak` : `Do a lesson today to keep your ${st.n}-day streak`;
  $("#cheles").textContent = P.cheles();
  $("#goalring").style.setProperty("--p", pct);
  $("#goaltxt").textContent = `${Math.min(t.xp, goal)}/${goal}`;
  $("#goalring").parentElement.title = `Daily goal: ${t.xp} of ${goal} XP`;
}

// ---------- tabs ----------
function show(name) {
  tab = name; try { sessionStorage.setItem("dimelo-tab", name); } catch (_) {}
  document.querySelectorAll("nav.tabs button").forEach(b => b.setAttribute("aria-current", b.dataset.tab === name ? "page" : "false"));
  audio.stop();
  ({ learn: renderLearn, practice: renderPractice, clips: () => renderClips(view), partner: () => renderPartner(view), me: renderMe })[name]();
  renderTop();
  window.scrollTo(0, 0);
}
document.querySelectorAll("nav.tabs button").forEach(b => (b.onclick = () => show(b.dataset.tab)));

const after = () => { renderTop(); show(tab); };

// ---------- learn (the path) ----------
function nodeIcon(kind, done) { return done ? "✓" : kind === "dialogue" ? "💬" : kind === "review" ? "🏆" : "★"; }
function renderLearn() {
  const cur = P.currentNode(DIALOGUES);
  const out = [];
  for (const sec of SECTIONS) {
    const units = UNITS.filter(u => u.section === sec.id);
    out.push(el("div", { class: "section-head", style: { "--c": sec.color } }, el("h2", {}, sec.title), el("small", {}, sec.sub)));
    for (const u of units) {
      const nodes = P.nodesOf(u, !!DIALOGUES[u.id]);
      const prog = P.unitProgress(u, !!DIALOGUES[u.id]);
      out.push(el("div", { class: "unit-banner", style: { "--c": sec.color } },
        el("div", {}, el("b", {}, u.title), el("small", {}, u.goal)),
        el("button", { class: "guide", "aria-label": "Guide for " + u.title, onclick: () => guide(u) }, "📖"),
        el("div", { class: "unit-prog" }, el("i", { style: { width: (100 * prog.done / prog.total) + "%" } }))));
      const path = el("div", { class: "path" });
      nodes.forEach((nd, k) => {
        const done = P.lessonDone(u.id, nd.n), open = P.isUnlocked(u.id, nd.n, DIALOGUES);
        const isCur = cur && cur.unit === u.id && cur.n === nd.n;
        const off = [0, 1, 1.6, 1, 0, -1, -1.6, -1][k % 8];
        const label = nd.kind === "lesson" ? `Lesson ${nd.n + 1}` : nd.kind === "dialogue" ? "Role-play" : "Unit review";
        const b = el("button", { class: `node k-${nd.kind}${done ? " done" : ""}${open ? "" : " locked"}${isCur ? " current" : ""}`, style: { "--c": sec.color, "--x": off },
          "aria-label": `${u.title}: ${label}${done ? " (done)" : open ? "" : " (locked)"}`,
          onclick: () => open ? startNode(u, nd) : toast("Finish the lessons before this one first (or turn on Unlock everything in Me → Settings).") },
          open ? nodeIcon(nd.kind, done) : "🔒");
        path.append(el("div", { class: "node-wrap", style: { "--x": off } }, isCur ? el("div", { class: "start-bubble" }, "EMPIEZA") : null, b));
      });
      out.push(path);
    }
  }
  view.replaceChildren(...out);
  const c = $(".node.current"); if (c) setTimeout(() => c.scrollIntoView({ block: "center", behavior: "smooth" }), 60);
}
function guide(u) {
  const d = el("dialog", { class: "sheet" },
    el("h2", {}, u.title), el("p", {}, u.tip),
    el("div", { class: "phrase-list" }, ...u.items.map(it => phraseRow(it))),
    el("button", { class: "btn go", onclick: () => d.close() }, "Close"));
  d.onclose = () => d.remove();
  document.body.append(d); d.showModal();
}
function phraseRow(it) {
  const c = P.card(it.id, "rec"), s = strength(c);
  return el("div", { class: "phrase" },
    el("button", { class: "icon-btn", "aria-label": "Play", onclick: () => audio.play(it.id, it.fast, { rate: store.settings().speed }) }, "🔊"),
    el("div", {}, el("b", {}, it.fast), it.fast !== it.es ? el("small", { class: "es" }, it.es) : null, el("small", {}, it.en),
      it.reg ? el("span", { class: "badge reg-" + it.reg }, REG_LABEL[it.reg]) : null),
    el("span", { class: "meter s" + s, title: ["new", "learning", "familiar", "strong"][s] }, el("i"), el("i"), el("i")));
}
function startNode(u, nd) {
  const vul = store.settings().showVulgar;
  if (nd.kind === "dialogue") return runDialogue(DIALOGUES[u.id], { onDone: async r => { if (!r.quit) await P.finishLesson(u.id, nd.n, r.wrong ? 80 : 100); after(); } });
  let queue;
  if (nd.kind === "review") queue = unitReviewQueue({ ...u, items: u.items.filter(i => vul || !i.reg || i.reg === "inf").map(i => ({ ...i, unit: u.id })) });
  else {
    const items = nd.items.filter(i => vul || !i.reg || i.reg === "inf").map(i => ({ ...i, unit: u.id, section: u.section }));
    queue = lessonQueue(items);
    const reviews = practiceQueue(3).filter(x => !items.some(i => i.id === x.it.id));
    const firstRound = items.length * 2;
    for (const r of reviews) queue.splice(firstRound + Math.floor(Math.random() * (queue.length - firstRound + 1)), 0, r);
  }
  runLesson({ title: u.title, queue, bonus: nd.kind === "review" ? 15 : 10, onDone: async r => { if (!r.quit) await P.finishLesson(u.id, nd.n, Math.round(100 * r.correct / Math.max(1, r.correct + r.wrong))); after(); } });
}

// ---------- practice ----------
function renderPractice() {
  const due = dueCount(), learned = P.stats().learned;
  const search = el("input", { type: "search", placeholder: "Search phrases (Spanish or English)", "aria-label": "Search phrases" });
  const list = el("div", { class: "phrase-list" });
  const all = ALL_ITEMS.concat(customItems());
  const fill = () => {
    const q = search.value.trim().toLowerCase();
    const vul = store.settings().showVulgar;
    const hits = all.filter(i => (vul || !i.reg || i.reg === "inf") && (!q || (i.es + " " + i.fast + " " + i.en).toLowerCase().includes(q)) && (q || P.card(i.id, "rec")));
    list.replaceChildren(...(hits.length ? hits.slice(0, 80).map(phraseRow) : [el("p", { class: "muted" }, q ? "No matches." : "Phrases you've learned show up here.")]));
  };
  search.oninput = fill;
  view.replaceChildren(
    el("h1", {}, "Practice"),
    el("button", { class: "big-card blue", disabled: !learned, onclick: () => runLesson({ title: "Repaso", queue: practiceQueue(12), onDone: after }) },
      el("span", { class: "emoji" }, "🧠"), el("div", {}, el("b", {}, "Daily review"), el("small", {}, learned ? `${due} phrase${due === 1 ? "" : "s"} due · spaced repetition picks what you're about to forget` : "Finish a lesson first"))),
    el("button", { class: "big-card orange", disabled: learned < 4, onclick: () => runLesson({ title: "Contra reloj", queue: practiceQueue(10).map(x => ({ ...x, type: "hear-meaning", skill: "rec" })), timed: 60, bonus: 0, onDone: after }) },
      el("span", { class: "emoji" }, "⏱️"), el("div", {}, el("b", {}, "Contra reloj"), el("small", {}, "60 seconds of fast listening. How many can you catch?"))),
    el("button", { class: "big-card green", disabled: learned < 4, onclick: () => runLesson({ title: "Habla", queue: shuffle(practiceQueue(30).filter(x => x.it.say)).slice(0, 8).map(x => ({ ...x, type: audio.canListen ? "speak" : "build", skill: "pro" })), onDone: after }) },
      el("span", { class: "emoji" }, "🗣️"), el("div", {}, el("b", {}, "Speaking drill"), el("small", {}, audio.canListen ? "Say the things you'll need on calls and with newcomers" : "Speech recognition needs Chrome or Edge; this uses word tiles instead"))),
    el("h2", {}, "Phrasebook"), search, list);
  fill();
}

// ---------- me ----------
function renderMe() {
  const s = store.settings(), lv = P.level(), st = P.streak(), lg = P.league();
  const goalSel = el("select", { "aria-label": "Daily goal", onchange: async e => { await store.saveSettings({ goal: +e.target.value }); renderTop(); } },
    ...[[20, "Casual · ~6 min"], [30, "Regular · ~10 min"], [50, "Serious · ~15 min"], [80, "Intense · ~25 min"]].map(([v, l]) => el("option", { value: v, selected: v === s.goal }, `${v} XP — ${l}`)));
  const toggle = (key, label, hint) => el("label", { class: "toggle" }, el("input", { type: "checkbox", checked: !!s[key], onchange: async e => { await store.saveSettings({ [key]: e.target.checked }); if (key === "sounds") audio.setSfx(e.target.checked); } }), el("span", {}, label, hint ? el("small", {}, hint) : null));
  const speed = el("input", { type: "range", min: 0.75, max: 1.5, step: 0.05, value: s.speed, "aria-label": "Ear speed" });
  const speedTxt = el("b", {}, s.speed.toFixed(2) + "×");
  speed.oninput = () => (speedTxt.textContent = (+speed.value).toFixed(2) + "×");
  speed.onchange = () => store.saveSettings({ speed: +speed.value });
  view.replaceChildren(
    el("h1", {}, "Tú"),
    el("div", { class: "stats" },
      el("div", { class: "stat" }, el("span", {}, "🔥"), el("b", {}, st.n), el("small", {}, "day streak")),
      el("div", { class: "stat" }, el("span", {}, "⚡"), el("b", {}, P.totalXP()), el("small", {}, "total XP")),
      el("div", { class: "stat" }, el("span", {}, "🎖️"), el("b", {}, "Lv " + lv.lv), el("small", {}, `${lv.into}/${lv.need} to next`)),
      el("div", { class: "stat" }, el("span", {}, "📚"), el("b", {}, P.stats().learned), el("small", {}, `of ${P.stats().total} phrases`))),
    el("div", { class: "card" }, el("h2", {}, `Liga ${lg.name}`), el("small", { class: "muted" }, `${lg.daysLeft} day${lg.daysLeft === 1 ? "" : "s"} left · top 2 move up`),
      el("ol", { class: "league" }, ...lg.board.map((r, k) => el("li", { class: r.me ? "me" : "" }, el("span", {}, k + 1), el("b", {}, r.name), el("span", {}, r.xp + " XP"))))),
    el("div", { class: "card" }, el("h2", {}, "Tienda"), el("p", {}, `🪙 ${P.cheles()} cheles · 🧊 ${P.freezesOwned()} streak freeze${P.freezesOwned() === 1 ? "" : "s"} (max 2)`),
      el("button", { class: "btn small", disabled: P.cheles() < 50 || P.freezesOwned() >= 2, onclick: async () => { if (await P.buyFreeze()) { toast("Streak freeze ready. It covers a missed day automatically."); renderMe(); renderTop(); } } }, "Buy streak freeze · 50 🪙")),
    el("div", { class: "card" }, el("h2", {}, "Logros"), el("div", { class: "achs" }, ...P.achievements().map(a => el("div", { class: "ach" + (a.have >= a.need ? " got" : "") },
      el("span", { class: "ach-i" }, a.icon), el("div", {}, el("b", {}, a.name), el("small", {}, a.desc), el("div", { class: "unit-prog" }, el("i", { style: { width: Math.min(100, 100 * a.have / a.need) + "%" } }))))))),
    el("div", { class: "card" }, el("h2", {}, "Settings"),
      el("label", { class: "field" }, "Daily goal", goalSel),
      el("label", { class: "field" }, el("span", {}, "Ear speed ", speedTxt, el("small", {}, "Adjusts itself: up when you catch most of what you hear, down when you're missing a lot.")), speed),
      toggle("sounds", "Sound effects"),
      toggle("micOn", "Speaking exercises", "Uses Chrome/Edge speech recognition"),
      toggle("showVulgar", "Include vulgar words and slurs (recognize only)", "So you know what students are saying. Never in speaking drills."),
      toggle("unlockAll", "Unlock everything", "Skip ahead on the path"),
      el("div", { class: "row" }, el("button", { id: "syncBtn2", class: "btn small", hidden: true }, "OneDrive sync"), el("button", { class: "btn small ghost", onclick: cacheAudio }, "Download audio for offline"))),
    el("div", { class: "card research" }, el("h2", {}, "Why it works"), ...RESEARCH.map(r => el("details", {}, el("summary", {}, r.title), el("p", {}, r.body), el("p", { class: "cite" }, r.cite)))),
    el("p", { class: "muted small center" }, "Audio: Microsoft neural voices (es-DO Emilio and Ramona). Content is a starting point; fix anything that sounds off in js/content.js."));
  const s2 = $("#syncBtn"); const b2 = $("#syncBtn2");
  if (s2 && !s2.hidden) { b2.hidden = false; b2.onclick = () => s2.click(); }
}
async function cacheAudio() {
  const m = await fetch("audio/manifest.json").then(r => r.json()).catch(() => ({}));
  const urls = Object.keys(m).flatMap(id => [`audio/${id}-a.mp3`, `audio/${id}-b.mp3`]);
  if (!urls.length) return toast("No audio files found.");
  const c = await caches.open("dimelo-audio");
  let n = 0;
  toast(`Downloading ${urls.length} clips…`, 60000);
  for (let i = 0; i < urls.length; i += 8) {
    await Promise.all(urls.slice(i, i + 8).map(async u => { if (!(await c.match(u))) { const r = await fetch(u); if (r.ok) await c.put(u, r); } n++; }));
  }
  toast(`All ${n} clips saved for offline use.`);
}

// ---------- start ----------
async function init() {
  await store.load();
  audio.setSfx(store.settings().sounds);
  const used = await P.applyFreezes();
  if (used.length) toast(`🧊 A streak freeze covered ${used.length === 1 ? "yesterday" : used.length + " days"}. Streak saved!`, 6000);
  store.onChange((_, fromSync) => { if (fromSync && !document.body.classList.contains("in-lesson")) { renderTop(); if (tab !== "clips" && tab !== "partner") show(tab); } });
  show(tab);
  if (!store.all("lesson:").length && !localStorage.getItem("dimelo-welcomed")) welcome();
  startSync().catch(() => {});
  // offline cache on the real site only, so local testing always runs fresh code
  if ("serviceWorker" in navigator && location.hostname !== "localhost") navigator.serviceWorker.register("sw.js").catch(() => {});
}
function welcome() {
  const d = el("dialog", { class: "sheet" },
    el("h2", {}, "¡Dímelo! 👋"),
    el("p", {}, "This course trains your ear for fast Dominican Spanish and gives you the phrases you need with students and families."),
    el("ul", {},
      el("li", {}, "🔊 Every phrase is spoken by Dominican neural voices; your ear speed rises as you improve."),
      el("li", {}, "🐢 Slow replay is always there (it just counts as \"hard\" for scheduling)."),
      el("li", {}, "🧠 Daily review brings back each phrase right before you'd forget it."),
      el("li", {}, "🎬 Clip lab turns real YouTube speech into practice."),
      el("li", {}, "⏱️ 10 minutes a day (30 XP) is the default goal.")),
    el("button", { class: "btn go", onclick: () => d.close() }, "Vamo' a empezar"));
  d.onclose = () => { d.remove(); try { localStorage.setItem("dimelo-welcomed", "1"); } catch (_) {} };
  document.body.append(d); d.showModal();
}
init();
