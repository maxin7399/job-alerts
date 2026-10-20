import type { Config, Job } from "./types.js";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const NO_EXP =
  /\bsin\s+experiencia\b|\bno\s+(?:previous\s+)?experience\b|\bexperiencia\s+no\s+(?:es\s+)?(?:requerida|necesaria|indispensable)\b/;
const YEARS = /(\d{1,2})\s*(?:\+|-|a|to|y)?\s*(\d{1,2})?\s*\+?\s*(?:anos?|years?|yrs?)\b/g;
const EXP_CTX = /experien|experience|\bexp\b/;
const JUNIOR = /\b(junior|jr\.?|trainee|entry[\s-]level|aprendiz)\b/;

/**
 * Años mínimos de experiencia pedidos, o null si no se pueden determinar.
 * Toma el máximo entre las menciones "N años ... experiencia" (en rangos usa el mínimo).
 */
export function detectYears(title: string, description: string): number | null {
  const text = norm(`${title}\n${description}`);
  let found: number | null = null;
  for (const m of text.matchAll(YEARS)) {
    const idx = m.index ?? 0;
    const ctx = text.slice(Math.max(0, idx - 60), idx + m[0].length + 60);
    if (!EXP_CTX.test(ctx)) continue;
    const n = Number(m[1]);
    found = found === null ? n : Math.max(found, n);
  }
  if (found !== null) return found;
  if (NO_EXP.test(text) || JUNIOR.test(norm(title))) return 0;
  return null;
}

export function titleMatches(job: Job, cfg: Config): boolean {
  const title = norm(job.title);
  if (cfg.excludeKeywords.some((k) => title.includes(norm(k)))) return false;
  return cfg.roleKeywords.some((k) => title.includes(norm(k)));
}

export function matchesRole(job: Job, cfg: Config): boolean {
  if (!titleMatches(job, cfg)) return false;
  const all = norm(`${job.title} ${job.description}`);
  return cfg.techKeywords.some((k) => all.includes(norm(k)));
}

export function ageMinutes(job: Job, now: Date): number | null {
  return job.publishedAt ? (now.getTime() - job.publishedAt.getTime()) / 60000 : null;
}

export function inWindow(job: Job, cfg: Config, now: Date): boolean {
  const age = ageMinutes(job, now);
  return age !== null && age <= cfg.windowMinutes && age >= -5;
}

export interface Verdict {
  job: Job;
  years: number | null;
  ageMin: number;
}

/** Ventana → no vistas → rol/tecnología → experiencia. */
export function filterJobs(jobs: Job[], seen: Set<string>, cfg: Config, now: Date): Verdict[] {
  const out: Verdict[] = [];
  const ids = new Set<string>();
  for (const job of jobs) {
    if (ids.has(job.id)) continue;
    ids.add(job.id);
    if (!inWindow(job, cfg, now)) continue;
    if (seen.has(job.id)) continue;
    if (!matchesRole(job, cfg)) continue;
    const years = detectYears(job.title, job.description);
    if (years !== null && years > cfg.maxExperienceYears) continue;
    out.push({ job, years, ageMin: Math.max(0, Math.round(ageMinutes(job, now)!)) });
  }
  return out;
}
