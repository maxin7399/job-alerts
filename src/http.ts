export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const jitter = (minMs: number, maxMs: number) => sleep(minMs + Math.random() * (maxMs - minMs));

export async function getHtml(url: string, headers: Record<string, string> = {}, redirect: RequestRedirect = "follow") {
  const res = await fetch(url, {
    headers: { "user-agent": UA, "accept-language": "es-CO,es;q=0.9,en;q=0.8", ...headers },
    redirect,
    signal: AbortSignal.timeout(25000),
  });
  return { status: res.status, location: res.headers.get("location"), html: await res.text() };
}
