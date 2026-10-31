import * as cheerio from "cheerio";
import { getHtml, jitter } from "../http.js";
import type { Config, Job } from "../types.js";

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** "Hace 17 minutos" / "Hace 1 hora" / "Hoy" / "Ayer" / "Hace 3 días" -> fecha aproximada. */
export function parseRelative(text: string, now: Date): Date | null {
  const t = clean(text).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (/\bahora\b|justo ahora/.test(t)) return now;
  if (/\bhoy\b/.test(t)) return now;
  if (/\bayer\b/.test(t)) return new Date(now.getTime() - 24 * 3600_000);
  const m = /hace\s+\+?(\d+)\s*(minuto|min|hora|dia|semana|mes)/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = { minuto: 60_000, min: 60_000, hora: 3600_000, dia: 86400_000, semana: 7 * 86400_000, mes: 30 * 86400_000 }[
    m[2] as "minuto"
  ];
  return new Date(now.getTime() - n * unit);
}

export function parseSearch(html: string, baseUrl: string, now: Date): Job[] {
  const $ = cheerio.load(html);
  const jobs: Job[] = [];
  $("article.box_offer").each((_, el) => {
    const card = $(el);
    const id = card.attr("data-id") ?? card.attr("id");
    const a = card.find("h2 a.js-o-link").first();
    const href = a.attr("href");
    if (!id || !href) return;
    const company = clean(card.find("a[offer-grid-article-company-url]").first().text());
    const city = clean(card.find("p.fs16.fc_base.mt5 span.mr10").first().text());
    jobs.push({
      id: `ct:${id}`,
      source: "computrabajo",
      title: clean(a.text()),
      company,
      city,
      url: new URL(href.split("#")[0], baseUrl).toString(),
      publishedAt: parseRelative(card.find("p.fs13.fc_aux.mt15").first().text(), now),
      description: "",
    });
  });
  return jobs;
}

/** La página sin resultados trae este aviso; es un caso normal, no un cambio de HTML. */
export function isEmptyResult(html: string): boolean {
  return /parece que no hay ofertas para el empleo que buscas/i.test(html);
}

export function parseDetail(html: string): string {
  const $ = cheerio.load(html);
  return clean($('div[div-link="oferta"]').first().text());
}

export async function fetchComputrabajo(cfg: Config, now: Date): Promise<Job[]> {
  const out: Job[] = [];
  const errors: string[] = [];
  for (const q of cfg.computrabajo.queries) {
    const slug = q.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9#+.]+/g, "-");
    const url = `${cfg.computrabajo.baseUrl}/trabajo-de-${slug}?by=publicationtime&pubdate=1`;
    const res = await getHtml(url);
    if (res.status !== 200) {
      errors.push(`Computrabajo HTTP ${res.status} en "${q}"`);
    } else {
      const jobs = parseSearch(res.html, cfg.computrabajo.baseUrl, now);
      if (jobs.length > 0) out.push(...jobs);
      else if (!isEmptyResult(res.html)) errors.push(`Computrabajo: 0 tarjetas en "${q}" (¿cambió el HTML?)`);
    }
    await jitter(500, 1500);
  }
  // Una búsqueda caída no debe tirar lo leído en las demás; solo es fallo si no se obtuvo nada.
  if (errors.length) {
    console.error(errors.join("\n"));
    if (out.length === 0) throw new Error(errors[0]);
  }
  return out;
}

export async function enrichComputrabajo(job: Job): Promise<void> {
  const res = await getHtml(job.url);
  if (res.status === 200) job.description = parseDetail(res.html);
}
