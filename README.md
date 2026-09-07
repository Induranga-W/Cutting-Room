# Cutting Room

An automated short-form video editing pipeline — upload raw clips, hand
them to a chain of specialist bots, get back a scripted, cut, captioned,
mixed, color-graded, platform-ready export.

This is a full Next.js rewrite of the original Python/FastAPI tool: no
Python, no moviepy, no Whisper. Video processing runs through your
system's `ffmpeg`/`ffprobe`, and the AI steps (scene planning, color
choice, transcription) run through Google's Gemini API.

## Pipeline

```
script → cutter → transitions → captions → audio mix → color grade → export
```

- **Script** *(only if you provide a script)* — Gemini turns it into a
  pacing-aware scene plan: shot durations, a transition per cut, an
  overall mood, and a marked "hook" moment.
- **Cutter** — trims each clip to its scene in/out points (or the whole
  clip if there's no script) and normalizes resolution/fps for the
  target platform.
- **Transitions** — joins the cut segments with real per-cut ffmpeg
  `xfade`/`acrossfade` transitions (cut, fade, dissolve, zoom, wipe,
  slide) chosen per scene.
- **Captions** — transcribes the speech with Gemini's audio input and
  burns captions in with ffmpeg's `subtitles` filter.
- **Audio mix** — mixes in background music with ducking under speech,
  or just loudness-normalizes the dialogue if no music was given.
- **Color grade** — Gemini picks a look (vibrant, cinematic, moody,
  clean, …) based on platform, style, and the script's mood; applied via
  ffmpeg color filters.
- **Export** — final render at the right resolution/bitrate for
  YouTube (1080p 16:9), TikTok, or Reels (1080×1920 9:16).

Every AI-dependent step falls back gracefully (whole clips, a sensible
default look, no captions) if `GOOGLE_API_KEY` isn't set or a Gemini
call fails — the pipeline never hard-crashes for lack of a key.

## Requirements

- Node.js 20+
- `ffmpeg` and `ffprobe` on your `PATH` (built with `--enable-libass`
  for caption burn-in — the common Homebrew/apt builds already are)
- A [Google AI Studio](https://aistudio.google.com/apikey) API key, for
  the script/caption/color steps (optional — the app still runs and
  produces a cut, captionless, default-graded export without one)

## Setup

```bash
npm install
cp .env.local.example .env.local
```

Edit `.env.local` and add your key:

```
GOOGLE_API_KEY="your-key-here"
```

## Run

```bash
npm run dev
```

Open http://localhost:3000, upload one or more clips, optionally add a
script and background music, pick a platform and style, and start the
cut. Progress streams into the pipeline view and edit log; when it's
done, preview and download the final file.

For a production run:

```bash
npm run build
npm start
```

## Notes

- This is a local, single-user tool: uploads and rendered output are
  stored on disk under `data/uploads/` and `data/output/`, and job
  status lives in server memory for the life of the process (same
  trade-off as the original's in-memory job dict).
- Large uploads: Next.js route handlers don't impose their own body-size
  cap, but if you deploy behind a platform that does (e.g. a serverless
  host), raise or bypass that limit — this app is built to be run as a
  long-lived Node server (`npm start`), not on serverless functions,
  since jobs run in the background after the request returns.
- `data/uploads` and `data/output` are gitignored; only `.gitkeep`
  placeholders are tracked.
