import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/lib/jobStore";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({
    id: job.id,
    status: job.status,
    log: job.log,
    steps: job.steps,
    ready: Boolean(job.finalPath),
    finalFilename: job.finalFilename,
    scenePlan: job.scenePlan,
  });
}
