"""Make the Dominican audio clips for every phrase and role-play line.

    python tools/gen-audio.py            (from the dimelo folder)

Uses edge-tts (pip install --user edge-tts), which reads text with Microsoft's free neural
voices: es-DO-EmilioNeural (-a.mp3) and es-DO-RamonaNeural (-b.mp3). Text is the "fast"
(spoken) form from js/content.js, so dropped sounds are actually dropped. Only new or changed
lines are regenerated; app/audio/manifest.json records what each file says.
"""
import asyncio, hashlib, json, pathlib, subprocess, sys
import edge_tts

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "app" / "audio"
VOICES = {"a": "es-DO-EmilioNeural", "b": "es-DO-RamonaNeural"}

DUMP = """
import(process.argv[1]).then(m => {
  const lines = m.ALL_ITEMS.map(i => [i.id, i.fast]).concat(m.DIALOGUE_LINES.map(t => [t.id, t.es]));
  process.stdout.write(JSON.stringify(lines));
});
"""

def spoken(text):
    # apostrophes only mark dropped sounds for the reader; a leading ' would be read oddly
    return text.replace("'", "").replace("’", "").replace("  ", " ").strip()

async def main():
    url = (ROOT / "app" / "js" / "content.js").as_uri()
    lines = json.loads(subprocess.check_output(["node", "-e", DUMP, url], text=True, encoding="utf-8"))
    OUT.mkdir(parents=True, exist_ok=True)
    mpath = OUT / "manifest.json"
    manifest = json.loads(mpath.read_text(encoding="utf-8")) if mpath.exists() else {}
    todo = []
    for id_, text in lines:
        h = hashlib.sha1(spoken(text).encode()).hexdigest()[:10]
        if manifest.get(id_) == h and all((OUT / f"{id_}-{v}.mp3").exists() for v in VOICES):
            continue
        todo.append((id_, text, h))
    print(f"{len(lines)} lines, {len(todo)} to generate")
    sem = asyncio.Semaphore(6)
    async def one(id_, text, h):
        async with sem:
            for v, voice in VOICES.items():
                for attempt in range(3):
                    try:
                        await edge_tts.Communicate(spoken(text), voice).save(str(OUT / f"{id_}-{v}.mp3"))
                        break
                    except Exception as e:
                        if attempt == 2: print("FAILED", id_, v, e); return
                        await asyncio.sleep(2)
            manifest[id_] = h
            print("ok", id_)
    await asyncio.gather(*(one(*t) for t in todo))
    keep = {i for i, _ in lines}
    for k in list(manifest):
        if k not in keep: del manifest[k]
    mpath.write_text(json.dumps(manifest, indent=0, sort_keys=True), encoding="utf-8")

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    asyncio.run(main())
