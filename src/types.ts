export interface Job {
  id: string;
  source: "computrabajo" | "linkedin";
  title: string;
  company: string;
  city: string;
  url: string;
  /** null cuando la fuente no entrega fecha parseable */
  publishedAt: Date | null;
  description: string;
}

export interface Config {
  windowMinutes: number;
  maxExperienceYears: number;
  linkedin: { enabled: boolean; location: string; queries: string[]; pagesPerQuery: number };
  computrabajo: { enabled: boolean; baseUrl: string; queries: string[] };
  roleKeywords: string[];
  techKeywords: string[];
  excludeKeywords: string[];
}
