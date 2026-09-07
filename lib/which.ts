import { existsSync } from "fs";
import { join, delimiter } from "path";

/** Minimal `which` — finds a binary on PATH, or returns null. */
export default function which(bin: string): string | null {
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  const pathEnv = process.env.PATH || "";
  for (const dir of pathEnv.split(delimiter)) {
    for (const ext of exts) {
      const candidate = join(dir, bin + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}
