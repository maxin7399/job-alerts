import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface State {
  enabled: boolean;
  /** id de oferta -> epoch ms en que se vio */
  seen: Record<string, number>;
  telegramOffset: number;
  linkedinDisabled: boolean;
  linkedinCursor: number;
  coldStartDone: boolean;
  failures: Record<string, number>;
}

export const defaultState = (): State => ({
  enabled: true,
  seen: {},
  telegramOffset: 0,
  linkedinDisabled: false,
  linkedinCursor: 0,
  coldStartDone: false,
  failures: {},
});

const SEEN_TTL_MS = 14 * 24 * 3600 * 1000;

export async function loadState(dir: string): Promise<State> {
  try {
    const raw = JSON.parse(await readFile(path.join(dir, "state.json"), "utf8"));
    return { ...defaultState(), ...raw };
  } catch {
    return defaultState();
  }
}

export async function saveState(dir: string, state: State, now = Date.now()): Promise<void> {
  for (const [id, ts] of Object.entries(state.seen)) if (now - ts > SEEN_TTL_MS) delete state.seen[id];
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "state.json"), JSON.stringify(state, null, 1) + "\n");
}
