"use client";

import { useEffect, useRef, useState } from "react";

type Platform = "youtube" | "tiktok" | "reels";
type Style = "dynamic" | "calm" | "cinematic";
type StepStatus = "pending" | "running" | "done" | "skipped" | "error";
type JobStatus = "queued" | "running" | "done" | "error";

interface JobState {
  id: string;
  status: JobStatus;
  log: string[];
  steps: Record<string, StepStatus>;
  ready: boolean;
  finalFilename?: string;
}

const STEP_ORDER = [
  "script_bot",
  "highlight_bot",
  "cutter_bot",
  "transition_bot",
  "subtitle_bot",
  "audio_bot",
  "color_bot",
  "export_bot",
];

const STEP_LABELS: Record<string, string> = {
  script_bot: "Script",
  highlight_bot: "Highlights",
  cutter_bot: "Cutter",
  transition_bot: "Transitions",
  subtitle_bot: "Captions",
  audio_bot: "Audio Mix",
  color_bot: "Color Grade",
  export_bot: "Export",
};

function timecode(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const f = Math.floor((seconds % 1) * 24);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
}

function StepCell({ name, status }: { name: string; status: StepStatus }) {
  const base =
    "flex-1 min-w-[92px] rounded-sm border px-2 py-3 text-center transition-colors duration-300";
  const styles: Record<StepStatus, string> = {
    pending: "border-[var(--line)] text-[var(--muted)]",
    running: "border-[var(--amber)] text-[var(--amber)] bg-[var(--amber)]/10",
    done: "border-[var(--done)] text-[var(--done)] bg-[var(--done)]/10",
    skipped: "border-[var(--line)] text-[var(--muted)] border-dashed opacity-50",
    error: "border-[var(--error)] text-[var(--error)] bg-[var(--error)]/10",
  };
  return (
    <div className={`${base} ${styles[status]}`}>
      <div className="flex items-center justify-center gap-1.5">
        {status === "running" && (
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--amber)] blink" />
        )}
        {status === "done" && <span className="h-1.5 w-1.5 rounded-full bg-[var(--done)]" />}
        {status === "error" && <span className="h-1.5 w-1.5 rounded-full bg-[var(--error)]" />}
        <span className="font-mono-tc text-[11px] tracking-wide">
          {STEP_LABELS[name] ?? name}
        </span>
      </div>
    </div>
  );
}

