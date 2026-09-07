import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { createJob, Platform, Style } from "@/lib/types";
import { createJobRecord, appendLog, setStatus, getJob } from "@/lib/jobStore";
import { runOrchestrator } from "@/lib/orchestrator";

export const runtime = "nodejs";

const DATA_DIR = path.join(process.cwd(), "data");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const OUTPUT_DIR = path.join(DATA_DIR, "output");

const VALID_PLATFORMS: Platform[] = ["youtube", "tiktok", "reels"];
const VALID_STYLES: Style[] = ["dynamic", "calm", "cinematic"];

async function saveUpload(file: File, destDir: string): Promise<string> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_") || "file";
  const dest = path.join(/* turbopackIgnore: true */ destDir, safeName);
  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(dest, buffer);
  return dest;
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Could not parse form data" }, { status: 400 });
  }

  const clipFiles = form.getAll("clips").filter((v): v is File => v instanceof File && v.size > 0);
  if (clipFiles.length === 0) {
    return NextResponse.json({ error: "At least one video clip is required" }, { status: 400 });
  }

  const musicFile = form.get("music");
  const script = (form.get("script") as string) || "";
  const platformRaw = (form.get("platform") as string) || "youtube";
  const styleRaw = (form.get("style") as string) || "dynamic";

  const platform = VALID_PLATFORMS.includes(platformRaw as Platform) ? (platformRaw as Platform) : "youtube";
  const style = VALID_STYLES.includes(styleRaw as Style) ? (styleRaw as Style) : "dynamic";

  const jobId = randomUUID().slice(0, 10);
  const jobUploadDir = path.join(UPLOADS_DIR, jobId);
  const jobOutputDir = path.join(OUTPUT_DIR, jobId);
  fs.mkdirSync(jobUploadDir, { recursive: true });
  fs.mkdirSync(jobOutputDir, { recursive: true });

  const clipPaths: string[] = [];
  for (const f of clipFiles) {
    clipPaths.push(await saveUpload(f, jobUploadDir));
  }

  let musicPath: string | undefined;
  if (musicFile instanceof File && musicFile.size > 0) {
    musicPath = await saveUpload(musicFile, jobUploadDir);
  }

  createJobRecord(jobId, Boolean(script.trim()));

  const job = createJob({
    clips: clipPaths,
    script: script.trim() || undefined,
    musicPath,
    platform,
    style,
    outputDir: jobOutputDir,
  });

  // Fire-and-forget: run the pipeline in the background and let the client
  // poll GET /api/jobs/:id for progress, same as the original's daemon thread.
  setStatus(jobId, "running");
  runOrchestrator(job, (botName, message) => appendLog(jobId, botName, message))
    .then((finished) => {
      const record = getJob(jobId);
      if (record) {
        record.finalPath = finished.finalPath;
        record.finalFilename = finished.finalPath ? path.basename(finished.finalPath) : undefined;
        record.scenePlan = finished.scenePlan;
      }
      setStatus(jobId, "done");
    })
    .catch((err: Error) => {
      appendLog(jobId, "orchestrator", `error: ${err.message}`);
      setStatus(jobId, "error");
    });

  return NextResponse.json({ jobId });
}
