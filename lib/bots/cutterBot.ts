import { Bot, EditJob, ProgressCallback } from "../types";
import { ffmpeg, FFMPEG, ffprobeHasAudio } from "../ffmpeg";
import { platformScaleFilter } from "./exportBot";
import fs from "fs";
import path from "path";

/** Builds the trim + normalize args for one segment, synthesizing silent
 * audio for clips that don't have an audio track so every segment has both
 * a video and audio stream (required by later concat/xfade filters). */
async function buildTrimArgs(
  source: string,
  startS: number,
  endS: number | undefined,
  vf: string,
  outPath: string
): Promise<string[]> {
  const hasAudio = await ffprobeHasAudio(source);
  const duration = endS !== undefined ? Math.max(endS - startS, 0.1) : undefined;

  if (hasAudio) {
    const args = ["-ss", String(startS), "-i", source];
    if (duration !== undefined) args.push("-t", String(duration));
    args.push(
      "-vf",
      vf,
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "20",
      "-c:a",
      "aac",
      "-ar",
      "48000",
      outPath
    );
    return args;
  }

  // No audio track: trim video, pair it with a synthesized silent track.
  const args = ["-ss", String(startS), "-i", source, "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"];
  if (duration !== undefined) args.push("-t", String(duration));
  args.push(
    "-vf",
    vf,
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "20",
    "-c:a",
    "aac",
    "-ar",
    "48000",
    "-shortest",
    outPath
  );
  return args;
}

/**
 * CutterBot — trims each clip to its target in/out points and writes each
 * scene out as its own file (instead of one flat concat). Keeping scenes
 * separate lets TransitionBot apply a *different* transition between every
 * pair of cuts. Segments are normalized to the platform's working
 * resolution/fps so later xfade concatenation has matching frame sizes.
 */
export const CutterBot: Bot = {
  name: "cutter_bot",
  async run(job: EditJob, progress: ProgressCallback): Promise<EditJob> {
    const segDir = path.join(job.outputDir, "segments");
    fs.mkdirSync(segDir, { recursive: true });

    if (!FFMPEG) {
      progress(this.name, "ffmpeg not found — dry-run, using source clips as-is.");
      job.trimmedClips = job.clips;
      return job;
    }

    const vf = platformScaleFilter(job.platform) + ",fps=30";
    const scenes = job.scenePlan.scenes;
    const paths: string[] = [];

    if (scenes && scenes.length > 0) {
      for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];
        const idx = Math.min(scene.clip_index ?? 0, job.clips.length - 1);
        const source = job.clips[idx];
        const outPath = path.join(segDir, `scene_${String(i).padStart(3, "0")}.mp4`);
        const args = await buildTrimArgs(source, scene.start_s ?? 0, scene.end_s, vf, outPath);
        await ffmpeg(args);
        paths.push(outPath);
      }
    } else {
      for (let i = 0; i < job.clips.length; i++) {
        const outPath = path.join(segDir, `scene_${String(i).padStart(3, "0")}.mp4`);
        const args = await buildTrimArgs(job.clips[i], 0, undefined, vf, outPath);
        await ffmpeg(args);
        paths.push(outPath);
      }
    }

    job.trimmedClips = paths;
    progress(this.name, `wrote ${paths.length} segment(s) to segments/`);
    return job;
  },
};
