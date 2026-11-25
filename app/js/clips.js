// Clip lab: loop short pieces of real Dominican speech from YouTube (Bilingüe Blogs, interviews,
// comedy...). Videos play through YouTube's own embedded player, so nothing is copied; your clips
// keep only the video id, start/end and your own transcript.
import { el, toast } from "./ui.js";
import * as store from "./store.js";
import { bestOf, diff } from "./match.js";
import { review } from "./srs.js";

let apiReady = null;
function ytApi() {
  if (!apiReady) apiReady = new Promise(res => {
    if (window.YT && YT.Player) return res();
    window.onYouTubeIframeAPIReady = res;
    document.head.append(el("script", { src: "https://www.youtube.com/iframe_api" }));
  });
  return apiReady;
}
export function videoId(url) {
  const m = /(?:youtu\.be\/|v=|shorts\/|embed\/)([\w-]{11})/.exec(url || "") || /^([\w-]{11})$/.exec((url || "").trim());
  return m ? m[1] : null;
}
const tParam = url => { const m = /[?&]t=(\d+)/.exec(url || ""); return m ? +m[1] : 0; };
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const parseT = s => { if (!s) return 0; const p = String(s).split(":").map(Number); return p.length === 2 ? p[0] * 60 + p[1] : +p[0] || 0; };

export function renderClips(view) {
  const clips = store.all("clip:").sort((a, b) => b.updated - a.updated);
  const url = el("input", { placeholder: "Paste a YouTube link", "aria-label": "YouTube link" });
  const add = el("button", { class: "btn go small", onclick: async () => {
    const id = videoId(url.value);
    if (!id) return toast("That doesn't look like a YouTube link.");
    const s = tParam(url.value);
    const rec = await store.put({ id: "clip:" + Date.now().toString(36), vid: id, start: s, end: s + 8, title: "", transcript: "" });
    openClip(view, rec);
  } }, "Add clip");
  view.replaceChildren(
    el("h1", {}, "Clip lab"),
    el("p", { class: "muted" }, "Real speech beats any synthetic voice. Grab 5–10 second pieces of Dominicans talking, loop them, slow them down, write what you hear, then turn the phrases into practice cards."),
    el("div", { class: "card row" }, url, add),
    el("div", { class: "card tips" }, el("b", {}, "Where to find clips"),
      el("ul", {},
        el("li", {}, el("a", { href: "https://www.youtube.com/results?search_query=bilingue+blogs+dominican+spanish", target: "_blank", rel: "noopener" }, "Bilingüe Blogs"), ": Dominican slang explained, with real examples"),
        el("li", {}, el("a", { href: "https://www.youtube.com/results?search_query=entrevista+calle+santo+domingo", target: "_blank", rel: "noopener" }, "Street interviews in Santo Domingo"), ": fast, natural, many voices"),
        el("li", {}, el("a", { href: "https://www.youtube.com/results?search_query=dominicanos+en+washington+heights", target: "_blank", rel: "noopener" }, "Dominicans in Washington Heights"), ": your neighborhood's accent"),
        el("li", {}, "Tip: copy the link at the right moment (Share → Start at) and the clip starts there."))),
    clips.length ? el("div", { class: "list" }, ...clips.map(c => el("button", { class: "list-row", onclick: () => openClip(view, c) },
      el("img", { src: `https://i.ytimg.com/vi/${c.vid}/mqdefault.jpg`, alt: "", loading: "lazy" }),
      el("div", {}, el("b", {}, c.title || "Untitled clip"), el("small", {}, `${fmt(c.start)}–${fmt(c.end)} · ${c.transcript ? "transcribed" : "no transcript yet"}`))))) : el("p", { class: "muted" }, "No clips yet."));
}

