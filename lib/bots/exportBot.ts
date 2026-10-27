import { Bot, EditJob, ProgressCallback } from "../types";
import { ffmpeg, ffprobeDuration, FFMPEG } from "../ffmpeg";
import fs from "fs";
import path from "path";

interface Preset {
  vf: string;
  crf: string;
  preset: string;
  audioBr: string;
  suffix: string;
}

/** Vertical (9:16) output fills the frame by scaling up and center-cropping,
 * instead of letterboxing a 16:9 source into a thin strip with black bars. */
const VERTICAL_FILL = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920";

export const PRESETS: Record<string, Preset> = {
  youtube: {
    vf: "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2",
    crf: "18",
    preset: "slow",
    audioBr: "192k",
    suffix: "_youtube_1080p.mp4",
  },
  tiktok: {
    vf: VERTICAL_FILL,
    crf: "20",
    preset: "fast",
    audioBr: "128k",
    suffix: "_tiktok_9x16.mp4",
  },
  reels: {
    vf: VERTICAL_FILL,
    crf: "20",
    preset: "fast",
    audioBr: "128k",
    suffix: "_reels_9x16.mp4",
  },
};

/** Scale/pad filter used to normalize clips to the platform's working
 * resolution early (CutterBot), so later xfade concatenation has
 * matching frame sizes without needing a second full re-encode pass. */
export function platformScaleFilter(platform: string): string {
  return (PRESETS[platform] ?? PRESETS.youtube).vf;
}

/** ExportBot — final render pass for the target platform. */
export const ExportBot: Bot = {
  name: "export_bot",
  async run(job: EditJob, progress: ProgressCallback): Promise<EditJob> {
    const source = job.colorGradedClip || job.transitionedClip || job.clips[0];
    const preset = PRESETS[job.platform] ?? PRESETS.youtube;
    const outPath = path.join(job.outputDir, "final" + preset.suffix);

    if (!FFMPEG) {
      progress(this.name, "ffmpeg not found, skipping export render.");
      job.finalPath = source;
      return job;
    }

    progress(this.name, `rendering for ${job.platform}…`);
    await ffmpeg([
      "-i",
      source,
      "-vf",
      preset.vf,
      "-c:v",
      "libx264",
      "-preset",
      preset.preset,
      "-crf",
      preset.crf,
      "-c:a",
      "aac",
      "-b:a",
      preset.audioBr,
      "-movflags",
      "+faststart",
      outPath,
    ]);

    job.finalPath = outPath;
    let summary = "";
    try {
      const secs = Math.round(await ffprobeDuration(outPath));
      const mb = (fs.statSync(outPath).size / 1048576).toFixed(1);
      summary = ` (${Math.floor(secs / 60)}m ${secs % 60}s, ${mb} MB)`;
    } catch {
      // summary is cosmetic
    }
    progress(this.name, `wrote ${path.basename(outPath)}${summary}`);
    return job;
  },
};
