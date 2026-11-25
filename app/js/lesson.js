// The lesson player: builds a queue of exercises and runs them full screen.
import { el, shuffle, pick, REG_LABEL, WHO_LABEL } from "./ui.js";
import * as audio from "./audio.js";
import * as store from "./store.js";
import * as P from "./progress.js";
import { bestOf, diff, words } from "./match.js";
import { ALL_ITEMS, UNITS } from "./content.js";
import { retrievability } from "./srs.js";

const PRAISE = ["¡Brutal!", "¡Nítido!", "¡Ta to'!", "¡Eso e' así!", "¡Durísimo!", "¡Tremendo!", "¡Jevi!"];
const SPEAK_OFF_KEY = "dimelo-nospeak-until";
const speakOff = () => { try { return Date.now() < +(localStorage.getItem(SPEAK_OFF_KEY) || 0); } catch (_) { return false; } };
const recognizeOnly = it => it.reg === "vul" || it.reg === "off";
const plain = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-zñ ]+/g, "").replace(/\s+/g, " ").trim();
const differs = it => plain(it.fast) !== plain(it.es);

export function customItems() {
  return store.all("item:").map(r => ({ id: r.id, es: r.es, fast: r.fast || r.es, en: r.en, note: r.note || "", reg: "", say: !!r.say, who: "adult", unit: "custom", custom: true, clip: r.clip }));
}
const poolFor = it => {
  const unit = ALL_ITEMS.filter(x => x.unit === it.unit && x.id !== it.id);
  return unit.length >= 3 ? unit : ALL_ITEMS.concat(customItems()).filter(x => x.id !== it.id);
};
function choices(it, field, n = 4) {
  const seen = new Set([it[field]]), out = [it];
  for (const x of shuffle(poolFor(it)).concat(shuffle(ALL_ITEMS))) {
    if (out.length >= n) break;
    if (!seen.has(x[field])) { seen.add(x[field]); out.push(x); }
  }
  return shuffle(out);
}

// ---------- exercise queues ----------
function recType(it) {
  if (recognizeOnly(it)) return pick(["hear-meaning", "meaning"]);
  const opts = ["hear-meaning", "hear-meaning", "hear-type"];
  if (differs(it)) opts.push("decode");
  return pick(opts);
}
function proType(it) {
  const opts = ["build"];
  if (audio.canListen && store.settings().micOn && !speakOff()) opts.push("speak", "speak");
  return pick(opts);
}
export function lessonQueue(newItems, reviewItems = []) {
  const q = [];
  for (const it of newItems) {
    q.push({ type: "intro", it });
    q.push({ type: recognizeOnly(it) ? "meaning" : "hear-meaning", it, skill: "rec" });
  }
  const round2 = [];
  for (const it of newItems) {
    if (recognizeOnly(it)) continue;
    round2.push({ type: differs(it) ? "decode" : "hear-type", it, skill: "rec" });
    if (it.say) round2.push({ type: proType(it), it, skill: "pro" });
  }
  for (const it of reviewItems) round2.push(reviewExercise(it));
  q.push(...shuffle(round2));
  const lastUp = newItems.filter(i => !recognizeOnly(i));
  if (lastUp.length) q.push({ type: "hear-type", it: pick(lastUp), skill: "rec" });
  return q;
}
function reviewExercise(it, skill) {
  skill = skill || (it.say && Math.random() < 0.4 ? "pro" : "rec");
  return { type: skill === "pro" ? proType(it) : recType(it), it, skill };
}
// due (or weakest) cards, interleaved across units
export function practiceQueue(n = 12, onlyUnit = null) {
  const items = Object.fromEntries(ALL_ITEMS.concat(customItems()).map(i => [i.id, i]));
  const now = Date.now();
  const cards = store.all("card:").map(c => { const k = c.id.lastIndexOf(":"); return { c, id: c.id.slice(5, k), skill: c.id.slice(k + 1) }; })
    .filter(x => items[x.id] && (!onlyUnit || items[x.id].unit === onlyUnit))
    .map(x => ({ ...x, r: retrievability(x.c, now), due: x.c.due <= now }))
    .sort((a, b) => (b.due - a.due) || (a.r - b.r));
  const picked = [], seen = new Set();
  for (const x of cards) { if (picked.length >= n) break; if (seen.has(x.id)) continue; seen.add(x.id); picked.push(reviewExercise(items[x.id], x.skill)); }
  return shuffle(picked);
}
export function unitReviewQueue(unit) {
  const its = shuffle(unit.items).slice(0, 10);
  return its.map(it => reviewExercise(it, it.say && !recognizeOnly(it) && Math.random() < 0.5 ? "pro" : "rec"));
}
export const dueCount = () => store.all("card:").filter(c => c.due <= Date.now()).length;

