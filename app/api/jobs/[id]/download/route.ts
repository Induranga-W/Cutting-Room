import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { Readable } from "stream";
import { getJob } from "@/lib/jobStore";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getJob(id);
  if (!job || !job.finalPath || !fs.existsSync(job.finalPath)) {
    return NextResponse.json({ error: "not ready" }, { status: 404 });
  }

  const stat = fs.statSync(job.finalPath);
  const nodeStream = fs.createReadStream(job.finalPath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;
  const filename = job.finalFilename || "output.mp4";

  return new NextResponse(webStream, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
