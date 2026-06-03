# ableton-strudel-extension

An [Ableton Live Extensions SDK](https://www.ableton.com/en/packs/extensions/) extension that evaluates [Strudel](https://strudel.cc) patterns directly into MIDI clips.

Write a Strudel pattern as a clip name, right-click, and the notes appear. Optionally use AI to generate patterns from natural language.

## Commands

Right-click a **MIDI clip**:
- **Evaluate as Strudel** — runs the clip name as a Strudel pattern and fills the clip with MIDI notes
- **Crystallize → Strudel pattern** — reads existing MIDI notes and asks AI to compress them into a Strudel mini-notation expression, stored as the clip name

Right-click a **clip slot**:
- **Create Strudel pattern…** — opens a dialog to type a pattern, creates the clip at the correct length
- **Generate with AI…** — describe what you want in natural language or music theory; AI generates the pattern, creates and fills the clip

## Clip name syntax

The clip name is a Strudel expression. Optionally append `@N` to set how many cycles to render:

```
note("c3 [e3 g3] a3").slow(2)           → 2 cycles (default)
note("c3 e3 g3 a3") @4                  → 4 cycles
note("<c3 eb3> <g3 bb3>").slow(4) @8    → 8 cycles
```

Since the pattern lives in the clip name, you can edit it and re-evaluate at any time. AI commands are never triggered by regular evaluation — they only fire when you explicitly choose the AI commands.

## Strudel pattern examples

```js
// Chord voicings, one per cycle
note("<[c3,e3,g3] [d3,f3,a3] [g3,b3,d4] [c3,e3,g3]>").slow(4)

// Arpeggio
note("c3 e3 g3 c4").fast(4)

// Rhythmic melody with rests
note("c4 ~ e4 [g4 a4] ~ f4 e4 ~").slow(2)

// Bass line
note("c2 ~ ~ c2 ~ g2 ~ ~").slow(2)

// Two-voice stack
note("c4 e4 g4").stack(note("c3").slow(4))
```

The generated pattern becomes the clip name so it's always visible and editable.

## Installation

Requires:
- Ableton Live with Extensions support (beta builds from the SDK release page)
- Node.js ≥ 24 (`nvm install 24 && nvm alias default 24`)
- The [Ableton Extensions SDK](https://www.ableton.com/en/extensions-sdk/) zip

```bash
git clone git@github.com:pstoica/ableton-strudel-extension.git
cd ableton-strudel-extension
npm install
```

Copy `.env.example` to `.env` and set your paths/keys:

```bash
cp .env.example .env
```

Edit `.env`:

```
EXTENSION_HOST_PATH=/Applications/Ableton Live 12 Beta.app/Contents/Helpers/ExtensionHost
# optional — only needed for AI commands
CLAUDE_API_KEY=sk-ant-...
# or
OPENAI_API_KEY=sk-...
```

In Ableton: **Settings → Extensions → Enable Developer Mode**

Then:

```bash
npm start
```

## AI commands

The AI commands (**Generate with AI…** and **Crystallize**) call Claude Haiku or GPT-4o mini — fast and cheap for short pattern generation. The project's current key and BPM are automatically included in the prompt so you don't need to specify them.

AI is only called when you explicitly choose an AI command. Regular evaluation (`Evaluate as Strudel`, `Create Strudel pattern…`) never makes API calls.

Set either `CLAUDE_API_KEY` or `OPENAI_API_KEY` in `.env`. Claude is preferred if both are set.

## Development

```bash
npm run build        # build once
npm start            # build + load into Live (keep running)
npm run build:prod   # minified production build
```

## Notes

- Pattern evaluation runs in a temporary browser context (localhost) so Strudel's full feature set is available
- The eval webview is tiny (480×64px) and closes itself automatically — you'll see it flash briefly
- CC/control patterns work in Strudel's own REPL via Web MIDI as normal; the SDK can only write note data to MIDI clips
- Clip loop length is set at creation time; to change it, delete and recreate the clip with a different `@N` suffix

## License

MIT