// ---------- runner ----------
export function runLesson({ title, queue, onDone, timed = 0, xpEach = 1, bonus = 10 }) {
  const s = store.settings();
  const root = el("section", { class: "lesson", role: "dialog", "aria-label": title });
  const bar = el("div", { class: "bar-fill" });
  const combo = el("div", { class: "combo", "aria-live": "polite" });
  const timer = el("div", { class: "timer" });
  const close = el("button", { class: "icon-btn close", "aria-label": "Quit lesson", onclick: () => quit() }, "✕");
  const body = el("div", { class: "ex" });
  const foot = el("footer", { class: "lfoot" });
  root.append(el("header", { class: "lhead" }, close, el("div", { class: "bar" }, bar), timed ? timer : combo), body, foot);
  document.body.append(root);
  document.body.classList.add("in-lesson");

  const total0 = queue.length;
  let i = 0, correct = 0, wrong = 0, streakNow = 0, best = 0, xp = 0, ended = false;
  const graded = new Set(), requeued = new Set(), started = Date.now();
  let endAt = timed ? Date.now() + timed * 1000 : 0, tick = 0;
  if (timed) tick = setInterval(() => { const left = Math.max(0, Math.ceil((endAt - Date.now()) / 1000)); timer.textContent = `⏱ ${left}s`; if (!left) finish(); }, 250);

  function quit() {
    if (ended) return;
    if (i > 0 && !timed && !confirm("Quit this lesson? You'll keep the XP from answers so far.")) return;
    finish(true);
  }
  function progress() {
    const done = timed ? Math.min(1, (Date.now() - started) / (timed * 1000)) : i / queue.length;
    bar.style.width = Math.round(done * 100) + "%";
    combo.textContent = streakNow >= 3 ? `🔥 ${streakNow}` : "";
  }

  async function next() {
    progress();
    if (ended) return;
    if (i >= queue.length) return timed ? refill() : finish();
    const ex = queue[i];
    body.replaceChildren(); foot.replaceChildren(); foot.className = "lfoot";
    TYPES[ex.type](ex, body, foot, result, () => { i++; next(); });
  }
  function refill() { queue.push(...practiceQueue(10).map(x => ({ ...x, type: "hear-meaning", skill: "rec" }))); if (i >= queue.length) finish(); else next(); }

  // ok: boolean; rating for FSRS; answer shown in the feedback panel
  async function result(ex, ok, { rating, answer, note, extra } = {}) {
    const key = ex.it.id + ":" + ex.skill;
    if (ex.skill && !graded.has(key)) {
      graded.add(key);
      await P.grade(ex.it.id, ex.skill, ok ? rating || 3 : 1);
    }
    if (ex.type.startsWith("hear")) {
      const moved = await P.listenResult(ok);
      if (moved === "up") note = (note ? note + " " : "") + "👂 Your ear speed went up!";
    }
    if (ok) { correct++; streakNow++; best = Math.max(best, streakNow); xp += xpEach; audio.sfx(streakNow > 0 && streakNow % 5 === 0 ? "combo" : "ok"); }
    else {
      wrong++; streakNow = 0; audio.sfx("bad");
      if (!timed && !requeued.has(ex.it.id)) { requeued.add(ex.it.id); queue.push({ ...ex, type: ex.type === "intro" ? "hear-meaning" : ex.type }); }
    }
    progress();
    if (timed) { i++; foot.className = "lfoot " + (ok ? "good" : "bad"); setTimeout(next, ok ? 350 : 1400); if (!ok) foot.replaceChildren(el("div", { class: "fb" }, el("b", {}, ex.it.en), el("div", {}, ex.it.fast))); return; }
    foot.className = "lfoot " + (ok ? "good" : "bad");
    const msg = ok ? (streakNow >= 3 && streakNow % 3 === 0 ? pick(PRAISE) + ` ${streakNow} seguidas` : pick(PRAISE)) : "Casi... the answer:";
    foot.replaceChildren(
      el("div", { class: "fb" },
        el("h3", {}, msg),
        answer ? el("div", { class: "ans" }, answer) : null,
        extra || null,
        note ? el("div", { class: "note" }, note) : null,
        ex.it.note && ex.type !== "intro" ? el("div", { class: "note" }, "💡 " + ex.it.note) : null),
      el("button", { class: "btn " + (ok ? "go" : "red"), autofocus: true, onclick: () => { i++; next(); } }, "Continue"));
    foot.querySelector("button").focus();
  }

  async function finish(quitEarly = false) {
    if (ended) return; ended = true; clearInterval(tick); audio.stop(); audio.stopListening();
    const secs = Math.round((Date.now() - started) / 1000);
    const perfect = !quitEarly && wrong === 0 && correct > 0;
    const earned = xp + (quitEarly ? 0 : bonus) + (perfect && !timed ? 5 : 0);
    const chel = quitEarly ? 0 : 5;
    const before = P.streak();
    await P.addToday({ xp: earned, secs, lessons: quitEarly ? 0 : 1, cheles: chel });
    const after = P.streak();
    const acc = correct + wrong ? Math.round(100 * correct / (correct + wrong)) : 0;
    if (quitEarly) { cleanup(); onDone && onDone({ quit: true }); return; }
    audio.sfx("done");
    body.replaceChildren(el("div", { class: "done" },
      el("div", { class: "done-burst" }, perfect ? "🏆" : "🎉"),
      el("h2", {}, timed ? `${correct} right in ${timed}s` : perfect ? "¡Perfecto, manito!" : "¡Lección completa!"),
      el("div", { class: "tiles" },
        el("div", { class: "tile xp" }, el("small", {}, "XP"), el("b", {}, "+" + earned)),
        el("div", { class: "tile acc" }, el("small", {}, "Accuracy"), el("b", {}, acc + "%")),
        el("div", { class: "tile time" }, el("small", {}, "Time"), el("b", {}, `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`))),
      !before.today && after.today ? el("p", { class: "streak-up" }, `🔥 Streak: ${after.n} day${after.n === 1 ? "" : "s"}!`) : null,
      best >= 5 ? el("p", { class: "muted" }, `Best combo: ${best}`) : null));
    foot.className = "lfoot";
    foot.replaceChildren(el("button", { class: "btn go", onclick: () => { cleanup(); onDone && onDone({ correct, wrong, earned, best }); } }, "Continue"));
    foot.querySelector("button").focus();
  }
  function cleanup() { root.remove(); document.body.classList.remove("in-lesson"); }
  next();
  return { quit };
}

