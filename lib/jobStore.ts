import { JobRecord, JobStatus } from "./types";
import { PIPELINE_STEP_NAMES } from "./orchestrator";

// Module-level singleton. Survives for the life of the Node server process
// (this is a local single-user tool, same as the original's in-memory dict).
// Guarded against Next.js dev-mode module re-evaluation with a global.
const globalForJobs = globalThis as unknown as { __CUTTING_ROOM_JOBS__?: Map<string, JobRecord> };
const jobs = globalForJobs.__CUTTING_ROOM_JOBS__ ?? new Map<string, JobRecord>();
globalForJobs.__CUTTING_ROOM_JOBS__ = jobs;

export function createJobRecord(id: string, hasScript: boolean, hasTarget = false): JobRecord {
  const steps: JobRecord["steps"] = {};
  for (const name of PIPELINE_STEP_NAMES) {
    const skipped =
      (name === "script_bot" && !hasScript) || (name === "highlight_bot" && !hasTarget);
    steps[name] = skipped ? "skipped" : "pending";
  }
  const record: JobRecord = {
    id,
    status: "queued",
    log: [],
    steps,
    createdAt: Date.now(),
  };
  jobs.set(id, record);
  return record;
}

export function getJob(id: string): JobRecord | undefined {
  return jobs.get(id);
}

export function setStatus(id: string, status: JobStatus) {
  const job = jobs.get(id);
  if (job) job.status = status;
}

export function appendLog(id: string, botName: string, message: string) {
  const job = jobs.get(id);
  if (!job) return;
  job.log.push(`${botName}: ${message}`);
  if (job.steps[botName] !== undefined) {
    if (message === "running") job.steps[botName] = "running";
    else if (message === "done") job.steps[botName] = "done";
  }
}
