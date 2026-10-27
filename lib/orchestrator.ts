import fs from "fs";
import { Bot, EditJob, ProgressCallback } from "./types";
import { ScriptBot } from "./bots/scriptBot";
import { HighlightBot } from "./bots/highlightBot";
import { CutterBot } from "./bots/cutterBot";
import { TransitionBot } from "./bots/transitionBot";
import { SubtitleBot } from "./bots/subtitleBot";
import { AudioBot } from "./bots/audioBot";
import { ColorBot } from "./bots/colorBot";
import { ExportBot } from "./bots/exportBot";

/**
 * OrchestratorBot — master coordinator. Runs the fixed pipeline, skipping
 * steps that don't apply (e.g. ScriptBot with no script), and reports
 * progress through a callback so a UI can show live status.
 *
 * Pipeline order: script -> cutter -> transition -> subtitle -> audio
 * -> color -> export. This groups "assemble the timeline" (cut + join
 * with transitions) before "polish" (captions, audio, color), then a
 * final platform-specific export pass.
 */
const PIPELINE: Bot[] = [
  ScriptBot,
  HighlightBot,
  CutterBot,
  TransitionBot,
  SubtitleBot,
  AudioBot,
  ColorBot,
  ExportBot,
];

function planSteps(job: EditJob): Bot[] {
  // Deterministic step selection — cheaper and more reliable than asking
  // an LLM to decide the pipeline shape every run. The LLM's creativity is
  // spent inside each bot (script/color choices), not on deciding whether
  // CutterBot should run.
  return PIPELINE.filter((b) => {
    if (b === ScriptBot) return Boolean(job.script);
    if (b === HighlightBot) return Boolean(job.targetDurationS);
    return true;
  });
}

export async function runOrchestrator(
  job: EditJob,
  progress: ProgressCallback
): Promise<EditJob> {
  fs.mkdirSync(job.outputDir, { recursive: true });
  progress("orchestrator", "Starting job…");

  const steps = planSteps(job);
  progress("orchestrator", `Plan: ${steps.map((b) => b.name).join(" -> ")}`);

  for (const bot of steps) {
    progress(bot.name, "running");
    job = await bot.run(job, progress);
    progress(bot.name, "done");
  }

  progress("orchestrator", `Final video: ${job.finalPath}`);
  return job;
}

export const PIPELINE_STEP_NAMES = PIPELINE.map((b) => b.name);