export default function Home() {
  const [clips, setClips] = useState<FileList | null>(null);
  const [music, setMusic] = useState<FileList | null>(null);
  const [script, setScript] = useState("");
  const [platform, setPlatform] = useState<Platform>("youtube");
  const [style, setStyle] = useState<Style>("dynamic");
  const [targetDuration, setTargetDuration] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [job, setJob] = useState<JobState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const logRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [job?.log]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!clips || clips.length === 0) {
      setError("Add at least one video clip to cut.");
      return;
    }

    const fd = new FormData();
    Array.from(clips).forEach((f) => fd.append("clips", f));
    if (music && music[0]) fd.append("music", music[0]);
    fd.append("script", script);
    fd.append("platform", platform);
    fd.append("style", style);
    if (targetDuration.trim()) fd.append("targetDuration", targetDuration.trim());

    setSubmitting(true);
    setJob(null);
    setElapsed(0);

    try {
      const res = await fetch("/api/jobs", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not start the job.");
        setSubmitting(false);
        return;
      }

      const jobId = data.jobId as string;
      setJob({ id: jobId, status: "queued", log: [], steps: {}, ready: false });

      timerRef.current = setInterval(() => setElapsed((t) => t + 1), 1000);

      pollRef.current = setInterval(async () => {
        const r = await fetch(`/api/jobs/${jobId}`);
        if (!r.ok) return;
        const j = await r.json();
        setJob({
          id: jobId,
          status: j.status,
          log: j.log,
          steps: j.steps,
          ready: j.ready,
          finalFilename: j.finalFilename,
        });
        if (j.status === "done" || j.status === "error") {
          if (pollRef.current) clearInterval(pollRef.current);
          if (timerRef.current) clearInterval(timerRef.current);
        }
      }, 1200);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSubmitting(false);
    }
  }

  const running = job && (job.status === "queued" || job.status === "running");

  return (
    <div className="flex-1 flex flex-col">
      {/* Slate header */}
      <header className="border-b border-[var(--line)] bg-[var(--panel)]">
        <div className="mx-auto max-w-5xl px-6 py-6 flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight">Cutting Room</h1>
            <p className="text-[var(--muted)] mt-1 max-w-md text-sm">
              Hand the bots your footage. Script, cuts, transitions, captions, mix, grade,
              and a platform-ready export — one pass.
            </p>
          </div>
          <div className="font-mono-tc text-xs text-[var(--muted)] border border-[var(--line)] rounded-sm px-3 py-2">
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  running ? "bg-[var(--rec)] blink" : "bg-[var(--line)]"
                }`}
              />
              {running ? "REC" : "STANDBY"} · {timecode(elapsed)}
            </div>
          </div>
        </div>
        <div className="sprockets" />
      </header>

      <main className="flex-1 mx-auto w-full max-w-5xl px-6 py-8 grid gap-8 md:grid-cols-[minmax(0,320px)_1fr]">
        {/* Upload / job form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm mb-1.5">Clips</label>
            <input
              type="file"
              accept="video/*"
              multiple
              required
              onChange={(e) => setClips(e.target.files)}
              className="block w-full text-sm text-[var(--muted)] file:mr-3 file:rounded-sm file:border-0 file:bg-[var(--panel-raised)] file:px-3 file:py-2 file:text-[var(--text)] file:text-sm"
            />
            <p className="text-xs text-[var(--muted)] mt-1">
              In whatever order you shoot them — the plan decides ordering per scene.
            </p>
          </div>

          <div>
            <label className="block text-sm mb-1.5">Background music (optional)</label>
            <input
              type="file"
              accept="audio/*"
              onChange={(e) => setMusic(e.target.files)}
              className="block w-full text-sm text-[var(--muted)] file:mr-3 file:rounded-sm file:border-0 file:bg-[var(--panel-raised)] file:px-3 file:py-2 file:text-[var(--text)] file:text-sm"
            />
          </div>

          <div>
            <label className="block text-sm mb-1.5">Script (optional)</label>
            <textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              rows={6}
              placeholder="Paste the voiceover or talking-track script. Skip this to just cut, grade, and export the raw clips."
              className="w-full rounded-sm bg-[var(--panel-raised)] border border-[var(--line)] px-3 py-2 text-sm placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--amber)]"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm mb-1.5">Platform</label>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value as Platform)}
                className="w-full rounded-sm bg-[var(--panel-raised)] border border-[var(--line)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--amber)]"
              >
                <option value="youtube">YouTube (16:9)</option>
                <option value="tiktok">TikTok (9:16)</option>
                <option value="reels">Reels (9:16)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm mb-1.5">Style</label>
              <select
                value={style}
                onChange={(e) => setStyle(e.target.value as Style)}
                className="w-full rounded-sm bg-[var(--panel-raised)] border border-[var(--line)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--amber)]"
              >
                <option value="dynamic">Dynamic</option>
                <option value="calm">Calm</option>
                <option value="cinematic">Cinematic</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm mb-1.5">Target length in seconds (optional)</label>
            <input
              type="number"
              min={5}
              max={600}
              value={targetDuration}
              onChange={(e) => setTargetDuration(e.target.value)}
              placeholder="e.g. 60"
              className="w-full rounded-sm bg-[var(--panel-raised)] border border-[var(--line)] px-3 py-2 text-sm placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--amber)]"
            />
            {Number(targetDuration) > 0 && (
              <p className="text-xs text-[var(--muted)] mt-1">
                = {Math.floor(Math.min(Number(targetDuration), 600) / 60)}m{" "}
                {Math.round(Math.min(Number(targetDuration), 600) % 60)}s (seconds, max 600)
              </p>
            )}
          </div>

          {error && <p className="text-sm text-[var(--error)]">{error}</p>}

          <button
            type="submit"
            disabled={submitting || Boolean(running)}
            className="w-full rounded-sm bg-[var(--rec)] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 tracking-wide hover:brightness-110 transition"
          >
            {running ? "Rolling…" : "Start the cut"}
          </button>
        </form>

        {/* Pipeline + log */}
        <section className="space-y-4">
          <div>
            <h2 className="text-sm text-[var(--muted)] mb-2">Pipeline</h2>
            <div className="flex flex-wrap gap-1.5">
              {STEP_ORDER.map((name) => (
                <StepCell key={name} name={name} status={job?.steps?.[name] ?? "pending"} />
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-sm text-[var(--muted)] mb-2">Edit log</h2>
            <div
              ref={logRef}
              className="h-64 overflow-y-auto rounded-sm border border-[var(--line)] bg-black/40 p-3 font-mono-tc text-xs leading-relaxed"
            >
              {!job && <p className="text-[var(--muted)]">Waiting for a job to start…</p>}
              {job?.log.map((line, i) => (
                <div key={i} className="text-[var(--muted)]">
                  <span className="text-[var(--text)]">{line}</span>
                </div>
              ))}
              {job?.status === "error" && (
                <div className="text-[var(--error)] mt-1">Job failed — see log above.</div>
              )}
            </div>
          </div>

          {job?.status === "done" && job.ready && (
            <div className="rounded-sm border border-[var(--done)] bg-[var(--done)]/10 p-4 space-y-3">
              <p className="text-sm text-[var(--done)]">Final cut ready.</p>
              <video
                src={`/api/jobs/${job.id}/download`}
                controls
                className="w-full rounded-sm bg-black"
              />
              <a
                href={`/api/jobs/${job.id}/download`}
                download={job.finalFilename}
                className="inline-block rounded-sm bg-[var(--done)] text-black font-semibold px-4 py-2 text-sm hover:brightness-110 transition"
              >
                Download {job.finalFilename}
              </a>
            </div>
          )}
        </section>
      </main>

      <footer className="sprockets" />
    </div>
  );
}
