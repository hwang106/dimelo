// Optional AI conversation partner on Google's free Gemini tier. Your key stays in this
// browser only (never synced). You talk (mic) or type; it answers in character, in fast Dominican
// Spanish, read aloud, plus a short coaching note in English.
import { el, toast } from "./ui.js";
import * as audio from "./audio.js";
import * as P from "./progress.js";

const KEY = "dimelo-gemini-key", MODEL = "dimelo-gemini-model";
const ls = { get: k => { try { return localStorage.getItem(k) || ""; } catch (_) { return ""; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} } };
const API = "https://generativelanguage.googleapis.com/v1beta";

export const SCENES = [
  { id: "mom", title: "Phone call: worried mom", role: "Doña Altagracia, a mom from Santiago (Cibao accent) who lives in Washington Heights. The teacher is calling about your son Yeison (7th grade) not turning in homework. You work late at a salon, are worried, a bit defensive at first, then cooperative. You call the teacher 'profe' or 'mi amor'." },
  { id: "dad", title: "Phone call: busy dad", role: "Don Ramón, a dad from Santo Domingo who drives a cab. Short on time, speaks fast, uses 'mire', 'ajá', 'déjelo de mi cuenta'. The teacher calls about his daughter Yarelis fighting in the hallway." },
  { id: "newbie", title: "Newcomer student", role: "Starlin, a 12-year-old who arrived from San Francisco de Macorís two weeks ago. Shy, knows almost no English, misses his friends and his liceo, lives with his aunt. Uses kid slang lightly." },
  { id: "hallway", title: "Hallway chatter", role: "Two 8th graders (Kelvin and Yokasta) joking with their teacher between classes. Heavy Dominican teen slang (klk, dímelo, manito, 'tá brutal, chercha, dique, quillao, una pila de), playful, a little fresh but respectful in the end. No slurs." },
  { id: "conf", title: "Conference night", role: "Doña Miledys, mother of Ana (8th grade). Proud of Ana, worried about math, doesn't speak English, asks if Ana will be held back ('¿la van a dejar?'), asks for things in Spanish." },
  { id: "colmado", title: "Colmado on 181st", role: "Papo, the friendly guy at the colmado counter. Banter, food (chimi, pica pollo, morir soñando, mangú), fiao, la ñapa, neighborhood gossip, baseball." },
];

function system(scene) {
  return `You are role-playing for a language learner: ${scene.role}
The learner is an American middle school teacher in Washington Heights (NYC) with solid intermediate Spanish who needs to understand FAST, real Dominican Spanish.
Rules:
- Stay in character. Speak like a real Dominican: dropped s ('tá, 'tamo', lo' muchacho'), pa', na', to', -ao for -ado, r→l or r→i where natural, non-inverted questions (¿Qué tú quieres?), and real Dominican words. Write the Spanish the way it is pronounced, using apostrophes for dropped sounds.
- Keep each reply short: 1–3 sentences, like real conversation. Ask questions back so the learner has to talk.
- Reply ONLY with JSON: {"reply": "<your line in Dominican Spanish>", "standard": "<the same line in standard written Spanish>", "en": "<English translation>", "coach": "<one short note in English about the learner's last message: a mistake, a more natural Dominican way to say it, or praise. Empty for your first line>"}`;
}