async function openClip(view, clip) {
  const box = el("div", { id: "yt" });
  const title = el("input", { value: clip.title || "", placeholder: "Name this clip", "aria-label": "Clip name" });
  const start = el("input", { value: fmt(clip.start), class: "t", "aria-label": "Start time" });
  const end = el("input", { value: fmt(clip.end), class: "t", "aria-label": "End time" });
  const rate = el("select", { "aria-label": "Speed" }, ...[0.5, 0.75, 1].map(r => el("option", { value: r, selected: r === 1 }, r + "×")));
  const loop = el("input", { type: "checkbox", checked: true });
  const transcript = el("textarea", { rows: 3, placeholder: "What they actually say (fill this in once you've got it, or paste captions)" }, clip.transcript || "");
  const dict = el("textarea", { rows: 2, placeholder: "Dictation: type what you hear, then Check" });
  const out = el("div", { class: "diff" });
  const es = el("input", { placeholder: "Phrase as you heard it" }), en = el("input", { placeholder: "What it means" });
  let player = null, iv = 0;
  const save = () => store.put({ ...clip, title: title.value, start: parseT(start.value), end: Math.max(parseT(start.value) + 1, parseT(end.value)), transcript: transcript.value }).then(r => (clip = r));
  [title, start, end, transcript].forEach(i => (i.onchange = save));
  const playClip = () => { if (!player) return; player.setPlaybackRate(+rate.value); player.seekTo(clip.start, true); player.playVideo(); };
  view.replaceChildren(
    el("button", { class: "link", onclick: () => { clearInterval(iv); renderClips(view); } }, "← All clips"),
    title, box,
    el("div", { class: "card controls" },
      el("button", { class: "btn go small", onclick: playClip }, "▶ Play clip"),
      el("label", {}, "Speed ", rate), el("label", {}, loop, " Loop"),
      el("div", { class: "row" }, el("label", {}, "From ", start), el("button", { class: "btn ghost small", onclick: () => { start.value = fmt(player.getCurrentTime()); save(); } }, "Set to now"),
        el("label", {}, "To ", end), el("button", { class: "btn ghost small", onclick: () => { end.value = fmt(player.getCurrentTime()); save(); } }, "Set to now"))),
    el("div", { class: "card" }, el("h3", {}, "Dictation"), dict,
      el("button", { class: "btn small", onclick: () => {
        if (!transcript.value.trim()) { out.textContent = "Add the transcript below first (or work it out with a native speaker / captions), then dictation can score you."; return; }
        const s = bestOf(dict.value, [transcript.value]);
        out.replaceChildren(el("b", {}, `${Math.round(s * 100)}% of the words. `), ...diff(dict.value, transcript.value).map(w => el("span", { class: w.ok ? "hit" : "miss" }, w.tok + " ")));
      } }, "Check"), out),
    el("div", { class: "card" }, el("h3", {}, "Transcript"), transcript),
    el("div", { class: "card" }, el("h3", {}, "Add a phrase to practice"), es, en,
      el("button", { class: "btn go small", onclick: async () => {
        if (!es.value.trim() || !en.value.trim()) return toast("Fill in both the phrase and its meaning.");
        const iid = "item:" + Date.now().toString(36);
        await store.put({ id: iid, es: es.value.trim(), fast: es.value.trim(), en: en.value.trim(), clip: { vid: clip.vid, start: clip.start, end: clip.end } });
        // due right away, so it comes up in the next practice
        await store.put({ ...review(null, 1), due: Date.now(), id: `card:${iid}:rec` });
        es.value = en.value = ""; toast("Added. It'll show up in Practice.");
      } }, "Add")),
    el("button", { class: "link danger", onclick: async () => { if (confirm("Delete this clip?")) { await store.put({ ...clip, deleted: true }); clearInterval(iv); renderClips(view); } } }, "Delete clip"));
  await ytApi();
  player = new YT.Player(box, { videoId: clip.vid, playerVars: { start: clip.start, rel: 0, playsinline: 1, cc_lang_pref: "es" }, width: "100%", height: "100%" });
  iv = setInterval(() => {
    if (!document.body.contains(view) || !player || !player.getCurrentTime) return;
    if (player.getPlayerState && player.getPlayerState() === 1 && player.getCurrentTime() >= clip.end) {
      if (loop.checked) { player.seekTo(clip.start, true); } else player.pauseVideo();
    }
  }, 200);
  rate.onchange = () => player && player.setPlaybackRate(+rate.value);
}
