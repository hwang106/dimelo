// Forgiving comparison of what you typed or said against the target sentence.
// Spelling that sounds the same in Caribbean Spanish counts as right (b/v, s/z/c, ll/y, silent h,
// dropped final s/d, r/l at syllable end), because the skill being trained is hearing, not spelling.

const strip = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const EXPAND = { ta: "esta", tan: "estan", toy: "estoy", tamo: "estamos", taba: "estaba", pa: "para", pal: "para el",
  na: "nada", to: "todo", onde: "donde", ute: "usted", mija: "mi hija", mijo: "mi hijo", ombe: "hombre", manito: "hermanito",
  tato: "todo esta", poique: "porque", polque: "porque", dique: "dizque", toavia: "todavia", hata: "hasta", e: "es",
  klk: "que lo que", q: "que", xq: "porque", pq: "porque", tb: "tambien", d: "de" };

export function words(s) {
  return strip(s).replace(/['’]/g, "").replace(/[^a-zñ0-9 ]+/g, " ").split(/\s+/).filter(Boolean)
    .flatMap(w => (EXPAND[w] || w).split(" "));
}
// collapse spellings that sound alike
function sound(w) {
  return w.replace(/h/g, "").replace(/v/g, "b").replace(/z/g, "s").replace(/c([ei])/g, "s$1").replace(/qu/g, "k")
    .replace(/c/g, "k").replace(/ll/g, "y").replace(/x/g, "ks").replace(/g([ei])/g, "j$1").replace(/i([aeou])/g, "y$1")
    .replace(/ado$/, "ao").replace(/ida$/, "ia").replace(/[sd]$/, "").replace(/([aeiou])[rl]([^aeiou]|$)/g, "$1L$2")
    .replace(/s([^aeiou])/g, "$1").replace(/(.)\1+/g, "$1");
}
function lev(a, b) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
// word-level edit distance where near-identical words cost little
function wordLev(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const x = a[i - 1], y = b[j - 1];
      const sub = x === y ? 0 : Math.min(1, lev(x, y) / Math.max(x.length, y.length, 1) * 1.5);
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + sub);
    }
    prev = cur;
  }
  return prev[n];
}
// 0..1, 1 = same
export function similarity(answer, target) {
  const a = words(answer).map(sound), b = words(target).map(sound);
  if (!b.length) return 0;
  return Math.max(0, 1 - wordLev(a, b) / Math.max(a.length, b.length));
}
export const bestOf = (answer, targets) => Math.max(...targets.filter(Boolean).map(t => similarity(answer, t)));

// Which target words were missed (for showing what you didn't hear).
export function diff(answer, target) {
  const have = new Set(words(answer).map(sound));
  return target.split(/\s+/).map(tok => {
    const w = words(tok).map(sound);
    return { tok, ok: !w.length || w.every(x => have.has(x)) };
  });
}
