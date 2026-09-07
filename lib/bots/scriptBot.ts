import { Bot, EditJob, ScenePlan, ProgressCallback } from "../types";
import { generateText, hasGemini } from "../gemini";

const PLATFORM_HINTS: Record<string, string> = {
  youtube: "16:9, up to 15 minutes, strong hook in first 30 s, can breathe more between cuts",
  tiktok: "9:16, 15-60 s, hook in first 3 s, very fast cuts, high energy",
  reels: "9:16, up to 90 s, captions important, punchy pacing",
};

/**
 * ScriptBot — turns a text script into a pacing-aware scene plan via Gemini:
 * varied shot durations, a transition choice per scene, an overall mood, and
 * a marked "hook" moment. Feeds CutterBot (durations), TransitionBot
 * (transition_out), and ColorBot (mood).
 */
export const ScriptBot: Bot = {
  name: "script_bot",
  async run(job: EditJob, progress: ProgressCallback): Promise<EditJob> {
    if (!job.script) {
      progress(this.name, "no script provided, skipping.");
      return job;
    }

    if (!hasGemini()) {
      progress(
        this.name,
        "no GOOGLE_API_KEY configured — skipping AI scene planning, using whole clips."
      );
      return job;
    }

    const hint = PLATFORM_HINTS[job.platform] ?? "";
    const prompt = `
You are an expert short-form video editor with a strong sense of pacing
and rhythm — not a mechanical scene-splitter. Given the script and
available clips, produce a creative, pacing-aware JSON scene plan.

Platform: ${job.platform} (${hint})
Editing style requested: ${job.style}
Available clips (by index): ${JSON.stringify(job.clips.map((c, i) => [i, c]))}

Script:
${job.script}

Guidelines for creativity:
- Vary scene durations deliberately: the hook/opening line should be
  short and punchy (2-4 s); mid-content can breathe more (5-10 s) if
  it's explaining something important, but stay snappy for "dynamic"
  style or fast platforms like TikTok.
- Choose a "transition_out" for EACH scene individually based on what's
  happening: use "cut" for punchy energetic moments, "dissolve" for
  reflective/calm moments, "fade" for a scene ending a thought or the
  final scene, "zoom" for emphasis/reveal moments, "wipe" or "slide" for
  a change of topic. Don't just repeat the same transition every time —
  vary it like a real editor would.
- Identify which single scene is the "hook" (the one designed to stop
  someone scrolling) by setting "is_hook": true on it.
- Set a top-level "mood" describing the overall energy in a few words
  (e.g. "high energy and upbeat", "calm and reflective", "dramatic and
  tense", "playful and quirky") based on the script's tone.
- Captions should be short, punchy, and specific to that scene's content
  — not generic labels like "Scene 1".

Return a JSON object with this shape (no markdown fences):
{
  "total_duration_s": <int>,
  "mood": "<short mood description>",
  "scenes": [
    {
      "scene_id": 1,
      "clip_index": 0,
      "start_s": 0,
      "end_s": 4,
      "caption": "specific, punchy caption for this moment",
      "transition_out": "cut" | "fade" | "dissolve" | "zoom" | "wipe" | "slide",
      "is_hook": true
    }
  ]
}`;

    const raw = await generateText("gemini-2.5-flash", prompt);
    if (!raw) {
      progress(this.name, "Gemini call failed — falling back to whole clips.");
      return job;
    }

    try {
      const cleaned = raw.replace(/```json/g, "").replace(/```/g, "").trim();
      const plan = JSON.parse(cleaned) as ScenePlan;
      if (!Array.isArray(plan.scenes)) throw new Error("no scenes[] in response");
      job.scenePlan = plan;
      progress(
        this.name,
        `generated ${plan.scenes.length} scenes (mood: ${plan.mood ?? "n/a"}).`
      );
    } catch (err) {
      progress(this.name, `failed to parse scene plan (${(err as Error).message}), skipping.`);
    }

    return job;
  },
};
