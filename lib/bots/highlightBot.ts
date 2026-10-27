import { Bot, EditJob, ProgressCallback, Scene } from "../types";
import { ffmpeg, FFMPEG, FFPROBE, ffprobeDuration } from "../ffmpeg";
import { generateText, transcribeAudio, hasGemini, getLastGeminiError, GEMINI_MODEL } from "../gemini";
import fs from "fs";
import path from "path";

// 5 minutes of 16 kHz mono WAV is ~9.6 MB, safely under the inline request cap.
const CHUNK_S = 300;
const MIN_SEGMENT_S = 1.5;
const VALID_TRANSITIONS = ["cut", "fade", "dissolve", "zoom", "wipe", "slide"];

const PLATFORM_HINTS: Record<string, string> = {
  youtube: "16:9, up to 15 minutes, strong hook in first 30 s",
  tiktok: "9:16, 15-60 s, hook in first 3 s, very fast cuts, high energy",
  reels: "9:16, up to 90 s, punchy pacing, strong hook in first 3 s",
};

interface Cue {
  clip: number;
  start: number;
  end: number;
  text: string;
}

interface RawSegment {
  clip_index?: number;
  start_s?: number;
  end_s?: number;
  caption?: string;
  transition_out?: string;
  is_hook?: boolean;
}

function fmtTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function parseTimestamp(ts: string): number | null {
  const m = ts.trim().match(/^(?:(\d+):)?(\d+):(\d+)(?:[,.](\d+))?$/);
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0;
  return h * 3600 + Number(m[2]) * 60 + Number(m[3]) + (m[4] ? Number("0." + m[4]) : 0);
}

