import { readFile } from "node:fs/promises";
import { filterJobs, inWindow, titleMatches } from "./filter.js";
import { enrichComputrabajo, fetchComputrabajo } from "./sources/computrabajo.js";
import { enrichLinkedIn, fetchLinkedIn, LinkedInBlocked } from "./sources/linkedin.js";
import { loadState, saveState } from "./state.js";
import { formatJob, processCommands, sendMessage, type TelegramEnv } from "./telegram.js";
import type { Config, Job } from "./types.js";

const dryRun = process.argv.includes("--dry-run");
const stateDir = process.env.STATE_DIR ?? "state-data";
const FAIL_ALERT_AT = 3;

async function main() {
  const cfg = JSON.parse(await readFile("config.json", "utf8")) as Config;
  const now = new Date();
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const tg: TelegramEnv | null =
    token && chatId
      ? {
          token,
          chatId,
          allowed: new Set((process.env.ALLOWED_CHAT_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean)),
        }
      : null;
  if (!tg && !dryRun) throw new Error("Faltan TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID");

  const state = await loadState(stateDir);
  if (tg && !dryRun) {
    try {
      await processCommands(tg, state);
    } catch (err) {
      console.error("Comandos de Telegram fallaron:", err instanceof Error ? err.message : err);
    }
  }
  if (!state.enabled) {
    console.log("Bot apagado (/off). Nada que hacer.");
    if (!dryRun) await saveState(stateDir, state);
    return;
  }

  const notify = async (text: string) => {
    if (tg && !dryRun) await sendMessage(tg, text);
    else console.log(`[aviso] ${text}`);
  };
  const fail = async (key: string, err: unknown) => {
    const n = (state.failures[key] = (state.failures[key] ?? 0) + 1);
    console.error(`Fallo en ${key} (#${n}):`, err instanceof Error ? err.message : err);
    if (n === FAIL_ALERT_AT) await notify(`⚠️ La fuente ${key} falla ${n} veces seguidas. Puede haber cambiado su HTML.`);
  };

  const fetched: Job[] = [];
  const sources: [string, () => Promise<Job[]>][] = [];
  if (cfg.computrabajo.enabled) sources.push(["computrabajo", () => fetchComputrabajo(cfg, now)]);
  if (cfg.linkedin.enabled && !state.linkedinDisabled) {
    sources.push([
      "linkedin",
      async () => {
        const jobs = await fetchLinkedIn(cfg, now, process.env.LINKEDIN_LI_AT, state.linkedinCursor);
        state.linkedinCursor++;
        return jobs;
      },
    ]);
  }
  for (const [name, run] of sources) {
    try {
      fetched.push(...(await run()));
      state.failures[name] = 0;
    } catch (err) {
      if (err instanceof LinkedInBlocked) {
        state.linkedinDisabled = true;
        console.error(`LinkedIn bloqueado: ${err.message}`);
        await notify(
          `🛑 LinkedIn pidió verificación o bloqueó la sesión (${err.message}). Lo desactivé y no reintentaré. ` +
            `Revisa tu cuenta, renueva LINKEDIN_LI_AT si hace falta y envía /on para reactivarlo.`,
        );
      } else {
        await fail(name, err);
      }
    }
  }

  const seen = new Set(Object.keys(state.seen));
  const recent = fetched.filter((j) => inWindow(j, cfg, now));
  console.log(`Obtenidas ${fetched.length}, recientes ${recent.length}`);

  // Primera ejecución en frío: marca lo existente como visto sin avisar.
  if (!state.coldStartDone) {
    for (const j of recent) state.seen[j.id] = now.getTime();
    if (!dryRun) {
      state.coldStartDone = true;
      await saveState(stateDir, state);
    }
    console.log(`Ejecución en frío: ${recent.length} ofertas marcadas como vistas, sin avisar.`);
    if (!dryRun) return;
  }

  const fresh = recent.filter((j) => !seen.has(j.id) && titleMatches(j, cfg));
  const enrichFailed = new Set<string>();
  for (const j of fresh) {
    try {
      await (j.source === "linkedin" ? enrichLinkedIn(j) : enrichComputrabajo(j));
    } catch (err) {
      enrichFailed.add(j.id);
      console.error(`Sin descripción para ${j.id}:`, err instanceof Error ? err.message : err);
    }
  }
  const verdicts = filterJobs(fresh, seen, cfg, now);
  console.log(`Candidatas ${fresh.length}, a avisar ${verdicts.length}`);

  // Lo evaluado sin descripción se reintenta en la próxima ejecución; el resto queda visto.
  const sendIds = new Set(verdicts.map((v) => v.job.id));
  for (const j of recent) if (!enrichFailed.has(j.id) && !sendIds.has(j.id)) state.seen[j.id] = now.getTime();
  try {
    for (const v of verdicts) {
      if (tg && !dryRun) await sendMessage(tg, formatJob(v));
      else console.log("\n" + formatJob(v));
      state.seen[v.job.id] = now.getTime(); // marcar tras cada envío evita duplicados si falla uno posterior
    }
  } finally {
    if (!dryRun) await saveState(stateDir, state);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
