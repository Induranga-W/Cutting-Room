import { Bot, EditJob, ProgressCallback } from "../types";
import { ffmpeg, FFMPEG } from "../ffmpeg";
import { generateText, hasGemini, GEMINI_MODEL } from "../gemini";
import path from "path";

const LOOKS: Record<string, string> = {
  cinematic:
    "curves=r='0/0 0.2/0.15 0.8/0.75 1/1':g='0/0 0.1/0.05 0.9/0.90 1/1':b='0/0.05 0.5/0.55 1/0.95',colorbalance=ss=-0.05:ms=0.05,vignette=angle=PI/5",
  vibrant: "eq=saturation=1.4:contrast=1.05:brightness=0.02,hue=s=1.2",
  warm: "colortemperature=temperature=7500,eq=saturation=1.1",
  cool: "colortemperature=temperature=5000,eq=saturation=1.05",
  vintage: "curves=r='0/0.05 1/0.9':b='0/0 1/0.85',vignette=angle=PI/4",
  clean: "eq=saturation=1.05:contrast=1.02",
  dynamic: "eq=saturation=1.2:contrast=1.08,unsharp=5:5:0.8:3:3:0",
  moody:
    "curves=r='0/0 1/0.9':g='0/0 1/0.9':b='0/0.05 1/1',eq=contrast=1.15:saturation=0.85,vignette=angle=PI/3",
  high_energy: "eq=saturation=1.5:contrast=1.15:brightness=0.03,unsharp=5:5:1.0:3:3:0",
  soft: "eq=saturation=0.95:contrast=0.95:brightness=0.02,gblur=sigma=0.3",
};

const PLATFORM_DEFAULTS: Record<string, string> = {
  youtube: "clean",
  tiktok: "vibrant",
  reels: "warm",
};

async function chooseLook(style: string, platform: string, mood: string): Promise<string> {
  const fallback = PLATFORM_DEFAULTS[platform] ?? "clean";
  if (!hasGemini()) return fallback;

  const prompt = `
Pick the single best colour grading look for a short-form video.

Platform: ${platform}
Editing style: ${style}
Script mood/energy (if known): ${mood || "unknown"}

Available looks: ${JSON.stringify(Object.keys(LOOKS))}

Consider: TikTok/Reels favour punchy, saturated looks that stop the scroll.
YouTube long-form favours cleaner, more neutral grading unless the mood is
dramatic. A "calm" or reflective mood suits moody/soft/cinematic looks.
A "high energy" or "exciting" mood suits vibrant/dynamic/high_energy looks.

Return ONLY the look name as plain text, nothing else. Example: vibrant`;

  const raw = await generateText(GEMINI_MODEL, prompt);
  if (!raw) return fallback;
  const look = raw.trim().replace(/^["']|["']$/g, "").toLowerCase();
  return look in LOOKS ? look : fallback;
}

/** ColorBot — applies a colour grade chosen by Gemini based on style,
 * platform, and mood (falls back to a sensible per-platform default). */
export const ColorBot: Bot = {
  name: "color_bot",
  async run(job: EditJob, progress: ProgressCallback): Promise<EditJob> {
    const source = job.audioMixedClip || job.transitionedClip || job.clips[0];
    const outPath = path.join(job.outputDir, "04_color.mp4");

    if (!FFMPEG) {
      progress(this.name, "ffmpeg not found, skipping colour grade.");
      job.colorGradedClip = source;
      return job;
    }

    const mood = job.scenePlan.mood ?? "";
    const look = await chooseLook(job.style, job.platform, mood);
    progress(this.name, `applying '${look}' look${mood ? ` (mood: ${mood})` : ""}.`);

    await ffmpeg([
      "-i",
      source,
      "-vf",
      LOOKS[look],
      "-c:a",
      "copy",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "18",
      outPath,
    ]);

    job.colorGradedClip = outPath;
    progress(this.name, `wrote ${path.basename(outPath)}`);
    return job;
  },
};
