import { Bot, EditJob, ProgressCallback } from "../types";
import { ffmpeg, ffprobeDuration, FFMPEG } from "../ffmpeg";
import path from "path";

// Music sits clearly under the original audio but is always audible.
const MUSIC_VOLUME = 0.55;
// Reels / TikTok loudness target (LUFS).
const TARGET_LUFS = -14;

/** AudioBot — mixes background music into the video (ducked under the
 * original audio, faded in and out), or normalises loudness if no music. */
export const AudioBot: Bot = {
  name: "audio_bot",
  async run(job: EditJob, progress: ProgressCallback): Promise<EditJob> {
    const source =
      job.subtitledClip || job.transitionedClip || job.trimmedClips[0] || job.clips[0];
    const outPath = path.join(job.outputDir, "03_audio.mp4");

    if (!FFMPEG) {
      progress(this.name, "ffmpeg not found, skipping audio mix.");
      job.audioMixedClip = source;
      return job;
    }

    if (!job.musicPath) {
      progress(this.name, "no music provided, normalising loudness only.");
      await ffmpeg([
        "-i",
        source,
        "-af",
        `loudnorm=I=${TARGET_LUFS}:LRA=11:TP=-1.5`,
        "-c:v",
        "copy",
        outPath,
      ]);
      job.audioMixedClip = outPath;
      progress(this.name, `wrote ${path.basename(outPath)}`);
      return job;
    }

    progress(this.name, `mixing music "${path.basename(job.musicPath)}" at ${Math.round(MUSIC_VOLUME * 100)}% volume…`);
    const videoDuration = await ffprobeDuration(source);
    const fadeOutStart = Math.max(videoDuration - 2, 0).toFixed(2);

    // 1. Music: loop, set level, fade in/out.
    // 2. Original audio is split: one copy is mixed, the other keys a
    //    compressor that ducks the music whenever the original is loud.
    // 3. Mix without amix's automatic level halving, limit peaks, then
    //    normalise the result to the platform loudness target.
    const filterComplex = [
      `[1:a]aresample=48000,aformat=channel_layouts=stereo,volume=${MUSIC_VOLUME},afade=t=in:st=0:d=1.5,afade=t=out:st=${fadeOutStart}:d=2[music]`,
      `[0:a]aresample=48000,aformat=channel_layouts=stereo,asplit=2[orig][side]`,
      `[music][side]sidechaincompress=threshold=0.04:ratio=6:attack=15:release=400:makeup=1[ducked]`,
      `[orig][ducked]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[mixed]`,
      `[mixed]loudnorm=I=${TARGET_LUFS}:LRA=11:TP=-1.5[aout]`,
    ].join(";");

    await ffmpeg([
      "-i",
      source,
      "-stream_loop",
      "-1",
      "-i",
      job.musicPath,
      "-filter_complex",
      filterComplex,
      "-map",
      "0:v",
      "-map",
      "[aout]",
      "-t",
      String(videoDuration),
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      outPath,
    ]);

    job.audioMixedClip = outPath;
    progress(this.name, `wrote ${path.basename(outPath)}`);
    return job;
  },
};