// ---------- exercise types ----------
const speed = () => store.settings().speed;
function playBtns(it, { autoplay = true, onSlow } = {}) {
  const big = el("button", { class: "speak-big", "aria-label": "Play" }, "🔊");
  const slow = el("button", { class: "speak-slow", "aria-label": "Play slowly" }, "🐢");
  big.onclick = () => audio.play(it.id, it.fast, { rate: speed() });
  slow.onclick = () => { onSlow && onSlow(); audio.play(it.id, it.fast, { rate: 0.7 }); };
  if (autoplay) setTimeout(() => big.click(), 250);
  return el("div", { class: "play-row" }, big, slow);
}
function checkBtn(foot, fn, label = "Check") {
  const b = el("button", { class: "btn go", disabled: true, onclick: () => fn(false) }, label);
  const skip = el("button", { class: "btn ghost", onclick: () => fn(true) }, "I don't know");
  foot.replaceChildren(skip, b);
  return b;
}
const regBadge = it => it.reg ? el("span", { class: "badge reg-" + it.reg }, REG_LABEL[it.reg]) : null;
const whoBadge = it => el("span", { class: "badge who" }, WHO_LABEL[it.who] || "");
const answerView = it => el("div", {}, el("div", { class: "a-fast" }, it.fast), differs(it) ? el("div", { class: "a-es" }, "= " + it.es) : null, el("div", { class: "a-en" }, it.en));

function mcq(ex, body, foot, done, { prompt, options, label, correctOf, audioFirst, slow }) {
  let chosen = null, slowUsed = false;
  const list = el("div", { class: "opts" });
  options.forEach((o, k) => {
    const b = el("button", { class: "opt", onclick: () => { chosen = o; list.querySelectorAll(".opt").forEach(x => x.classList.remove("sel")); b.classList.add("sel"); check.disabled = false; } },
      el("kbd", {}, k + 1), label(o));
    list.append(b);
  });
  body.append(...[el("h2", { class: "ask" }, prompt), audioFirst ? playBtns(ex.it, { onSlow: () => { slowUsed = true; } }) : null, slow, list].filter(Boolean));
  const check = checkBtn(foot, skip => {
    list.querySelectorAll(".opt").forEach(x => (x.disabled = true));
    const ok = !skip && correctOf(chosen);
    list.querySelectorAll(".opt").forEach((x, k) => { if (correctOf(options[k])) x.classList.add("right"); else if (options[k] === chosen) x.classList.add("wrong"); });
    done(ex, ok, { rating: slowUsed ? 2 : 3, answer: answerView(ex.it) });
  });
  keyChoose(list, check);
}
function keyChoose(list, check) {
  const h = e => {
    if (!document.body.contains(list)) return document.removeEventListener("keydown", h);
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= list.children.length && !list.children[n - 1].disabled) list.children[n - 1].click();
    if (e.key === "Enter" && !check.disabled && document.activeElement.tagName !== "BUTTON") check.click();
  };
  document.addEventListener("keydown", h);
}

