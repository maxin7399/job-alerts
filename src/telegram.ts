import type { Verdict } from "./filter.js";
import type { State } from "./state.js";

const API = "https://api.telegram.org";

export interface TelegramEnv {
  token: string;
  chatId: string;
  allowed: Set<string>;
}

async function call<T>(env: TelegramEnv, method: string, body: object): Promise<T> {
  const res = await fetch(`${API}/bot${env.token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const data = (await res.json()) as { ok: boolean; result: T; description?: string };
  // No se incluye la URL (contiene el token) en el mensaje de error.
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description ?? res.status}`);
  return data.result;
}

export const sendMessage = (env: TelegramEnv, text: string, chatId = env.chatId) =>
  call(env, "sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true });

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function formatJob(v: Verdict): string {
  const { job, years, ageMin } = v;
  const exp =
    years === null ? "experiencia no indicada" : years === 0 ? "sin experiencia / junior" : `${years} año(s) de experiencia`;
  return [
    `🆕 <b>${esc(job.title)}</b>`,
    [job.company, job.city].filter(Boolean).map(esc).join(" · "),
    `🕒 hace ${ageMin} min · ${job.source} · ${exp}`,
    esc(job.url),
  ]
    .filter(Boolean)
    .join("\n");
}

export interface Update {
  update_id: number;
  message?: { text?: string; chat: { id: number }; from?: { id: number } };
  channel_post?: { text?: string; chat: { id: number }; from?: { id: number } };
}

export type Command = "on" | "off" | "status";

/** Extrae comandos de chats/usuarios autorizados; ignora el resto. Pura, para pruebas. */
export function parseCommands(
  updates: Update[],
  allowed: Set<string>,
): { cmds: { cmd: Command; chatId: string }[]; offset: number | null } {
  const cmds: { cmd: Command; chatId: string }[] = [];
  let offset: number | null = null;
  for (const u of updates) {
    offset = u.update_id + 1;
    const m = u.message ?? u.channel_post;
    if (!m?.text) continue;
    const chatId = String(m.chat.id);
    const fromId = m.from ? String(m.from.id) : "";
    if (!allowed.has(chatId) && !allowed.has(fromId)) continue;
    const mt = /^\/(on|off|status)(?:@\w+)?\s*$/i.exec(m.text.trim());
    if (mt) cmds.push({ cmd: mt[1].toLowerCase() as Command, chatId });
  }
  return { cmds, offset };
}

export function statusText(state: State, now = Date.now()): string {
  const paused = state.linkedinPausedUntil > now;
  return [
    `Bot: ${state.enabled ? "ENCENDIDO ✅" : "APAGADO ⏸"}`,
    `LinkedIn: ${state.linkedinDisabled
      ? "desactivado por seguridad (usa /on para reactivar)"
      : paused
        ? `en pausa por límite de peticiones (${Math.ceil((state.linkedinPausedUntil - now) / 60000)} min)`
        : "activo"}`,
    `Ofertas vistas: ${Object.keys(state.seen).length}`,
  ].join("\n");
}

export async function processCommands(env: TelegramEnv, state: State): Promise<void> {
  const updates = await call<Update[]>(env, "getUpdates", {
    offset: state.telegramOffset || undefined,
    timeout: 0,
    allowed_updates: ["message", "channel_post"],
  });
  const { cmds, offset } = parseCommands(updates, env.allowed);
  for (const { cmd, chatId } of cmds) {
    if (cmd === "on") {
      state.enabled = true;
      state.linkedinDisabled = false;
      state.linkedinPausedUntil = 0;
      state.failures = {};
    }
    if (cmd === "off") state.enabled = false;
    const reply = cmd === "status" ? statusText(state) : cmd === "on" ? "Encendido ✅ (LinkedIn reactivado)" : "Apagado ⏸";
    await sendMessage(env, reply, chatId);
  }
  if (offset !== null) state.telegramOffset = offset;
}