// Models to try, best first: the last one that worked, then stable "flash" models (newest
// first), then previews, then "flash-lite". Free-tier limits and busy errors are per model, so
// when one is overloaded (503) or out of quota (429) the next one usually works.
async function candidates(key) {
  let list = [];
  try { list = JSON.parse(ls.get(MODEL + "-list") || "[]"); } catch (_) {}
  if (!list.length) {
    const r = await fetch(`${API}/models?key=${encodeURIComponent(key)}&pageSize=200`, { signal: AbortSignal.timeout(15000) });
    if (r.status === 400 || r.status === 403) throw new Error("Google didn't accept this key. Check it in AI Studio, or remove it below and paste it again.");
    if (!r.ok) throw new Error("Couldn't reach Gemini (" + r.status + "). Try again in a minute.");
    const { models = [] } = await r.json();
    const ver = n => parseFloat((/gemini-(\d+(\.\d+)?)/.exec(n) || [0, 0])[1]);
    const rank = n => (/preview|exp/.test(n) ? 1 : 0) + (/lite/.test(n) ? 2 : 0);
    list = models.filter(m => (m.supportedGenerationMethods || []).includes("generateContent") && /gemini-[\d.]+-flash/.test(m.name) && !/image|tts|live|audio|thinking|embedding/.test(m.name))
      .map(m => m.name.replace(/^models\//, ""))
      .sort((x, y) => rank(x) - rank(y) || ver(y) - ver(x));
    if (!list.length) throw new Error("No usable Gemini model found for this key.");
    ls.set(MODEL + "-list", JSON.stringify(list));
  }
  const good = ls.get(MODEL);
  return good && list.includes(good) ? [good, ...list.filter(m => m !== good)] : list;
}

const wait = ms => new Promise(r => setTimeout(r, ms));
export async function ask(key, scene, history, onTry = () => {}) {
  const body = JSON.stringify({ systemInstruction: { parts: [{ text: system(scene) }] }, contents: history, generationConfig: { responseMimeType: "application/json", temperature: 0.9 } });
  let last = "";
  for (const model of (await candidates(key)).slice(0, 4)) {
    for (let attempt = 0; attempt < 2; attempt++) {
      onTry(model, attempt);
      let r;
      try { r = await fetch(`${API}/models/${model}:generateContent?key=${encodeURIComponent(key)}`, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(25000) }); }
      catch (e) { last = e.name === "TimeoutError" ? "timeout" : "network"; if (last === "timeout") break; await wait(1500); continue; }
      if (r.ok) {
        ls.set(MODEL, model);
        const j = await r.json();
        const text = j.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "{}";
        try { return JSON.parse(text); } catch (_) { return { reply: text, standard: "", en: "", coach: "" }; }
      }
      last = r.status;
      if (r.status === 400 || r.status === 403) throw new Error("Google didn't accept this key (" + r.status + ").");
      if (r.status === 404) { ls.set(MODEL + "-list", ""); break; }   // model retired: refresh the list next time
      if (r.status === 429) break;                                     // this model's free quota is used up: next model
      await wait(1500 * (attempt + 1));                                // 500/503 busy: wait, retry once, then next model
    }
  }
  throw new Error(last === 429 ? "Free-tier limit reached on every model for now. Try again in a few minutes."
    : last === "network" ? "No connection to Gemini. Check your internet." : last === "timeout" ? "Gemini is taking too long right now. Try again in a minute." : "Gemini is busy right now (" + last + "). Try again in a minute.");
}

export function renderPartner(view) {
  const key = ls.get(KEY);
  if (!key) {
    const inp = el("input", { type: "password", placeholder: "Paste your Gemini API key", autocomplete: "off" });
    view.replaceChildren(el("h1", {}, "Conversation partner"),
      el("div", { class: "card" },
        el("p", {}, "Free and optional. It plays a Dominican parent, student or neighbor, talks back in fast Dominican Spanish, and coaches you in English after each reply."),
        el("ol", {},
          el("li", {}, "Go to ", el("a", { href: "https://aistudio.google.com/apikey", target: "_blank", rel: "noopener" }, "Google AI Studio → Get API key"), " with your personal Google account."),
          el("li", {}, "Create a key (free tier, no card needed) and paste it here. You type it yourself; it's kept only in this browser.")),
        el("p", { class: "muted small" }, "Note: on Google's free tier, conversations may be used to improve their models. Don't use real student names."),
        inp, el("button", { class: "btn go", onclick: () => { if (inp.value.trim()) { ls.set(KEY, inp.value.trim()); renderPartner(view); } } }, "Save key")));
    return;
  }
  view.replaceChildren(el("h1", {}, "Conversation partner"), el("p", { class: "muted" }, "Pick a situation. Talk with the mic or type. Tap a line to see it written."),
    el("div", { class: "scenes" }, ...SCENES.map(s => el("button", { class: "scene", onclick: () => chat(view, s, key) }, el("b", {}, s.title)))),
    el("button", { class: "link", onclick: () => { ls.set(KEY, ""); ls.set(MODEL, ""); ls.set(MODEL + "-list", ""); renderPartner(view); } }, "Remove my key from this browser"));
}

function chat(view, scene, key) {
  const history = [];
  const log = el("div", { class: "chat" });
  const inp = el("input", { placeholder: "Escribe… (or use the mic)", "aria-label": "Your message" });
  const mic = el("button", { class: "mic small", "aria-label": "Speak" }, "🎙️");
  const send = el("button", { class: "btn go small" }, "Send");
  const start = Date.now();
  let turns = 0;
  view.replaceChildren(el("button", { class: "link", onclick: () => { finish(); renderPartner(view); } }, "← Situations"), el("h2", {}, scene.title), log,
    el("div", { class: "composer" }, audio.canListen ? mic : null, inp, send));
  const them = r => {
    const txt = el("div", { class: "b-text hidden" }, r.reply, r.standard ? el("div", { class: "b-std" }, r.standard) : null);
    const en = el("div", { class: "b-en hidden" }, r.en);
    const b = el("div", { class: "bubble them" },
      el("div", { class: "b-ctl" },
        el("button", { class: "icon-btn", "aria-label": "Play", onclick: () => audio.say(r.reply, { rate: 1.1 }) }, "🔊"),
        el("button", { class: "icon-btn", "aria-label": "Play slowly", onclick: () => audio.say(r.reply, { rate: 0.75 }) }, "🐢"),
        el("button", { class: "link", onclick: () => txt.classList.toggle("hidden") }, "Text"),
        el("button", { class: "link", onclick: () => en.classList.toggle("hidden") }, "English")),
      txt, en, r.coach ? el("div", { class: "coach" }, "💬 " + r.coach) : null);
    log.append(b); b.scrollIntoView({ behavior: "smooth", block: "end" });
    audio.say(r.reply, { rate: 1.1 });
  };
  async function go(text) {
    if (text) { history.push({ role: "user", parts: [{ text }] }); log.append(el("div", { class: "bubble me" }, text)); turns++; }
    else history.push({ role: "user", parts: [{ text: "(Start the conversation with your first line.)" }] });
    send.disabled = true;
    const typing = el("div", { class: "bubble them typing" }, "…"); log.append(typing); let tries = 0;
    try {
      const r = await ask(key, scene, history, m => { if (tries++) typing.textContent = "… Gemini is busy, trying " + m; });
      history.push({ role: "model", parts: [{ text: JSON.stringify(r) }] });
      typing.remove(); them(r);
    } catch (e) { typing.remove(); history.pop(); toast(e.message, 6000); }
    send.disabled = false;
  }
  send.onclick = () => { const t = inp.value.trim(); if (t) { inp.value = ""; go(t); } };
  inp.onkeydown = e => { if (e.key === "Enter") send.click(); };
  mic.onclick = async () => {
    mic.classList.add("on");
    try { const alts = await audio.listen({ onInterim: t => (inp.value = t) }); if (alts[0]) { inp.value = ""; go(alts[0]); } }
    catch (e) { toast("Mic: " + e.message); }
    mic.classList.remove("on");
  };
  function finish() { audio.stop(); if (turns >= 3) P.addToday({ xp: Math.min(30, turns * 3), secs: Math.round((Date.now() - start) / 1000) }); }
  go("");
}
