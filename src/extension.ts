import http from "node:http";
import https from "node:https";
import {
  initialize,
  MidiClip,
  MidiTrack,
  ClipSlot,
  type ActivationContext,
  type ClipSlotSelection,
  type Handle,
  type NoteDescription,
} from "@ableton-extensions/sdk";
import evalHtml      from "./eval.html";
import promptHtml    from "./prompt.html";
import strudelBundle from "./strudel-bundle.js";

// ─── Config ────────────────────────────────────────────────────────────────
// Set one of these in .env (or hard-code for now):
//   CLAUDE_API_KEY=sk-ant-...
//   OPENAI_API_KEY=sk-...
const CLAUDE_KEY = process.env["CLAUDE_API_KEY"]  ?? "";
const OPENAI_KEY = process.env["OPENAI_API_KEY"]  ?? "";

// ─── Types ──────────────────────────────────────────────────────────────────
interface EvalResult {
  ok: boolean;
  notes: NoteDescription[];
  totalBeats: number;
  error?: string;
}

// ─── Localhost server ────────────────────────────────────────────────────────
function serve(html: string): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(
      (req: http.IncomingMessage, res: http.ServerResponse) => {
        // Serve the pre-built Strudel bundle at /strudel.js (no CDN needed)
        if (req.url?.startsWith("/strudel.js")) {
          res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
          res.end(strudelBundle);
        } else {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(html);
        }
      },
    );
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
    server.on("error", reject);
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function parseClipName(name: string): { pattern: string; cycles: number } {
  const m = name.match(/^(.*?)\s*@(\d+(?:\.\d+)?)\s*$/);
  if (m && m[1] != null && m[2] != null)
    return { pattern: m[1].trim(), cycles: parseFloat(m[2]) };
  return { pattern: name.trim(), cycles: 2 };
}

async function evalPattern(
  pattern: string,
  cycles: number,
  bpm: number,
): Promise<EvalResult> {
  const server = await serve(evalHtml);
  const url = `${server.url}?pattern=${encodeURIComponent(pattern)}&cycles=${cycles}&bpm=${bpm}`;
  // Tiny 480×64 modal — shows a spinner and closes itself
  // (we reuse the existing evalHtml which already calls close_and_send)
  let raw: string;
  try {
    raw = await (server as unknown as { context: { ui: { showModalDialog: (u: string, w: number, h: number) => Promise<string> } } }).context.ui.showModalDialog(url, 480, 64);
  } finally {
    server.close();
  }
  return JSON.parse(raw) as EvalResult;
}

// ─── AI pattern generation ───────────────────────────────────────────────────
const STRUDEL_SYSTEM = `You are a Strudel pattern generator. Strudel is a live-coding music environment.
Return ONLY a valid Strudel expression — no explanation, no markdown, no quotes around it.

Core syntax:
  note("c3 e3 g3")          sequence of notes
  note("c3 [e3 g3] a3")     subdivision: [e3 g3] plays in the time of one step
  note("<c3 e3> <g3 a3>")   alternation: each cycle picks the next option
  note("c3 e3").fast(2)      double speed
  note("c3 e3").slow(2)      half speed
  .jux(rev)                  left channel normal, right channel reversed
  .stack(note("g2").slow(4)) layer multiple patterns
  .gain(0.8)                 overall volume
  silence                    rest

Note names: c d e f g a b with sharps (#) and octave number (c3 = middle C).
Chords: note("<[c3,e3,g3] [d3,f3,a3]>")  — commas = simultaneous notes.

Examples:
  ii-V-I in C, 2 bars each:   note("<[d3,f3,a3] [g3,b3,d4] [c3,e3,g3]>").slow(6)
  funky bass pattern:         note("c2 ~ c2 [e2 g2]").fast(2)
  ambient pad, 4 bars:        note("<c3 eb3 g3 bb3>").slow(8).gain(0.6)
  melodic sequence with gap:  note("c4 e4 g4 ~ b4 a4").slow(3)

For drum/sample patterns, use:  s("bd ~ sd ~")
For arpeggios:                  note("c3 e3 g3 c4").fast(4)

Keep it concise. Prefer mini notation over long method chains.`;

