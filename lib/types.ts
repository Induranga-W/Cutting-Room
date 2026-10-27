export type Platform = "youtube" | "tiktok" | "reels";
export type Style = "dynamic" | "calm" | "cinematic";

export interface Scene {
  scene_id: number;
  clip_index: number;
  start_s: number;
  end_s?: number;
  caption?: string;
  /** What happens in this moment (from video analysis), for the log. */
  note?: string;
  /** Horizontal focus of the main subject, 0 (left) to 1 (right), used to
   * reframe wide footage into 9:16. focus_x_end pans to a new position. */
  focus_x?: number;
  focus_x_end?: number;
  transition_out?: "cut" | "fade" | "dissolve" | "zoom" | "wipe" | "slide";
  is_hook?: boolean;
}

export interface ScenePlan {
  total_duration_s?: number;
  mood?: string;
  scenes: Scene[];
}

/** Everything the pipeline needs to know about one edit job. */
export interface EditJob {
  clips: string[];
  script?: string;
  musicPath?: string;
  platform: Platform;
  style: Style;
  outputDir: string;
  /** Desired final length in seconds (optional). */
  targetDurationS?: number;

  scenePlan: ScenePlan;
  trimmedClips: string[];
  subtitledClip?: string;
  audioMixedClip?: string;
  colorGradedClip?: string;
  transitionedClip?: string;
  finalPath?: string;
  srtPath?: string;
}

export function createJob(params: {
  clips: string[];
  script?: string;
  musicPath?: string;
  platform: Platform;
  style: Style;
  outputDir: string;
  targetDurationS?: number;
}): EditJob {
  return {
    ...params,
    scenePlan: { scenes: [] },
    trimmedClips: [],
  };
}

export type JobStatus = "queued" | "running" | "done" | "error";

export interface JobRecord {
  id: string;
  status: JobStatus;
  log: string[];
  steps: Record<string, "pending" | "running" | "done" | "skipped" | "error">;
  finalPath?: string;
  finalFilename?: string;
  scenePlan?: ScenePlan;
  createdAt: number;
}

export type ProgressCallback = (botName: string, message: string) => void;

export interface Bot {
  name: string;
  run(job: EditJob, progress: ProgressCallback): Promise<EditJob>;
}