const TYPES = {
  intro(ex, body, foot, done, advance) {
    const it = ex.it;
    let recBtn = null;
    if (it.say && navigator.mediaDevices && window.MediaRecorder) {
      recBtn = el("button", { class: "btn small ghost" }, "🎙️ Shadow it");
      const shadow = async () => {
        try {
          await audio.play(it.id, it.fast, { rate: Math.min(1, speed()) });
          recBtn.textContent = "● Recording… tap to stop";
          const r = await audio.record(7000);
          recBtn.onclick = () => r.stop();
          const blob = await r.done;
          recBtn.textContent = "▶ You, then them";
          await audio.playBlob(blob);
          await audio.play(it.id, it.fast, { rate: Math.min(1, speed()) });
          recBtn.textContent = "🎙️ Shadow again"; recBtn.onclick = shadow;
        } catch (_) { recBtn.textContent = "Mic not available"; }
      };
      recBtn.onclick = shadow;
    }
    body.append(
      el("div", { class: "new-tag" }, "NUEVO"),
      el("div", { class: "card-intro" },
        el("div", { class: "badges" }, whoBadge(it), regBadge(it)),
        playBtns(it),
        el("div", { class: "i-fast" }, it.fast),
        differs(it) ? el("div", { class: "i-es" }, "Written: ", el("span", {}, it.es)) : null,
        el("div", { class: "i-en" }, it.en),
        it.note ? el("div", { class: "note" }, "💡 " + it.note) : null,
        recBtn));
    const b = el("button", { class: "btn go", onclick: () => { audio.stop(); advance(); } }, "Got it");
    foot.append(b); setTimeout(() => b.focus(), 50);
  },
  "hear-meaning"(ex, body, foot, done) {
    mcq(ex, body, foot, done, { prompt: "What did they say?", audioFirst: true, options: choices(ex.it, "en"), label: o => o.en, correctOf: o => o && o.en === ex.it.en });
  },
  meaning(ex, body, foot, done) {
    body.append(el("div", { class: "badges" }, regBadge(ex.it)));
    mcq(ex, body, foot, done, { prompt: "What does this mean?", slow: el("div", { class: "prompt-text", onclick: () => audio.play(ex.it.id, ex.it.fast, { rate: speed() }) }, "🔊 ", ex.it.fast),
      options: choices(ex.it, "en"), label: o => o.en, correctOf: o => o && o.en === ex.it.en });
  },
  decode(ex, body, foot, done) {
    mcq(ex, body, foot, done, { prompt: "How is this written in standard Spanish?", audioFirst: true, slow: el("div", { class: "prompt-text" }, ex.it.fast),
      options: choices(ex.it, "es"), label: o => o.es, correctOf: o => o && o.es === ex.it.es });
  },
  "hear-type"(ex, body, foot, done) {
    let slowUsed = false;
    const ta = el("textarea", { class: "type-in", rows: 2, placeholder: "Type what you hear (any spelling that sounds right)", autocapitalize: "off", spellcheck: "false" });
    body.append(el("h2", { class: "ask" }, "Type what you hear"), playBtns(ex.it, { onSlow: () => { slowUsed = true; } }), ta,
      el("div", { class: "accents" }, ..."áéíóúñ¿¡".split("").map(c => el("button", { class: "acc", onclick: () => { ta.setRangeText(c, ta.selectionStart, ta.selectionEnd, "end"); ta.focus(); ta.dispatchEvent(new Event("input")); } }, c))));
    const check = checkBtn(foot, skip => {
      ta.disabled = true;
      const score = skip ? 0 : bestOf(ta.value, [ex.it.es, ex.it.fast]);
      const ok = score >= 0.7;
      const d = diff(ta.value, ex.it.es);
      done(ex, ok, { rating: score >= 0.88 && !slowUsed ? 3 : 2, answer: answerView(ex.it),
        extra: !skip && score < 1 ? el("div", { class: "diff" }, "You missed: ", ...d.map(w => el("span", { class: w.ok ? "hit" : "miss" }, w.tok + " "))) : null,
        note: ok && score < 0.88 ? "Close enough — the meaning came through." : "" });
    });
    ta.oninput = () => (check.disabled = !ta.value.trim());
    ta.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!check.disabled) check.click(); } };
    setTimeout(() => ta.focus(), 300);
  },
  build(ex, body, foot, done) {
    const target = ex.it.es.replace(/[¿?¡!.,;]/g, "").split(/\s+/).filter(Boolean);
    const extras = shuffle(poolFor(ex.it).flatMap(x => x.es.replace(/[¿?¡!.,;]/g, "").split(/\s+/))).filter(w => !target.some(t => t.toLowerCase() === w.toLowerCase())).slice(0, Math.min(4, Math.max(2, 9 - target.length)));
    const bank = el("div", { class: "bank" }), line = el("div", { class: "line" });
    const tiles = shuffle(target.concat(extras));
    tiles.forEach(w => {
      const t = el("button", { class: "tile-w" }, w);
      t.onclick = () => { (t.parentNode === bank ? line : bank).append(t); check.disabled = !line.children.length; };
      bank.append(t);
    });
    body.append(el("h2", { class: "ask" }, "Say it in Spanish"), el("div", { class: "prompt-text en" }, ex.it.en), line, bank);
    const check = checkBtn(foot, skip => {
      bank.querySelectorAll("button").forEach(b => (b.disabled = true)); line.querySelectorAll("button").forEach(b => (b.disabled = true));
      const got = [...line.children].map(b => b.textContent).join(" ");
      const ok = !skip && words(got).join(" ") === words(ex.it.es).join(" ");
      if (ok) audio.play(ex.it.id, ex.it.fast, { rate: speed() });
      done(ex, ok, { rating: 3, answer: answerView(ex.it) });
    });
  },
  speak(ex, body, foot, done) {
    const heard = el("div", { class: "heard" }, "");
    const mic = el("button", { class: "mic", "aria-label": "Tap and speak" }, "🎙️");
    const typeInstead = el("button", { class: "link" }, "Type instead");
    const cantNow = el("button", { class: "link" }, "Can't speak now (15 min)");
    body.append(el("h2", { class: "ask" }, ex.it.who === "me" ? "Say this in Spanish" : "Say it the Dominican way"),
      el("div", { class: "prompt-text en" }, ex.it.en), mic, heard, el("div", { class: "row-links" }, typeInstead, cantNow));
    let tries = 0;
    const finish = (said, skip) => {
      const score = skip ? 0 : bestOf(said, [ex.it.es, ex.it.fast]);
      const ok = score >= 0.75;
      done(ex, ok, { rating: score >= 0.9 ? 3 : 2, answer: answerView(ex.it),
        extra: said ? el("div", { class: "diff" }, "Heard: “" + said + "”") : null,
        note: ok && score < 0.9 ? "Understood! A word or two was off." : "" });
    };
    mic.onclick = async () => {
      mic.classList.add("on"); heard.textContent = "Listening…";
      try {
        const alts = await audio.listen({ onInterim: t => (heard.textContent = t) });
        mic.classList.remove("on");
        if (!alts.length) { heard.textContent = "Didn't catch that. Tap the mic and try again."; return; }
        const bestAlt = alts.reduce((a, b) => (bestOf(b, [ex.it.es, ex.it.fast]) > bestOf(a, [ex.it.es, ex.it.fast]) ? b : a));
        heard.textContent = "“" + bestAlt + "”";
        tries++;
        if (bestOf(bestAlt, [ex.it.es, ex.it.fast]) >= 0.75 || tries >= 2) finish(bestAlt);
        else heard.textContent += " — not quite. One more try.";
      } catch (e) { mic.classList.remove("on"); heard.textContent = "Mic unavailable (" + e.message + "). You can type instead."; }
    };
    typeInstead.onclick = () => {
      const inp = el("input", { class: "type-in", placeholder: "Type it in Spanish" });
      body.replaceChildren(el("h2", { class: "ask" }, "Write this in Spanish"), el("div", { class: "prompt-text en" }, ex.it.en), inp);
      const c = checkBtn(foot, skip => finish(inp.value, skip));
      inp.oninput = () => (c.disabled = !inp.value.trim());
      inp.onkeydown = e => { if (e.key === "Enter" && !c.disabled) c.click(); };
      inp.focus();
    };
    cantNow.onclick = () => { try { localStorage.setItem(SPEAK_OFF_KEY, Date.now() + 15 * 60e3); } catch (_) {} typeInstead.click(); };
    foot.replaceChildren(el("button", { class: "btn ghost", onclick: () => finish("", true) }, "Skip"));
  },
};
export { TYPES };
