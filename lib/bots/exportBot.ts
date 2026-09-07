import { Bot, EditJob, ProgressCallback } from "../types";
import { ffmpeg, FFMPEG } from "../ffmpeg";
import path from "path";

interface Preset {
  vf: string;
  crf: string;
  preset: string;
  audioBr: string;
  suffix: string;
}

export const PRESETS: Record<string, Preset> = {
  youtube: {
    vf: "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2",
    crf: "18",
    preset: "slow",
    audioBr: "192k",
    suffix: "_youtube_1080p.mp4",
  },
  tiktok: {
    vf: "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2",
    crf: "20",
    preset: "fast",
    audioBr: "128k",
    suffix: "_tiktok_9x16.mp4",
  },
  reels: {
    vf: "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2",
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
    progress(this.name, `wrote ${path.basename(outPath)}`);
    return job;
  },
};