async function aiGeneratePattern(prompt: string): Promise<string> {
  if (CLAUDE_KEY) {
    // Claude API
    const body = JSON.stringify({
      model: "claude-haiku-4-5",  // fast + cheap; patterns are short
      max_tokens: 256,
      system: STRUDEL_SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = await httpPost("api.anthropic.com", "/v1/messages", body, {
      "x-api-key": CLAUDE_KEY,
      "anthropic-version": "2023-06-01",
    });
    const resp = JSON.parse(raw) as { content: Array<{ text: string }> };
    return resp.content[0]?.text?.trim() ?? "";
  }
  if (OPENAI_KEY) {
    // OpenAI API
    const body = JSON.stringify({
      model: "gpt-4o-mini",  // fast + cheap
      max_tokens: 256,
      messages: [
        { role: "system", content: STRUDEL_SYSTEM },
        { role: "user",   content: prompt },
      ],
    });
    const raw = await httpPost("api.openai.com", "/v1/chat/completions", body, {
      "Authorization": `Bearer ${OPENAI_KEY}`,
    });
    const resp = JSON.parse(raw) as { choices: Array<{ message: { content: string } }> };
    return resp.choices[0]?.message?.content?.trim() ?? "";
  }
  throw new Error("No API key set. Add CLAUDE_API_KEY or OPENAI_API_KEY to .env");
}

function httpPost(
  host: string, path: string, body: string,
  extraHeaders: Record<string, string> = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { host, path, method: "POST", headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        ...extraHeaders,
      }},
      res => {
        let data = "";
        res.on("data", chunk => { data += chunk; });
        res.on("end", () => resolve(data));
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ─── Shared eval+write logic ─────────────────────────────────────────────────
async function evalAndWrite(
  context: ReturnType<typeof initialize>,
  pattern: string,
  cycles: number,
  bpm: number,
  target: { writeNotes: (notes: NoteDescription[]) => Promise<void> },
): Promise<void> {
  const evalServer = await serve(evalHtml);
  const evalUrl = `${evalServer.url}?pattern=${encodeURIComponent(pattern)}&cycles=${cycles}&bpm=${bpm}`;
  let raw: string;
  try {
    raw = await context.ui.showModalDialog(evalUrl, 480, 64);
  } finally {
    evalServer.close();
  }
  const result = JSON.parse(raw) as EvalResult;
  if (!result.ok) {
    console.error(`[strudel] eval error for pattern "${pattern}":`, result.error);
    return;
  }
  if (!result.notes.length) {
    const d = (result as unknown as Record<string,unknown>)._debug as Record<string,unknown> | undefined;
    console.warn(`[strudel] "${pattern}" produced no notes (${cycles} cycles @ ${bpm} bpm). events=${d?.eventCount}, firstValue=${JSON.stringify(d?.firstValue)}`);
    return;
  }
  console.log(`[strudel] "${pattern}" → ${result.notes.length} notes, ${result.totalBeats} beats`);
  await target.writeNotes(result.notes);
}

// ─── Prompt dialog helper ─────────────────────────────────────────────────────
async function showPrompt(
  context: ReturnType<typeof initialize>,
  mode: "create" | "ai",
  existing = "",
): Promise<string | null> {
  const server = await serve(promptHtml);
  const url = `${server.url}?mode=${mode}&existing=${encodeURIComponent(existing)}`;
  let raw: string;
  try {
    raw = await context.ui.showModalDialog(url, 540, 140);
  } finally {
    server.close();
  }
  const { value } = JSON.parse(raw) as { value: string | null };
  return value;
}

// ─── Song context helpers ────────────────────────────────────────────────────
const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

interface SongKey {
  bpm: number;
  rootNote: number;       // 0–11
  rootName: string;       // "C", "F#", etc.
  scaleName: string;      // "Major", "Minor", etc.
  scaleMode: boolean;     // whether scale mode is on
  scaleIntervals: number[];
  summary: string;        // human-readable, e.g. "F# Minor (scale mode off)"
}

function getSongKey(context: ReturnType<typeof initialize>): SongKey {
  const song = context.application.song;
  const rootNote = song.rootNote % 12;
  const rootName = NOTE_NAMES[rootNote] ?? "C";
  const scaleName = song.scaleName;
  const scaleMode = song.scaleMode;
  const summary = scaleMode
    ? `${rootName} ${scaleName}`
    : `${rootName} ${scaleName} (scale mode off — use your judgement)`;
  return { bpm: song.tempo, rootNote, rootName, scaleName, scaleMode, scaleIntervals: song.scaleIntervals, summary };
}

// ─── Extension entry ──────────────────────────────────────────────────────────
export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");
  const bpm = () => context.application.song.tempo;

  // 1. Evaluate clip name in-place (existing MidiClip)
  context.commands.registerCommand("strudel.eval", async (arg: unknown) => {
    const clip = context.getObjectFromHandle(arg as Handle, MidiClip);
    const { pattern, cycles } = parseClipName(clip.name);
    if (!pattern) return;
    await evalAndWrite(context, pattern, cycles, bpm(), {
      writeNotes: async (notes) => {
        await context.withinTransaction(async () => {
          clip.notes = notes; clip.looping = true;
        });
      },
    });
  });

  // 2. Create a new clip from a pattern typed in a dialog (ClipSlot)
  context.commands.registerCommand("strudel.create", async (arg: unknown) => {
    const slot = context.getObjectFromHandle(arg as Handle, ClipSlot);
    const input = await showPrompt(context, "create");
    if (!input) return;
    const { pattern, cycles } = parseClipName(input);
    if (!pattern) return;

    // Evaluate first so we know the clip length, then create + fill
    const evalServer = await serve(evalHtml);
    const evalUrl = `${evalServer.url}?pattern=${encodeURIComponent(pattern)}&cycles=${cycles}&bpm=${bpm()}`;
    let raw: string;
    try { raw = await context.ui.showModalDialog(evalUrl, 480, 64); }
    finally { evalServer.close(); }
    const result = JSON.parse(raw) as EvalResult;
    if (!result.ok || !result.notes.length) return;

    await context.withinTransaction(async () => {
      const clip = await slot.createMidiClip(result.totalBeats);
      clip.name = input;
      clip.notes = result.notes;
      clip.looping = true;
    });
  });

  // 3. AI prompt → Strudel pattern → new clip (ClipSlot)
  context.commands.registerCommand("strudel.ai", async (arg: unknown) => {
    const slot = context.getObjectFromHandle(arg as Handle, ClipSlot);
    const prompt = await showPrompt(context, "ai");
    if (!prompt) return;

    const key = getSongKey(context);
    const contextualPrompt =
      `Project key: ${key.summary}\nBPM: ${key.bpm}\n\n${prompt}`;

    let pattern: string;
    try { pattern = await aiGeneratePattern(contextualPrompt); }
    catch (e) { console.error("AI error:", e); return; }
    if (!pattern) return;

    // Default 2 cycles; user can re-evaluate with @N in the clip name later
    const cycles = 2;
    const evalServer = await serve(evalHtml);
    const evalUrl = `${evalServer.url}?pattern=${encodeURIComponent(pattern)}&cycles=${cycles}&bpm=${bpm()}`;
    let raw: string;
    try { raw = await context.ui.showModalDialog(evalUrl, 480, 64); }
    finally { evalServer.close(); }
    const result = JSON.parse(raw) as EvalResult;
    if (!result.ok || !result.notes.length) return;

    await context.withinTransaction(async () => {
      const clip = await slot.createMidiClip(result.totalBeats);
      // Store the generated pattern as the clip name — re-evaluate anytime
      clip.name = pattern;
      clip.notes = result.notes;
      clip.looping = true;
    });
  });

  // 4. "Crystallize" — read notes from an existing clip, ask AI to
  //    compress them into a Strudel mini-notation pattern, store as name
  context.commands.registerCommand("strudel.crystallize", async (arg: unknown) => {
    const clip = context.getObjectFromHandle(arg as Handle, MidiClip);
    const existing = clip.notes;
    if (!existing.length) return;

    const key = getSongKey(context);
    const noteLines = existing
      .map(n => `pitch=${n.pitch} start=${n.startTime.toFixed(3)} dur=${n.duration.toFixed(3)} vel=${n.velocity ?? 90}`)
      .join("\n");
    const prompt =
      `Convert these MIDI notes into a concise Strudel mini-notation pattern.\n` +
      `BPM: ${key.bpm}. Project key: ${key.summary}.\n` +
      `Notes (beat positions):\n${noteLines}\n\n` +
      `Return only the Strudel expression. Prefer mini notation over long chains.`;

    let pattern: string;
    try { pattern = await aiGeneratePattern(prompt); }
    catch (e) { console.error("AI error:", e); return; }
    if (!pattern) return;

    await context.withinTransaction(async () => { clip.name = pattern; });
    console.log("Crystallized →", pattern);
  });

  // 5. Batch eval — selected clip slots (Cmd+click to multi-select in session view)
  context.commands.registerCommand("strudel.evalSelection", async (arg: unknown) => {
    const sel = arg as ClipSlotSelection;
    const clips: MidiClip<"1.0.0">[] = [];
    for (const handle of sel.selected_clip_slots) {
      const slot = context.getObjectFromHandle(handle, ClipSlot);
      const clip = slot.clip;
      if (clip instanceof MidiClip && clip.name.trim()) clips.push(clip);
    }
    if (!clips.length) return;
    console.log(`[strudel] evaluating ${clips.length} selected clips`);
    for (const clip of clips) {
      const { pattern, cycles } = parseClipName(clip.name);
      if (!pattern) continue;
      await evalAndWrite(context, pattern, cycles, bpm(), {
        writeNotes: async (notes) => {
          await context.withinTransaction(async () => { clip.notes = notes; clip.looping = true; });
        },
      });
    }
  });

  // 6. Batch eval — all arrangement clips on a MIDI track
  context.commands.registerCommand("strudel.evalTrack", async (arg: unknown) => {
    const track = context.getObjectFromHandle(arg as Handle, MidiTrack);
    const clips = track.arrangementClips.filter(
      (c): c is MidiClip<"1.0.0"> => c instanceof MidiClip && !!c.name.trim(),
    );
    if (!clips.length) return;
    console.log(`[strudel] evaluating ${clips.length} clips on track`);
    for (const clip of clips) {
      const { pattern, cycles } = parseClipName(clip.name);
      if (!pattern) continue;
      await evalAndWrite(context, pattern, cycles, bpm(), {
        writeNotes: async (notes) => {
          await context.withinTransaction(async () => { clip.notes = notes; clip.looping = true; });
        },
      });
    }
  });

  // ── Context menu registrations ────────────────────────────────────────────
  context.ui.registerContextMenuAction("MidiClip", "Evaluate as Strudel",           "strudel.eval");
  context.ui.registerContextMenuAction("ClipSlot",  "Create Strudel pattern…",       "strudel.create");
  context.ui.registerContextMenuAction("ClipSlot",  "Generate with AI…",             "strudel.ai");
  context.ui.registerContextMenuAction("MidiClip",        "Crystallize → Strudel pattern",  "strudel.crystallize");
  context.ui.registerContextMenuAction("ClipSlotSelection","Evaluate selection as Strudel",  "strudel.evalSelection");
  context.ui.registerContextMenuAction("MidiTrack",        "Evaluate all clips as Strudel",  "strudel.evalTrack");
}
