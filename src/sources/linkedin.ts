import * as cheerio from "cheerio";
import { getHtml, jitter } from "../http.js";
import type { Config, Job } from "../types.js";

/** Se lanza ante captcha/verificación/bloqueo: el llamador desactiva LinkedIn y avisa. */
export class LinkedInBlocked extends Error {}

/** 429: límite de peticiones. No es un bloqueo; el llamador pausa LinkedIn un rato. */
export class LinkedInRateLimited extends Error {}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

export function parseSearch(html: string, now: Date): Job[] {
  const $ = cheerio.load(html);
  const jobs: Job[] = [];
  $("li").each((_, el) => {
    const card = $(el).find("div.base-card").first();
    const urn = card.attr("data-entity-urn") ?? "";
    const id = /(\d+)$/.exec(urn)?.[1];
    const href = card.find("a.base-card__full-link").attr("href");
    if (!id || !href) return;
    const u = new URL(href);
    jobs.push({
      id: `li:${id}`,
      source: "linkedin",
      title: clean(card.find("h3.base-search-card__title").text()),
      company: clean(card.find("h4.base-search-card__subtitle").text()),
      city: clean(card.find("span.job-search-card__location").text()),
      url: `${u.origin}${u.pathname}`,
      // El <time datetime> solo trae el día; la frescura la garantiza el filtro f_TPR de la búsqueda.
      publishedAt: now,
      description: "",
    });
  });
  return jobs;
}

export function parseDetail(html: string): string {
  const $ = cheerio.load(html);
  return clean($("div.show-more-less-html__markup").first().text());
}

/** Detecta bloqueo a partir de la respuesta HTTP. Devuelve el motivo o null. */
export function detectBlock(status: number, location: string | null, html: string): string | null {
  if (status === 429 || status === 999) return `HTTP ${status}`;
  if (status >= 300 && status < 400) return `redirección a ${location ?? "?"}`;
  if (status !== 200) return `HTTP ${status}`;
  if (/authwall|checkpoint|captcha|security verification|uas\/login/i.test(html.slice(0, 20000))) return "verificación/captcha";
  return null;
}

export async function fetchLinkedIn(cfg: Config, now: Date, liAt: string | undefined, cursor: number): Promise<Job[]> {
  const queries = cfg.linkedin.queries;
  const q = queries[cursor % queries.length];
  // Una consulta por ejecución: la búsqueda debe cubrir el ciclo completo de rotación (el estado evita duplicados).
  const seconds = (cfg.windowMinutes + 15 * queries.length) * 60;
  const out: Job[] = [];
  for (let page = 0; page < cfg.linkedin.pagesPerQuery; page++) {
    const url =
      `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(q)}` +
      `&location=${encodeURIComponent(cfg.linkedin.location)}&f_TPR=r${seconds}&sortBy=DD&start=${page * 10}`;
    const res = await getHtml(url, liAt ? { cookie: `li_at=${liAt}` } : {}, "manual");
    const reason = detectBlock(res.status, res.location, res.html);
    if (res.status === 429) throw new LinkedInRateLimited(reason ?? "HTTP 429");
    if (reason) throw new LinkedInBlocked(reason);
    const jobs = parseSearch(res.html, now);
    out.push(...jobs);
    if (jobs.length === 0) break;
    await jitter(2000, 5000);
  }
  return out;
}

export async function enrichLinkedIn(job: Job): Promise<void> {
  const id = job.id.replace(/^li:/, "");
  const res = await getHtml(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`, {}, "manual");
  if (res.status === 200) job.description = parseDetail(res.html);
}
