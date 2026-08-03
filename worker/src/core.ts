import { extract, type ExtractResult } from "./extract";
import { planSegments } from "./download-hls";

export interface Env {
  ALLOWED_ORIGIN?: string;
  AGENTS_CACHE?: KVNamespace;
  MAX_HLS_SEGMENTS?: string;
}

export interface AudioInfo {
  available: boolean;
  format: "aac-adts" | "mp3" | null;
  note: string | null;
}

export interface MediaInfo {
  extract: ExtractResult;
  audio: AudioInfo;
}

export const CACHE_TTL = 600;

/* Rate limit simples via KV (não atômico — race aceitável). */
export const RATE_LIMITS: Record<string, { perMinute: number }> = {
  media: { perMinute: 30 },
  "media-audio": { perMinute: 10 },
  "media-video": { perMinute: 10 },
  mcp: { perMinute: 60 },
};

export async function rateLimited(
  env: Env,
  ip: string,
  bucket: keyof typeof RATE_LIMITS
): Promise<boolean> {
  const cache = env.AGENTS_CACHE;
  if (!cache || !ip) return false;
  const limit = RATE_LIMITS[bucket].perMinute;
  const minute = Math.floor(Date.now() / 60_000);
  const key = `rl:${bucket}:${ip}:${minute}`;
  try {
    const current = Number((await cache.get(key)) ?? "0");
    if (current >= limit) return true;
    await cache.put(key, String(current + 1), { expirationTtl: 120 });
  } catch {
    // sem KV, sem limit
  }
  return false;
}

async function hashIp(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(ip)
  );
  return Array.from(new Uint8Array(digest).slice(0, 8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function trackUsage(
  env: Env,
  endpoint: string,
  ip: string
): Promise<void> {
  const kv = env.AGENTS_CACHE;
  if (!kv || !ip) return;
  try {
    const day = new Date().toISOString().slice(0, 10);
    const hash = await hashIp(ip);
    const totalKey = `u:${day}:${endpoint}`;
    const perKey = `u:${day}:${endpoint}:${hash}`;
    const [total, per] = await Promise.all([
      kv.get(totalKey),
      kv.get(perKey),
    ]);
    await kv.put(totalKey, String((Number(total) ?? 0) + 1), {
      expirationTtl: 40 * 86400,
    });
    await kv.put(perKey, String((Number(per) ?? 0) + 1), {
      expirationTtl: 40 * 86400,
    });
  } catch {
    // contador não derruba a resposta
  }
}

async function audioInfo(result: ExtractResult): Promise<AudioInfo> {
  if (result.type === "hls") {
    const first = result.sources[0];
    if (!first) return { available: false, format: null, note: "no-sources" };
    try {
      const plan = await planSegments(first.url, result.page);
      if (plan.mediaType === "ts") {
        return { available: true, format: "aac-adts", note: null };
      }
      return {
        available: false,
        format: null,
        note: "fmp4-audio-unsupported",
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      return { available: false, format: null, note: msg };
    }
  }
  const mp3 = result.sources.find((s) => s.ext === "mp3");
  if (mp3) return { available: true, format: "mp3", note: null };
  return {
    available: false,
    format: null,
    note: "mp4-audio-unsupported",
  };
}

export async function cachedMedia(
  page: string,
  env: Env
): Promise<{ info: MediaInfo; cached: boolean }> {
  const cache = env.AGENTS_CACHE;
  const key = `m1:${page}`;
  if (cache) {
    try {
      const hit = await cache.get(key, "json");
      if (hit) return { info: hit as MediaInfo, cached: true };
    } catch {
      // cache indisponível — segue sem
    }
  }
  const extractResult = await extract(page);
  const audio = extractResult.ok
    ? await audioInfo(extractResult)
    : { available: false, format: null, note: extractResult.error ?? null };
  const info: MediaInfo = { extract: extractResult, audio };
  if (extractResult.ok && cache) {
    try {
      await cache.put(key, JSON.stringify(info), { expirationTtl: CACHE_TTL });
    } catch {
      // falha de cache não derruba a resposta
    }
  }
  return { info, cached: false };
}

export function allowedOrigins(env: Env): Set<string> {
  const set = new Set([
    "https://cajuos.dev",
    "https://www.cajuos.dev",
    "https://agents.cajuos.dev",
    "http://localhost:3000",
    "http://localhost:3001",
  ]);
  if (env.ALLOWED_ORIGIN) set.add(env.ALLOWED_ORIGIN);
  return set;
}

export function corsHeaders(origin: string | null, allowed: Set<string>): Headers {
  const h = new Headers();
  if (origin && allowed.has(origin)) {
    h.set("Access-Control-Allow-Origin", origin);
    h.set("Vary", "Origin");
    h.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    h.set("Access-Control-Allow-Headers", "Content-Type, Range");
    h.set("Access-Control-Max-Age", "86400");
  }
  return h;
}

export function isPrivateHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname.endsWith(".local")) return true;
  if (hostname === "::1" || hostname === "0.0.0.0") return true;
  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

export function assertPublicHttp(raw: string | null): string {
  if (!raw) throw new Error("missing-url");
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("invalid-url");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("invalid-scheme");
  }
  if (isPrivateHost(u.hostname)) throw new Error("private-url");
  return u.href;
}
