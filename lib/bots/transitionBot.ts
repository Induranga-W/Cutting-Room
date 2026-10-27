import { Bot, EditJob, ProgressCallback, Scene } from "../types";
import { ffmpeg, ffprobeVideoDuration, FFMPEG, FFPROBE } from "../ffmpeg";
import path from "path";

// Maps a scene's requested transition (from ScriptBot) to an ffmpeg xfade
// transition name. "cut" is handled separately (no crossfade).
const XFADE_MAP: Record<string, string | null> = {
  cut: null,
  fade: "fade",
  dissolve: "dissolve",
  wipe: "wipeleft",
  zoom: "zoomin",
  slide: "slideleft",
};

// Default transition + duration per style, used when a scene doesn't
// specify one (or ScriptBot didn't run).
const STYLE_DEFAULTS: Record<string, { type: string; duration: number }> = {
  dynamic: { type: "cut", duration: 0.0 },
  calm: { type: "dissolve", duration: 0.8 },
  cinematic: { type: "fade", duration: 1.0 },
};

interface PlanStep {
  type: string;
  xfade: string | null;
  duration: number;
}

function buildTransitionPlan(segments: string[], scenes: Scene[], style: string): PlanStep[] {
  const def = STYLE_DEFAULTS[style] ?? STYLE_DEFAULTS.dynamic;
  const plan: PlanStep[] = [];
  for (let i = 0; i < segments.length - 1; i++) {
    const scene = scenes[i] ?? ({} as Scene);
    const requested = scene.transition_out ?? def.type;
    let xfadeName = XFADE_MAP[requested] ?? XFADE_MAP[def.type];
    let duration = requested === def.type ? def.duration : 0.5;
    if (requested === "cut") {
      xfadeName = null;
      duration = 0.0;
    }
    plan.push({ type: requested, xfade: xfadeName ?? null, duration });
  }
  return plan;
}

/**
 * TransitionBot — stitches per-scene segments together using real ffmpeg
 * xfade/acrossfade transitions chosen per-cut (not one blanket fade over
 * the whole video). Transition type + duration vary based on the scene
 * plan's "transition_out" field and the job's style.
 */
export const TransitionBot: Bot = {
  name: "transition_bot",
  async run(job: EditJob, progress: ProgressCallback): Promise<EditJob> {
    const outPath = path.join(job.outputDir, "05_transitions.mp4");
    const segments = job.trimmedClips;

    if (!segments || segments.length === 0) {
      progress(this.name, "no segments to join, skipping.");
      job.transitionedClip = job.clips[0];
      return job;
    }

    if (segments.length === 1) {
      progress(this.name, "only one segment, no transitions needed.");
      job.transitionedClip = segments[0];
      return job;
    }

    if (!FFMPEG || !FFPROBE) {
      progress(this.name, "ffmpeg/ffprobe not found, using first segment only.");
      job.transitionedClip = segments[0];
      return job;
    }

    const scenes = job.scenePlan.scenes ?? [];
    const plan = buildTransitionPlan(segments, scenes, job.style);
    progress(
      this.name,
      `joining ${segments.length} scenes with [${plan.map((p) => p.type).join(", ")}] transitions.`
    );

    await renderXfadeChain(segments, plan, outPath);

    job.transitionedClip = outPath;
    progress(this.name, `wrote ${path.basename(outPath)}`);
    return job;
  },
};

async function renderXfadeChain(segments: string[], plan: PlanStep[], outPath: string) {
  // Video-stream durations (not container durations) so xfade offsets line up.
  const durations = await Promise.all(segments.map((s) => ffprobeVideoDuration(s)));

  const inputs: string[] = [];
  for (const s of segments) inputs.push("-i", s);

  const filterParts: string[] = [];

  // Normalise every input to the same frame rate, timebase, pixel format and
  // audio layout first, so xfade / concat / acrossfade never see mismatched
  // streams when different transition types are chained together.
  for (let i = 0; i < segments.length; i++) {
    filterParts.push(`[${i}:v]fps=30,format=yuv420p,setsar=1,setpts=PTS-STARTPTS[nv${i}]`);
    filterParts.push(
      `[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[na${i}]`
    );
  }

  let vLabel = "nv0";
  let aLabel = "na0";
  let cursor = durations[0];

  for (let i = 0; i < plan.length; i++) {
    const step = plan[i];
    const nextIdx = i + 1;
    const dur = Math.max(step.duration, 0.0);
    const outV = `v${nextIdx}`;
    const outA = `a${nextIdx}`;

    if (step.xfade === null) {
      // Hard cut: concat this pair, no overlap. fps/format/setsar after the
      // concat reset the timebase so a later xfade sees matching inputs.
      filterParts.push(
        `[${vLabel}][nv${nextIdx}]concat=n=2:v=1:a=0,fps=30,format=yuv420p,setsar=1[${outV}]`
      );
      filterParts.push(`[${aLabel}][na${nextIdx}]concat=n=2:v=0:a=1[${outA}]`);
      cursor = cursor + durations[nextIdx];
    } else {
      const offset = Math.max(cursor - dur, 0);
      filterParts.push(
        `[${vLabel}][nv${nextIdx}]xfade=transition=${step.xfade}:duration=${dur}:offset=${offset.toFixed(3)},format=yuv420p[${outV}]`
      );
      filterParts.push(`[${aLabel}][na${nextIdx}]acrossfade=d=${dur}[${outA}]`);
      cursor = offset + durations[nextIdx];
    }

    vLabel = outV;
    aLabel = outA;
  }

  const filterComplex = filterParts.join(";");
  await ffmpeg([
    ...inputs,
    "-filter_complex",
    filterComplex,
    "-map",
    `[${vLabel}]`,
    "-map",
    `[${aLabel}]`,
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "20",
    "-c:a",
    "aac",
    outPath,
  ]);
}
