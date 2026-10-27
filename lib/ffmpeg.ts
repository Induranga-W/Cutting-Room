import { spawn } from "child_process";
import which from "./which";

export const FFMPEG = which("ffmpeg");
export const FFPROBE = which("ffprobe");

/** Runs a command, resolving with stdout or rejecting with a readable error. */
export function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else {
        const tail = stderr.trim().split("\n").slice(-20).join("\n");
        reject(new Error(`${bin} exited with code ${code}\n${tail}`));
      }
    });
  });
}

export async function ffmpeg(args: string[]): Promise<void> {
  if (!FFMPEG) throw new Error("ffmpeg not found on PATH");
  await run(FFMPEG, ["-y", ...args]);
}

export async function ffprobeDuration(path: string): Promise<number> {
  if (!FFPROBE) throw new Error("ffprobe not found on PATH");
  const out = await run(FFPROBE, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "json",
    path,
  ]);
  const parsed = JSON.parse(out);
  return parseFloat(parsed.format.duration);
}

/** Duration of the first video stream (falls back to the container duration).
 * The container duration includes audio padding, which would throw off
 * xfade offsets when stitching segments. */
export async function ffprobeVideoDuration(path: string): Promise<number> {
  if (!FFPROBE) throw new Error("ffprobe not found on PATH");
  try {
    const out = await run(FFPROBE, [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=duration",
      "-of",
      "json",
      path,
    ]);
    const d = parseFloat(JSON.parse(out).streams?.[0]?.duration);
    if (Number.isFinite(d) && d > 0) return d;
  } catch {
    // fall through to the container duration
  }
  return ffprobeDuration(path);
}

export async function ffprobeHasAudio(path: string): Promise<boolean> {
  if (!FFPROBE) return false;
  try {
    const out = await run(FFPROBE, [
      "-v",
      "error",
      "-select_streams",
      "a",
      "-show_entries",
      "stream=index",
      "-of",
      "json",
      path,
    ]);
    const parsed = JSON.parse(out);
    return Array.isArray(parsed.streams) && parsed.streams.length > 0;
  } catch {
    return false;
  }
}
