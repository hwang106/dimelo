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
  { id: "mom", who: "a mom from Santiago in her forties, a little worried", title: "Phone call: worried mom", role: "Doña Altagracia, a mom from Santiago (Cibao accent) who lives in Washington Heights. The teacher is calling about your son Yeison (7th grade) not turning in homework. You work late at a salon, are worried, a bit defensive at first, then cooperative. You call the teacher 'profe' or 'mi amor'." },
  { id: "dad", who: "a busy dad from Santo Domingo who drives a cab", title: "Phone call: busy dad", role: "Don Ramón, a dad from Santo Domingo who drives a cab. Short on time, speaks fast, uses 'mire', 'ajá', 'déjelo de mi cuenta'. The teacher calls about his daughter Yarelis fighting in the hallway." },
  { id: "newbie", who: "a shy 12-year-old boy", title: "Newcomer student", role: "Starlin, a 12-year-old who arrived from San Francisco de Macorís two weeks ago. Shy, knows almost no English, misses his friends and his liceo, lives with his aunt. Uses kid slang lightly." },
  { id: "hallway", who: "a joking, energetic 13-year-old", title: "Hallway chatter", role: "Two 8th graders (Kelvin and Yokasta) joking with their teacher between classes. Heavy Dominican teen slang (klk, dímelo, manito, 'tá brutal, chercha, dique, quillao, una pila de), playful, a little fresh but respectful in the end. No slurs." },
  { id: "conf", who: "a proud mom in her thirties", title: "Conference night", role: "Doña Miledys, mother of Ana (8th grade). Proud of Ana, worried about math, doesn't speak English, asks if Ana will be held back ('¿la van a dejar?'), asks for things in Spanish." },
  { id: "colmado", who: "a friendly, chatty man who works the counter at a bodega", title: "Colmado on 181st", role: "Papo, the friendly guy at the colmado counter. Banter, food (chimi, pica pollo, morir soñando, mangú), fiao, la ñapa, neighborhood gossip, baseball." },
];

function system(scene) {
  return `You are role-playing for a language learner: ${scene.role}
The learner is an American middle school teacher in Washington Heights (NYC) with solid intermediate Spanish who needs to understand FAST, real Dominican Spanish.
Rules:
- Stay in character. Speak like a real Dominican: dropped s ('tá, 'tamo', lo' muchacho'), pa', na', to', -ao for -ado, r→l or r→i where natural, non-inverted questions (¿Qué tú quieres?), and real Dominican words. Write the Spanish the way it is pronounced, using apostrophes for dropped sounds.
- Keep each reply short: 1–3 sentences, like real conversation. Ask questions back so the learner has to talk.
- Reply ONLY with JSON: {"reply": "<your line in Dominican Spanish>", "standard": "<the same line in standard written Spanish>", "en": "<English translation>", "coach": "<one short note in English about the learner's last message: a mistake, a more natural Dominican way to say it, or praise. Empty for your first line>"}`;
}

