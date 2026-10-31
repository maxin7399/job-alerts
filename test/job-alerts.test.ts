import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import config from "../config.json" with { type: "json" };
import { detectYears, filterJobs } from "../src/filter.js";
import { detectBlock, parseDetail, parseSearch as parseLi } from "../src/sources/linkedin.js";
import { isEmptyResult, parseRelative, parseSearch as parseCt } from "../src/sources/computrabajo.js";
import { defaultState } from "../src/state.js";
import { formatJob, parseCommands, statusText } from "../src/telegram.js";
import type { Config, Job } from "../src/types.js";

const cfg = config as Config;
const now = new Date("2026-10-20T15:00:00Z");
const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");

const job = (o: Partial<Job>): Job => ({
  id: "x1", source: "computrabajo", title: "Desarrollador .NET", company: "A", city: "B",
  url: "https://e.com/1", publishedAt: new Date(now.getTime() - 5 * 60000), description: "", ...o,
});

describe("detectYears", () => {
  it.each([
    ["Se requieren 3 años de experiencia en C#", 3],
    ["Experiencia mínima de 5 años", 5],
    ["2+ years of experience with Python", 2],
    ["1 a 2 años de experiencia", 1],
    ["Experience: 4-6 years", 4],
    ["Sin experiencia, nosotros te capacitamos", 0],
    ["Llevamos 10 años en el mercado", null],
    ["Buscamos talento", null],
  ])("%s -> %s", (text, expected) => {
    expect(detectYears("Desarrollador", text)).toBe(expected);
  });
  it("junior en el título implica 0", () => {
    expect(detectYears("Desarrollador Junior", "")).toBe(0);
  });
});

describe("parseRelative", () => {
  it("minutos, horas, ayer", () => {
    expect(parseRelative("Hace  12  minutos", now)!.getTime()).toBe(now.getTime() - 12 * 60000);
    expect(parseRelative("Hace 1 hora", now)!.getTime()).toBe(now.getTime() - 3600000);
    expect(parseRelative("Ayer", now)!.getTime()).toBe(now.getTime() - 86400000);
    expect(parseRelative("???", now)).toBeNull();
  });
});

describe("parsers", () => {
  it("Computrabajo: reconoce la página sin resultados", () => {
    expect(isEmptyResult("<p>¡Ups! Parece que no hay ofertas para el empleo que buscas.</p>")).toBe(true);
    expect(isEmptyResult(fx("computrabajo-search.html"))).toBe(false);
  });
  it("Computrabajo", () => {
    const jobs = parseCt(fx("computrabajo-search.html"), "https://co.computrabajo.com", now);
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      id: "ct:AAAA0000000000000000000000000001",
      title: "Desarrollador .NET Junior",
      company: "ACME S.A.S.",
      city: "Bogotá, D.C., Bogotá, D.C.",
    });
    expect(jobs[0].url).toMatch(/^https:\/\/co\.computrabajo\.com\/ofertas-de-trabajo\/.*AAAA0+1$/);
    expect(now.getTime() - jobs[0].publishedAt!.getTime()).toBe(12 * 60000);
  });
  it("LinkedIn", () => {
    const jobs = parseLi(fx("linkedin-search.html"), now);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ id: "li:4480716637", title: "Backend Developer", company: "Acme Inc", city: "Bogotá, Colombia" });
    expect(jobs[0].url).toBe("https://co.linkedin.com/jobs/view/backend-developer-at-acme-4480716637");
  });
  it("detalle LinkedIn", () => {
    expect(parseDetail('<div class="show-more-less-html__markup">Hola   <b>mundo</b></div>')).toBe("Hola mundo");
  });
});

describe("detectBlock", () => {
  it("detecta bloqueos", () => {
    expect(detectBlock(999, null, "")).toMatch(/999/);
    expect(detectBlock(302, "https://www.linkedin.com/authwall", "")).toMatch(/authwall/);
    expect(detectBlock(200, null, "<html>Security verification</html>")).toBeTruthy();
    expect(detectBlock(200, null, "<li></li>")).toBeNull();
  });
});

describe("filterJobs", () => {
  it("aplica ventana, vistas, rol y experiencia", () => {
    const old = job({ id: "old", publishedAt: new Date(now.getTime() - 60 * 60000) });
    const seenJob = job({ id: "seen" });
    const wrongRole = job({ id: "role", title: "Vendedor", description: "python" });
    const senior = job({ id: "sr", description: "5 años de experiencia en C#" });
    const ok = job({ id: "ok", description: "C# y SQL, 2 años de experiencia" });
    const unknown = job({ id: "unk", title: "Backend Developer", description: "Python" });
    const dup = { ...ok };
    const res = filterJobs([old, seenJob, wrongRole, senior, ok, dup, unknown], new Set(["seen"]), cfg, now);
    expect(res.map((v) => v.job.id)).toEqual(["ok", "unk"]);
    expect(res[0].years).toBe(2);
    expect(res[1].years).toBeNull();
    expect(formatJob(res[1])).toContain("experiencia no indicada");
  });
});

describe("telegram", () => {
  const allowed = new Set(["111"]);
  it("solo procesa chats autorizados y avanza el offset", () => {
    const { cmds, offset } = parseCommands(
      [
        { update_id: 1, message: { text: "/off", chat: { id: 999 }, from: { id: 999 } } },
        { update_id: 2, message: { text: "/status@mibot", chat: { id: 111 }, from: { id: 111 } } },
        { update_id: 3, message: { text: "hola", chat: { id: 111 } } },
      ],
      allowed,
    );
    expect(cmds).toEqual([{ cmd: "status", chatId: "111" }]);
    expect(offset).toBe(4);
  });
  it("estado", () => {
    expect(statusText(defaultState())).toContain("ENCENDIDO");
    const paused = { ...defaultState(), linkedinPausedUntil: 1_000_000 + 30 * 60000 };
    expect(statusText(paused, 1_000_000)).toContain("en pausa");
  });
});
