// Sound in and out.
//  play(): the pre-made Dominican neural voice clips (audio/<id>-a.mp3 Emilio, -b.mp3 Ramona),
//          at any speed with pitch kept; falls back to the device's own voices.
//  say():  device text-to-speech for things with no clip (your own phrases, the AI partner).
//  listen(): browser speech recognition (free; Chrome and Edge), set to Dominican Spanish.
//  record(): your own voice, for shadowing.

let current = null;
export function stop() {
  if (current) { current.pause(); current = null; }
  if (window.speechSynthesis) speechSynthesis.cancel();
}

let manifest = null;
async function clips() {
  if (!manifest) manifest = fetch("audio/manifest.json").then(r => (r.ok ? r.json() : {})).catch(() => ({}));
  return manifest;
}

// voice: "a" | "b" | undefined (random); returns a promise that resolves when playback ends
export async function play(id, text, { rate = 1, voice } = {}) {
  stop();
  const m = await clips();
  const v = voice || (Math.random() < 0.5 ? "a" : "b");
  if (m[id]) {
    const el = new Audio(`audio/${id}-${v}.mp3`);
    el.playbackRate = rate; el.preservesPitch = true; el.mozPreservesPitch = true;
    current = el;
    return new Promise(res => {
      el.onended = el.onerror = () => res();
      el.play().catch(() => res(say(text, { rate })));
    });
  }
  return say(text, { rate });
}

let voices = [];
function loadVoices() { voices = window.speechSynthesis ? speechSynthesis.getVoices() : []; }
if (window.speechSynthesis) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
export function bestVoice() {
  const es = voices.filter(v => /^es[-_]/i.test(v.lang) || v.lang === "es");
  const rank = v => {
    const l = v.lang.replace("_", "-").toLowerCase();
    return (l === "es-do" ? 0 : l === "es-pr" ? 1 : l === "es-cu" ? 2 : l === "es-us" ? 3 : l === "es-mx" ? 4 : 5) - (/natural|online|neural/i.test(v.name) ? 0.5 : 0);
  };
  return es.sort((a, b) => rank(a) - rank(b))[0] || null;
}
export function say(text, { rate = 1 } = {}) {
  if (!window.speechSynthesis) return Promise.resolve();
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/['’]/g, ""));
  const v = bestVoice();
  if (v) { u.voice = v; u.lang = v.lang; } else u.lang = "es-US";
  u.rate = rate;
  return new Promise(res => { u.onend = u.onerror = () => res(); speechSynthesis.speak(u); });
}

// ---- speech recognition ----
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = !!SR;
let rec = null;
export function stopListening() { if (rec) try { rec.stop(); } catch (_) {} }
// Resolves with the list of things it may have heard (best first), or [] if nothing.
export function listen({ onInterim } = {}) {
  if (!SR) return Promise.reject(new Error("no-sr"));
  stop();
  return new Promise((res, rej) => {
    rec = new SR();
    rec.lang = "es-DO"; rec.interimResults = true; rec.maxAlternatives = 5; rec.continuous = false;
    let finals = [];
    rec.onresult = e => {
      const r = e.results[e.results.length - 1];
      if (r.isFinal) finals = Array.from(r).map(a => a.transcript);
      else if (onInterim) onInterim(r[0].transcript);
    };
    rec.onerror = e => { if (e.error === "no-speech" || e.error === "aborted") res([]); else rej(new Error(e.error)); };
    rec.onend = () => { rec = null; res(finals); };
    rec.start();
  });
}

// ---- record yourself (shadowing) ----
export async function record(maxMs = 8000) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mr = new MediaRecorder(stream), chunks = [];
  mr.ondataavailable = e => chunks.push(e.data);
  const done = new Promise(res => { mr.onstop = () => { stream.getTracks().forEach(t => t.stop()); res(new Blob(chunks, { type: mr.mimeType })); }; });
  mr.start();
  const t = setTimeout(() => mr.state !== "inactive" && mr.stop(), maxMs);
  return { stop: () => { clearTimeout(t); if (mr.state !== "inactive") mr.stop(); return done; }, done };
}
export function playBlob(blob) {
  stop();
  const el = new Audio(URL.createObjectURL(blob)); current = el;
  return new Promise(res => { el.onended = () => res(); el.play().catch(res); });
}

// ---- little game sounds ----
let ctx = null, sfxOn = true;
export const setSfx = v => { sfxOn = v; };
export function sfx(kind) {
  if (!sfxOn) return;
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    const notes = { ok: [660, 880], bad: [220, 180], done: [523, 659, 784, 1047], combo: [784, 988, 1175] }[kind] || [440];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + i * 0.09;
      o.type = kind === "bad" ? "square" : "triangle"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.2);
    });
  } catch (_) {}
}
