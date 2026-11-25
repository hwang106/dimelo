// Role-play player: "them" lines play as audio (text hidden until you ask), you answer by
// tapping or saying one of the replies.
import { el, shuffle } from "./ui.js";
import * as audio from "./audio.js";
import * as store from "./store.js";
import * as P from "./progress.js";
import { bestOf } from "./match.js";

export function runDialogue(d, { onDone }) {
  const root = el("section", { class: "lesson dialogue", role: "dialog", "aria-label": d.title });
  const chat = el("div", { class: "chat" });
  const foot = el("footer", { class: "lfoot" });
  root.append(el("header", { class: "lhead" }, el("button", { class: "icon-btn close", "aria-label": "Quit", onclick: () => end(true) }, "✕"),
    el("div", { class: "d-title" }, el("b", {}, d.title), el("small", {}, d.scene))), chat, foot);
  document.body.append(root); document.body.classList.add("in-lesson");
  let t = 0, right = 0, wrong = 0; const start = Date.now();
  const rate = () => store.settings().speed;

  function bubble(turn) {
    const txt = el("div", { class: "b-text hidden" }, turn.es);
    const en = el("div", { class: "b-en hidden" }, turn.en);
    const b = el("div", { class: "bubble them" },
      el("div", { class: "b-ctl" },
        el("button", { class: "icon-btn", "aria-label": "Play", onclick: () => audio.play(turn.id, turn.es, { rate: rate() }) }, "🔊"),
        el("button", { class: "icon-btn", "aria-label": "Play slowly", onclick: () => audio.play(turn.id, turn.es, { rate: 0.7 }) }, "🐢"),
        el("button", { class: "link", onclick: e => { txt.classList.toggle("hidden"); e.target.textContent = txt.classList.contains("hidden") ? "Show text" : "Hide text"; } }, "Show text"),
        el("button", { class: "link", onclick: () => en.classList.toggle("hidden") }, "English")),
      txt, en);
    chat.append(b); b.scrollIntoView({ behavior: "smooth", block: "end" });
    return audio.play(turn.id, turn.es, { rate: rate() });
  }
  async function step() {
    if (t >= d.turns.length) return end();
    const turn = d.turns[t];
    if (turn.who === "them") { await bubble(turn); t++; return step(); }
    const opts = shuffle(turn.options);
    let missed = false;
    const list = el("div", { class: "opts" });
    const choose = o => {
      if (!o.ok) { wrong += missed ? 0 : 1; missed = true; audio.sfx("bad"); const b = list.children[opts.indexOf(o)]; b.classList.add("wrong"); b.disabled = true; foot.querySelector(".fbline").textContent = "✗ " + o.fb; return; }
      if (!missed) right++;
      audio.sfx("ok");
      chat.append(el("div", { class: "bubble me" }, o.es, el("div", { class: "b-fb" }, "✓ " + o.fb)));
      audio.say(o.es, { rate: 1.05 });
      t++; foot.replaceChildren(); setTimeout(step, 900);
    };
    opts.forEach(o => list.append(el("button", { class: "opt", onclick: () => choose(o) }, o.es)));
    const mic = audio.canListen && store.settings().micOn ? el("button", { class: "btn ghost small" }, "🎙️ Say it instead") : null;
    if (mic) mic.onclick = async () => {
      mic.textContent = "Listening…";
      try {
        const alts = await audio.listen();
        const said = alts[0] || "";
        const scored = opts.map(o => ({ o, s: Math.max(...alts.map(a => bestOf(a, [o.es])), 0) })).sort((a, b) => b.s - a.s);
        mic.textContent = "🎙️ Say it instead";
        if (scored[0].s >= 0.6) choose(scored[0].o);
        else foot.querySelector(".fbline").textContent = said ? `Heard “${said}” — try again or tap a reply.` : "Didn't catch that.";
      } catch (_) { mic.textContent = "Mic unavailable"; }
    };
    foot.className = "lfoot";
    foot.replaceChildren(el("div", { class: "reply" }, el("h3", {}, "Your reply"), list, mic, el("div", { class: "fbline", "aria-live": "polite" })));
  }
  async function end(quit = false) {
    audio.stop();
    if (!quit) {
      const earned = 10 + right * 2;
      await P.addToday({ xp: earned, secs: Math.round((Date.now() - start) / 1000), lessons: 1, cheles: 5 });
      audio.sfx("done");
      foot.replaceChildren(el("div", { class: "done small" }, el("h2", {}, wrong ? "¡Bien hecho!" : "¡Perfecto!"), el("p", {}, `+${earned} XP · ${right}/${right + wrong} first-try replies`)),
        el("button", { class: "btn go", onclick: () => { cleanup(); onDone && onDone({ right, wrong }); } }, "Continue"));
    } else { cleanup(); onDone && onDone({ quit: true }); }
  }
  function cleanup() { root.remove(); document.body.classList.remove("in-lesson"); }
  step();
}
