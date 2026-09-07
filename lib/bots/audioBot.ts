import { Bot, EditJob, ProgressCallback } from "../types";
import { ffmpeg, ffprobeDuration, FFMPEG } from "../ffmpeg";
import path from "path";

const MUSIC_VOLUME = 0.25;

/** AudioBot — mixes background music into the video with auto-ducking of
 * the music bed under speech, or normalises loudness if no music given. */
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
      progress(this.name, "no music provided, normalising speech only.");
      await ffmpeg([
        "-i",
        source,
        "-af",
        "loudnorm=I=-16:LRA=11:TP=-1.5",
        "-c:v",
        "copy",
        outPath,
      ]);
      job.audioMixedClip = outPath;
      progress(this.name, `wrote ${path.basename(outPath)}`);
      return job;
    }

    progress(this.name, "mixing background music…");
    const videoDuration = await ffprobeDuration(source);

    // Loop the music if it's shorter than the video, duck it under the
    // speech (sidechaincompress keyed off the original audio), and mix.
    const filterComplex = [
      `[1:a]volume=${MUSIC_VOLUME}[music]`,
      // Duck the music bed under speech: music is the main (compressed)
      // signal, the original speech is the sidechain that triggers it.
      `[music][0:a]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=300[ducked]`,
      `[0:a][ducked]amix=inputs=2:duration=first:weights=1 1[aout]`,
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
      outPath,
    ]);

    job.audioMixedClip = outPath;
    progress(this.name, `wrote ${path.basename(outPath)}`);
    return job;
  },
};