// ---- which models to use ----
// Google renames and retires models often, so the lists come from the key's own model listing
// (cached; cleared when a model disappears). Chat: stable "flash" first (newest first), then
// previews, then "flash-lite". Voice: the text-to-speech ("tts") models, same order.
const ver = n => parseFloat((/gemini-(\d+(\.\d+)?)/.exec(n) || [0, 0])[1]);
const rank = n => (/preview|exp/.test(n) ? 1 : 0) + (/lite/.test(n) ? 2 : 0);
const byQuality = (x, y) => rank(x) - rank(y) || ver(y) - ver(x);
async function lists(key) {
  try { const c = JSON.parse(ls.get(MODEL + "-lists") || "null"); if (c && c.chat && c.chat.length) return c; } catch (_) {}
  const r = await fetch(`${API}/models?key=${encodeURIComponent(key)}&pageSize=200`, { signal: AbortSignal.timeout(15000) });
  if (r.status === 400 || r.status === 403) throw new Error("Google didn't accept this key. Check it in AI Studio, or remove it below and paste it again.");
  if (!r.ok) throw new Error("Couldn't reach Gemini (" + r.status + "). Try again in a minute.");
  const { models = [] } = await r.json();
  const gen = models.filter(m => (m.supportedGenerationMethods || []).includes("generateContent")).map(m => m.name.replace(/^models\//, ""));
  const chat = gen.filter(n => /gemini-[\d.]+-flash/.test(n) && !/image|tts|live|audio|thinking|embedding/.test(n)).sort(byQuality);
  const tts = gen.filter(n => /gemini-[\d.]+-flash.*tts/.test(n)).sort(byQuality);
  if (!chat.length) throw new Error("No usable Gemini model found for this key.");
  const c = { chat, tts };
  ls.set(MODEL + "-lists", JSON.stringify(c));
  return c;
}
const forgetLists = () => ls.set(MODEL + "-lists", "");

// Models that were overloaded or out of free quota are skipped for a while.
const busyMap = () => { try { return JSON.parse(ls.get(MODEL + "-busy") || "{}"); } catch (_) { return {}; } };
function markBusy(model, minutes) { const m = busyMap(); m[model] = Date.now() + minutes * 60e3; ls.set(MODEL + "-busy", JSON.stringify(m)); }
function order(list, good) {
  const m = busyMap(), now = Date.now();
  const ok = list.filter(x => !(m[x] > now)), busy = list.filter(x => m[x] > now);
  const sorted = good && ok.includes(good) ? [good, ...ok.filter(x => x !== good)] : ok;
  return [...sorted, ...busy];   // busy ones only as a last resort
}

// "Thinking" adds seconds and doesn't help one-line role-play replies; models that refuse the
// setting are remembered and asked without it.
const noThink = () => { try { return JSON.parse(ls.get(MODEL + "-nothink") || "[]"); } catch (_) { return []; } };
function thinkingOff(model) {
  if (noThink().includes(model)) return null;
  return /gemini-2\./.test(model) ? { thinkingBudget: 0 } : { thinkingLevel: "low" };
}

class Busy extends Error {}
async function askOne(key, model, payload, signal) {
  for (let pass = 0; pass < 2; pass++) {
    const think = pass === 0 ? thinkingOff(model) : null;
    const gc = { ...payload.generationConfig, ...(think ? { thinkingConfig: think } : {}) };
    const r = await fetch(`${API}/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, generationConfig: gc }), signal });
    if (r.ok) return r.json();
    if (r.status === 400 && think) { ls.set(MODEL + "-nothink", JSON.stringify([...noThink(), model])); continue; }
    if (r.status === 400 || r.status === 403) throw Object.assign(new Error("Google didn't accept this key (" + r.status + ")."), { fatal: true });
    if (r.status === 404) { forgetLists(); throw new Busy("gone"); }
    markBusy(model, r.status === 429 ? 30 : 10);
    throw new Busy(String(r.status));
  }
  throw new Busy("400");
}

// Hedged requests: ask the best model; if it hasn't answered in 5 s, also ask the next one, and so
// on. The first good answer wins and the others are cancelled. Worst case 30 s, usually a few.
export async function ask(key, scene, history, onSlow = () => {}) {
  const models = order((await lists(key)).chat, ls.get(MODEL)).slice(0, 3);
  const payload = { systemInstruction: { parts: [{ text: system(scene) }] }, contents: history, generationConfig: { responseMimeType: "application/json", temperature: 0.9, maxOutputTokens: 400 } };
  const ctl = new AbortController();
  const stop = setTimeout(() => ctl.abort(), 30e3);
  let fails = 0, lastErr = "";
  try {
    const won = await new Promise((resolve, reject) => {
      ctl.signal.addEventListener("abort", () => reject(Object.assign(new Error("timeout"), { name: "AbortError" })));
      const startOne = i => {
        if (i >= models.length) return;
        if (i > 0) onSlow(models[i]);
        let advanced = false;
        const next = () => { if (!advanced) { advanced = true; startOne(i + 1); } };
        const t = setTimeout(next, 5000);
        askOne(key, models[i], payload, ctl.signal).then(j => { clearTimeout(t); resolve({ j, model: models[i] }); }, e => {
          clearTimeout(t);
          if (e.fatal) return reject(e);
          if (e.name !== "AbortError") lastErr = e.name === "TypeError" ? "network" : e.message;
          if (++fails >= models.length) reject(new Error(lastErr || "timeout"));
          else next();
        });
      };
      startOne(0);
    });
    ls.set(MODEL, won.model);
    const text = won.j.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "{}";
    try { return JSON.parse(text); } catch (_) { return { reply: text, standard: "", en: "", coach: "" }; }
  } catch (e) {
    if (e.fatal) throw e;
    const m = e.message;
    throw new Error(m === "429" ? "Free-tier limit reached on every model for now. Try again in a few minutes."
      : m === "network" ? "No connection to Gemini. Check your internet."
      : m === "timeout" ? "Gemini is taking too long right now. Try again in a minute."
      : "Gemini is busy right now (" + m + "). Try again in a minute.");
  } finally { clearTimeout(stop); ctl.abort(); }   // cancel any slower requests still running
}

// ---- natural voice (Gemini text-to-speech) ----
const VOICES = { mom: "Kore", dad: "Charon", newbie: "Puck", hallway: "Fenrir", conf: "Aoede", colmado: "Orus" };
export function wav(pcm, rate) {
  const h = new DataView(new ArrayBuffer(44)), w = (o, s) => [...s].forEach((c, i) => h.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); h.setUint32(4, 36 + pcm.length, true); w(8, "WAVE"); w(12, "fmt "); h.setUint32(16, 16, true);
  h.setUint16(20, 1, true); h.setUint16(22, 1, true); h.setUint32(24, rate, true); h.setUint32(28, rate * 2, true);
  h.setUint16(32, 2, true); h.setUint16(34, 16, true); w(36, "data"); h.setUint32(40, pcm.length, true);
  return new Blob([h.buffer, pcm], { type: "audio/wav" });
}
// Returns an object URL for the line spoken by a natural voice, or null (then the device voice reads).
export async function voice(key, scene, line) {
  const { tts } = await lists(key);
  const models = order(tts, ls.get(MODEL + "-tts")).slice(0, 2);
  const style = `Read this aloud as ${scene.who || "a Dominican adult"}, a native speaker from the Dominican Republic: fast, relaxed, casual Dominican Spanish with a natural Caribbean accent (aspirated or dropped final s, soft r), like a real conversation, not a narrator. Say only the line`;
  voice.lastStatus = tts.length ? 0 : "none";
  for (const model of models) {
    for (const withVoice of [true, false]) {
      const body = { contents: [{ parts: [{ text: `${style}: ${line.replace(/['’]/g, "")}` }] }],
        generationConfig: { responseModalities: ["AUDIO"], ...(withVoice ? { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICES[scene.id] || "Kore" } } } } : {}) } };
      let r;
      try { r = await fetch(`${API}/models/${model}:generateContent?key=${encodeURIComponent(key)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) }); }
      catch (_) { break; }
      if (r.status === 400 && withVoice) continue;   // that voice isn't offered by this model: let it choose
      if (!r.ok) { if (r.status === 404) forgetLists(); else markBusy(model, r.status === 429 ? 60 : 10); voice.lastStatus = r.status; break; }
      const part = (await r.json()).candidates?.[0]?.content?.parts?.find(p => p.inlineData);
      if (!part) break;
      const mime = part.inlineData.mimeType || "";
      const rate = +((/rate=(\d+)/.exec(mime) || [0, 24000])[1]);
      const bytes = Uint8Array.from(atob(part.inlineData.data), c => c.charCodeAt(0));
      ls.set(MODEL + "-tts", model);
      return URL.createObjectURL(/wav|mpeg|mp3|ogg/.test(mime) ? new Blob([bytes], { type: mime }) : wav(bytes, rate));
    }
  }
  return null;
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
    el("button", { class: "link", onclick: () => { ls.set(KEY, ""); ls.set(MODEL, ""); forgetLists(); renderPartner(view); } }, "Remove my key from this browser"));
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
  let warned = false;
  const them = r => {
    const txt = el("div", { class: "b-text hidden" }, r.reply, r.standard ? el("div", { class: "b-std" }, r.standard) : null);
    const en = el("div", { class: "b-en hidden" }, r.en);
    const status = el("span", { class: "b-status" }, "voice loading…");
    let url = null;
    const fallback = rate => audio.say(r.standard || r.reply, { rate });
    const play = rate => {
      if (!url) return fallback(rate);
      audio.stop();
      const a = new Audio(url); a.playbackRate = rate; a.preservesPitch = true;
      a.play().catch(() => fallback(rate));
    };
    const b = el("div", { class: "bubble them" },
      el("div", { class: "b-ctl" },
        el("button", { class: "icon-btn", "aria-label": "Play", onclick: () => play(1) }, "🔊"),
        el("button", { class: "icon-btn", "aria-label": "Play slowly", onclick: () => play(0.75) }, "🐢"),
        el("button", { class: "link", onclick: () => txt.classList.toggle("hidden") }, "Text"),
        el("button", { class: "link", onclick: () => en.classList.toggle("hidden") }, "English"), status),
      txt, en, r.coach ? el("div", { class: "coach" }, "💬 " + r.coach) : null);
    log.append(b); b.scrollIntoView({ behavior: "smooth", block: "end" });
    voice(key, scene, r.reply).catch(() => null).then(u => {
      url = u; status.remove();
      if (!u && !warned) {
        warned = true;
        toast(voice.lastStatus === 429 ? "The natural voice hit today's free limit, so your device's voice is reading instead."
          : "The natural voice isn't available right now, so your device's voice is reading instead.", 6000);
      }
      play(1);
    });
  };
  async function go(text) {
    if (text) { history.push({ role: "user", parts: [{ text }] }); log.append(el("div", { class: "bubble me" }, text)); turns++; }
    else history.push({ role: "user", parts: [{ text: "(Start the conversation with your first line.)" }] });
    send.disabled = true;
    const typing = el("div", { class: "bubble them typing" }, "…"); log.append(typing);
    try {
      const r = await ask(key, scene, history, () => { typing.textContent = "… (busy, asking a backup)"; });
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