function parseSrt(srt: string, offsetS: number, clip: number): Cue[] {
  const cues: Cue[] = [];
  const cleaned = srt.replace(/```[a-z]*/gi, "").replace(/\r/g, "");
  for (const block of cleaned.split(/\n{2,}/)) {
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const arrow = lines.findIndex((l) => l.includes("-->"));
    if (arrow === -1) continue;
    const [a, b] = lines[arrow].split("-->");
    const start = parseTimestamp(a);
    const end = parseTimestamp(b);
    const text = lines.slice(arrow + 1).join(" ");
    if (start === null || end === null || !text) continue;
    cues.push({ clip, start: start + offsetS, end: end + offsetS, text });
  }
  return cues;
}

/** Transcribes one clip in fixed-size audio chunks so long footage fits in
 * Gemini's inline request limit. Timestamps are shifted by each chunk's
 * offset so they refer to the original clip. */
async function transcribeClip(
  job: EditJob,
  clipIdx: number,
  totalS: number,
  progress: ProgressCallback,
  botName: string
): Promise<Cue[]> {
  const src = job.clips[clipIdx];
  const chunkPath = path.join(job.outputDir, "_highlight_chunk.wav");
  const nChunks = Math.ceil(totalS / CHUNK_S);
  const cues: Cue[] = [];
  let consecutiveFailures = 0;

  for (let c = 0; c < nChunks; c++) {
    const start = c * CHUNK_S;
    const len = Math.min(CHUNK_S, totalS - start);
    if (len < 2) continue;

    progress(botName, `transcribing clip ${clipIdx + 1}, part ${c + 1}/${nChunks}…`);
    try {
      await ffmpeg([
        "-ss",
        String(start),
        "-t",
        String(len),
        "-i",
        src,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        chunkPath,
      ]);
    } catch {
      progress(botName, `could not extract audio for part ${c + 1}, skipping it.`);
      continue;
    }

    const buf = fs.readFileSync(chunkPath);
    fs.rmSync(chunkPath, { force: true });
    const srt = await transcribeAudio(buf.toString("base64"), "audio/wav");

    if (srt === null) {
      consecutiveFailures++;
      progress(
        botName,
        `transcription of part ${c + 1} failed (${getLastGeminiError() ?? "unknown error"}).`
      );
      if (consecutiveFailures >= 2) {
        progress(botName, "two failures in a row, giving up on this clip.");
        break;
      }
      continue;
    }
    consecutiveFailures = 0;
    cues.push(...parseSrt(srt, start, clipIdx));
  }
  return cues;
}

/**
 * HighlightBot — picks the best moments out of long footage when the user
 * asked for a target length but there is no script-based scene plan.
 * It transcribes the audio in chunks, gives Gemini the timestamped
 * transcript plus the target length, and turns the moments it chooses into
 * a ScenePlan that CutterBot, TransitionBot and ColorBot already understand.
 * Limitation: it only "sees" speech, so silent action scenes are invisible.
 */
export const HighlightBot: Bot = {
  name: "highlight_bot",
  async run(job: EditJob, progress: ProgressCallback): Promise<EditJob> {
    const target = job.targetDurationS;
    if (!target) {
      progress(this.name, "no target length set, skipping.");
      return job;
    }
    if (job.scenePlan.scenes.length > 0) {
      progress(this.name, "scene plan already exists, skipping.");
      return job;
    }
    if (!FFMPEG || !FFPROBE) {
      progress(this.name, "ffmpeg/ffprobe not found, skipping.");
      return job;
    }
    if (!hasGemini()) {
      progress(this.name, "no GOOGLE_API_KEY configured, can't pick highlights.");
      return job;
    }

    const durations: number[] = [];
    const cues: Cue[] = [];
    for (let i = 0; i < job.clips.length; i++) {
      const dur = await ffprobeDuration(job.clips[i]);
      durations.push(dur);
      cues.push(...(await transcribeClip(job, i, dur, progress, this.name)));
    }

    if (cues.length === 0) {
      progress(
        this.name,
        "no usable transcript (no speech, or transcription failed), so there is nothing to pick highlights from."
      );
      return job;
    }

    const multi = job.clips.length > 1;
    const transcript = cues
      .map((c) => `[${multi ? `clip ${c.clip} ` : ""}${fmtTime(c.start)}] ${c.text}`)
      .join("\n");

    progress(this.name, `transcript ready (${cues.length} lines). Asking Gemini for ~${target}s of highlights…`);

    const hint = PLATFORM_HINTS[job.platform] ?? "";
    const minTotal = Math.round(target * 0.85);
    const prompt = `
You are an expert short-form video editor. Below is a timestamped transcript
of the source footage. Choose the moments that make the best ${job.platform}
video of about ${target} seconds.

Platform: ${job.platform} (${hint})
Editing style requested: ${job.style}
Clips are numbered from 0. ${multi ? "Timestamps are shown as [clip N mm:ss]." : "There is one clip (clip_index 0); timestamps are [mm:ss]."}
${job.script ? `Extra direction from the user:\n${job.script}\n` : ""}
Rules:
- The segment durations (end_s - start_s) must add up to between ${minTotal} and ${target} seconds.
- Each segment is one continuous range, 4 to 15 seconds long, that starts and
  ends on natural speech boundaries (use the transcript timestamps; never cut
  mid-sentence). start_s and end_s are in seconds from the start of that clip.
- Prefer moments with emotional peaks, reveals, conflict, or memorable lines.
- Open with the strongest hook (it may come from later in the footage).
  Otherwise keep segments in chronological order so the story makes sense.
- Choose "transition_out" per segment from: "cut", "fade", "dissolve", "zoom",
  "wipe", "slide". Mostly "cut" for fast pacing.
- Give each segment a short, specific caption.
- Set "is_hook": true on exactly one segment, and give a short top-level "mood".

Return ONLY a JSON object, no markdown fences:
{
  "mood": "dramatic and tense",
  "segments": [
    { "clip_index": 0, "start_s": 125.0, "end_s": 134.5, "caption": "...", "transition_out": "cut", "is_hook": true }
  ]
}

Transcript:
${transcript}`;

    const raw = await generateText(GEMINI_MODEL, prompt);
    if (!raw) {
      progress(
        this.name,
        `Gemini call failed (${getLastGeminiError() ?? "empty response"}), no highlights picked.`
      );
      return job;
    }

    let parsed: { mood?: string; segments?: RawSegment[] };
    try {
      const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
      const first = cleaned.indexOf("{");
      const last = cleaned.lastIndexOf("}");
      parsed = JSON.parse(first >= 0 && last > first ? cleaned.slice(first, last + 1) : cleaned);
    } catch (err) {
      progress(this.name, `could not parse Gemini's answer (${(err as Error).message}), no highlights picked.`);
      return job;
    }

    // Validate against the real clip lengths and hold the total near the target.
    const limit = target * 1.1;
    let used = 0;
    const scenes: Scene[] = [];
    for (const seg of parsed.segments ?? []) {
      const clip = Number.isInteger(seg.clip_index) ? (seg.clip_index as number) : 0;
      if (clip < 0 || clip >= job.clips.length) continue;
      let start = Number(seg.start_s);
      let end = Number(seg.end_s);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      start = Math.max(0, start);
      end = Math.min(durations[clip], end);

      // Gemini sometimes picks overlapping ranges. Trim each new pick so it
      // never repeats footage already chosen from the same clip.
      for (const prev of scenes) {
        if (prev.clip_index !== clip) continue;
        const prevEnd = prev.end_s ?? prev.start_s;
        if (start < prevEnd && end > prev.start_s) {
          if (start >= prev.start_s) start = prevEnd;
          else end = prev.start_s;
        }
      }
      if (end - start < MIN_SEGMENT_S) continue;

      const remaining = limit - used;
      if (remaining < MIN_SEGMENT_S) break;
      if (end - start > remaining) end = start + remaining;
      used += end - start;

      const transition = VALID_TRANSITIONS.includes(seg.transition_out ?? "")
        ? (seg.transition_out as Scene["transition_out"])
        : "cut";
      scenes.push({
        scene_id: scenes.length + 1,
        clip_index: clip,
        start_s: start,
        end_s: end,
        caption: typeof seg.caption === "string" ? seg.caption : undefined,
        transition_out: transition,
        is_hook: seg.is_hook === true,
      });
    }

    if (scenes.length === 0) {
      progress(this.name, "Gemini returned no usable segments, no highlights picked.");
      return job;
    }

    job.scenePlan = {
      total_duration_s: Math.round(used),
      mood: typeof parsed.mood === "string" ? parsed.mood : undefined,
      scenes,
    };

    progress(this.name, `picked ${scenes.length} moments, ${Math.round(used)}s total:`);
    for (const s of scenes) {
      progress(
        this.name,
        `  #${s.scene_id} clip ${s.clip_index + 1} ${fmtTime(s.start_s)}-${fmtTime(s.end_s ?? s.start_s)}${s.caption ? ` "${s.caption}"` : ""}`
      );
    }
    if (used < target * 0.5) {
      progress(this.name, `warning: only ${Math.round(used)}s found for a ${target}s target.`);
    }
    return job;
  },
};
