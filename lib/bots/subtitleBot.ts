import { Bot, EditJob, ProgressCallback } from "../types";
import { ffmpeg, FFMPEG } from "../ffmpeg";
import { transcribeAudio, hasGemini, getLastGeminiError } from "../gemini";
import fs from "fs";
import path from "path";

// Audio is sent inline (base64) in a single request, which has a size cap.
// 16 kHz mono WAV is ~1.9 MB/min, so this is roughly 6 minutes of audio.
const MAX_INLINE_AUDIO_BYTES = 12 * 1024 * 1024;

/**
 * SubtitleBot — transcribes speech via Gemini's multimodal audio input and
 * burns captions in with ffmpeg's subtitles/libass filter. (Replaces the
 * original Whisper model with Gemini, since both the app and the rest of
 * the pipeline already depend on a single Gemini API key.)
 */
export const SubtitleBot: Bot = {
  name: "subtitle_bot",
  async run(job: EditJob, progress: ProgressCallback): Promise<EditJob> {
    const source =
      job.transitionedClip || job.trimmedClips[0] || job.clips[0];
    const srtPath = path.join(job.outputDir, "02_subtitles.srt");
    const outPath = path.join(job.outputDir, "02_subtitled.mp4");

    if (!FFMPEG) {
      progress(this.name, "ffmpeg not found, skipping captions.");
      job.subtitledClip = source;
      return job;
    }

    if (!hasGemini()) {
      progress(this.name, "no GOOGLE_API_KEY configured, skipping captions.");
      job.subtitledClip = source;
      return job;
    }

    progress(this.name, "extracting audio for transcription…");
    const audioPath = path.join(job.outputDir, "_subtitle_audio.wav");
    try {
      await ffmpeg(["-i", source, "-vn", "-ac", "1", "-ar", "16000", audioPath]);
    } catch {
      progress(this.name, "could not extract audio, skipping captions.");
      job.subtitledClip = source;
      return job;
    }

    const audioBuffer = fs.readFileSync(audioPath);
    if (audioBuffer.length > MAX_INLINE_AUDIO_BYTES) {
      fs.rmSync(audioPath, { force: true });
      progress(
        this.name,
        `audio is ${Math.round(audioBuffer.length / 1048576)} MB, too long to transcribe in one request, skipping captions.`
      );
      job.subtitledClip = source;
      return job;
    }

    progress(this.name, "transcribing with Gemini…");
    const srt = await transcribeAudio(audioBuffer.toString("base64"), "audio/wav");
    fs.rmSync(audioPath, { force: true });

    if (srt === null || srt.trim().length === 0) {
      progress(
        this.name,
        srt === null
          ? `transcription failed (${getLastGeminiError() ?? "unknown error"}), skipping captions.`
          : "no speech detected, skipping captions."
      );
      job.subtitledClip = source;
      return job;
    }

    const cleanedSrt = srt.replace(/```srt/gi, "").replace(/```/g, "").trim();
    fs.writeFileSync(srtPath, cleanedSrt, "utf-8");
    job.srtPath = srtPath;

    try {
      await burnSubtitles(source, srtPath, outPath);
      job.subtitledClip = outPath;
      progress(this.name, `wrote ${path.basename(outPath)}`);
    } catch (err) {
      progress(this.name, `caption burn-in failed (${(err as Error).message}), using uncaptioned clip.`);
      job.subtitledClip = source;
    }

    return job;
  },
};

async function burnSubtitles(video: string, srt: string, out: string) {
  // ffmpeg's filter parser treats backslashes and the drive-letter colon as
  // special characters, so a raw Windows path (C:\Users\...) breaks it.
  // Use forward slashes, escape the colon, and quote the whole path.
  const escaped = srt.replace(/\\/g, "/").replace(/:/g, "\\:");
  // Sizes are relative to libass's 288-px-tall default canvas, so 14 is
  // roughly 5% of the frame height: big and readable on a 1080x1920 reel.
  const style = [
    "FontName=Arial",
    "Bold=1",
    "FontSize=14",
    "PrimaryColour=&H00FFFFFF",
    "OutlineColour=&H00000000",
    "BorderStyle=1",
    "Outline=3",
    "Shadow=0",
    "Alignment=2",
    "MarginV=70",
  ].join(",");
  await ffmpeg([
    "-i",
    video,
    "-vf",
    `subtitles='${escaped}':force_style='${style}'`,
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "18",
    "-c:a",
    "copy",
    out,
  ]);
}
