export const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36";

export const MP4_RE =
  /https?:\/\/[^\s"'<>\\]+?\.(?:mp4|m4v|webm|mkv|mov|mp3)(?:\?[^\s"'<>\\]*)?/gi;
export const M3U8_RE =
  /https?:\/\/[^\s"'<>\\]+?\.m3u8(?:\?[^\s"'<>\\]*)?/gi;
const ATTR_MEDIA_RE =
  /["']([^"']*?\.(?:mp4|m4v|webm|mkv|mov|mp3|m3u8)(?:\?[^"']*)?)["']/gi;
const TITLE_RE = /<title[^>]*>([^<]+)<\/title>/i;
const QUALITY_RE = /(\d{3,4})p/i;
const BAD_NAME_RE = /(?:video_error|error|404|honeypot)/i;

export interface Source {
  url: string;
  quality: string;
  size: number | null;
  ext: string;
}

export interface ExtractResult {
  ok: boolean;
  title: string;
  type: "mp4" | "hls";
  page: string;
  sources: Source[];
  error?: string;
}

const QUALITY_ORDER: Record<string, number> = {
  "2160p": 6,
  "1440p": 5,
  "1080p": 4,
  "720p": 3,
  "480p": 2,
  "360p": 1,
};

function qualityOf(url: string): string {
  const m = url.match(QUALITY_RE);
  if (m) {
    const q = m[1] + "p";
    return QUALITY_ORDER[q] ? q : "source";
  }
  return "source";
}

function extOf(url: string): string {
  const m = url.match(/\.(mp4|m4v|webm|mkv|mov|mp3)/i);
  return m ? m[1].toLowerCase() : "mp4";
}

function dedupe(list: string[]): string[] {
  return [...new Set(list)];
}

function sanitizeTitle(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, 200);
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "video";
}

function sortSources(sources: Source[]): Source[] {
  return sources.sort((a, b) => {
    const ra = QUALITY_ORDER[a.quality] ?? 0;
    const rb = QUALITY_ORDER[b.quality] ?? 0;
    if (ra !== rb) return rb - ra;
    return (b.size ?? 0) - (a.size ?? 0);
  });
}

async function fetchWith(
  url: string,
  referer: string,
  init: RequestInit = {}
): Promise<Response> {
  return fetch(url, {
    ...init,
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
    headers: {
      "User-Agent": UA,
      ...(referer ? { Referer: referer } : {}),
      ...(init.headers ?? {}),
    },
  });
}

async function headSize(
  url: string,
  referer: string
): Promise<number | null> {
  try {
    const resp = await fetchWith(url, referer, { method: "HEAD" });
    const len = resp.headers.get("Content-Length");
    if (resp.ok && len) return parseInt(len, 10);
  } catch {
    // fall through to Range probe
  }
  try {
    const resp = await fetchWith(url, referer, {
      method: "GET",
      headers: { Range: "bytes=0-0" },
    });
    const cr = resp.headers.get("Content-Range");
    if (cr) {
      const m = cr.match(/\/(\d+)$/);
      if (m) return parseInt(m[1], 10);
    }
  } catch {
    // size unknown
  }
  return null;
}

function mp4Sources(html: string, page: string): Source[] {
  const urls: string[] = [];
  for (const m of html.matchAll(MP4_RE)) urls.push(m[0]);
  for (const m of html.matchAll(ATTR_MEDIA_RE)) {
    const raw = m[1];
    if (/^https?:\/\//i.test(raw)) continue;
    urls.push(resolveUrl(page, raw));
  }
  return dedupe(urls)
    .filter((u) => {
      try {
        const base = new URL(u).pathname.split("/").pop() ?? "";
        return !BAD_NAME_RE.test(base);
      } catch {
        return false;
      }
    })
    .map((u) => ({
      url: u,
      quality: qualityOf(u),
      size: null as number | null,
      ext: extOf(u),
    }));
}

interface HlsVariant {
  url: string;
  quality: string;
}

export function resolveUrl(base: string, target: string): string {
  try {
    return new URL(target, base).href;
  } catch {
    return target;
  }
}

function parseVariantQuality(bandwidth: string, resolution: string): string {
  if (resolution) {
    const w = resolution.split("x")[0];
    if (w === "3840" || w === "4096") return "2160p";
    if (w === "2560") return "1440p";
    if (w === "1920") return "1080p";
    if (w === "1280") return "720p";
    if (w === "854") return "480p";
    if (w === "640") return "360p";
  }
  const mbps = parseInt(bandwidth, 10) / 1_000_000;
  return mbps >= 8 ? "2160p" : mbps >= 4 ? "1080p" : mbps >= 2 ? "720p" : "source";
}

async function hlsVariants(
  manifestUrl: string,
  page: string
): Promise<HlsVariant[]> {
  const resp = await fetchWith(manifestUrl, page);
  if (!resp.ok) throw new Error("manifest-failed");
  const text = await resp.text();
  const variants: HlsVariant[] = [];

  if (text.includes("#EXT-X-STREAM-INF")) {
    const blocks = text.split("#EXT-X-STREAM-INF:");
    for (let i = 1; i < blocks.length; i++) {
      const [attrs, rest] = blocks[i].split("\n", 2);
      const uri = (rest ?? "").split("\n").find((l) => l.trim() && !l.startsWith("#"));
      if (!uri) continue;
      const bw = attrs.match(/BANDWIDTH=(\d+)/)?.[1] ?? "";
      const res = attrs.match(/RESOLUTION=(\d+x\d+)/)?.[1] ?? "";
      variants.push({
        url: resolveUrl(manifestUrl, uri.trim()),
        quality: parseVariantQuality(bw, res),
      });
    }
  } else {
    variants.push({ url: manifestUrl, quality: "source" });
  }

  return dedupeByUrl(variants);
}

function dedupeByUrl(variants: HlsVariant[]): HlsVariant[] {
  const seen = new Set<string>();
  return variants.filter((v) => {
    if (seen.has(v.url)) return false;
    seen.add(v.url);
    return true;
  });
}

export async function extract(pageUrl: string): Promise<ExtractResult> {
  if (/\.m3u8(?:\?|$)/i.test(pageUrl)) {
    try {
      const variants = await hlsVariants(pageUrl, "");
      return {
        ok: true,
        title: slugify(pageUrl).replace(/-/g, " "),
        type: "hls",
        page: pageUrl,
        sources: variants.map((v) => ({
          url: v.url,
          quality: v.quality,
          size: null,
          ext: "m3u8",
        })),
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      return {
        ok: false,
        error: msg === "manifest-failed" ? "blocked" : msg,
        title: "",
        type: "hls",
        page: pageUrl,
        sources: [],
      };
    }
  }

  if (/\.(?:mp4|m4v|webm|mkv|mov)(?:\?|$)/i.test(pageUrl)) {
    return {
      ok: true,
      title: slugify(pageUrl).replace(/-/g, " "),
      type: "mp4",
      page: pageUrl,
      sources: [
        {
          url: pageUrl,
          quality: qualityOf(pageUrl),
          size: await headSize(pageUrl, ""),
          ext: extOf(pageUrl),
        },
      ],
    };
  }

  const resp = await fetchWith(pageUrl, "");
  if (!resp.ok) {
    if (resp.status === 403 || resp.status === 401) {
      return { ok: false, error: "blocked", title: "", type: "mp4", page: pageUrl, sources: [] };
    }
    return {
      ok: false,
      error: "page-failed",
      title: "",
      type: "mp4",
      page: pageUrl,
      sources: [],
    };
  }

  const buf = await resp.arrayBuffer();
  const html = new TextDecoder().decode(buf.slice(0, 1_500_000));
  const titleMatch = html.match(TITLE_RE);
  const title = sanitizeTitle(titleMatch?.[1] ?? new URL(pageUrl).hostname);

  const mp4s = mp4Sources(html, pageUrl);
  if (mp4s.length > 0) {
    const withSize = await Promise.all(
      mp4s.slice(0, 6).map(async (s) => {
        s.size = await headSize(s.url, pageUrl);
        return s;
      })
    );
    return {
      ok: true,
      title,
      type: "mp4",
      page: pageUrl,
      sources: sortSources(withSize),
    };
  }

  const m3u8Urls = dedupe([...html.matchAll(M3U8_RE)].map((m) => m[0]));
  if (m3u8Urls.length > 0) {
    try {
      const variants = await hlsVariants(m3u8Urls[0], pageUrl);
      return {
        ok: true,
        title,
        type: "hls",
        page: pageUrl,
        sources: variants.map((v) => ({
          url: v.url,
          quality: v.quality,
          size: null,
          ext: "m3u8",
        })),
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      return {
        ok: false,
        error: msg === "manifest-failed" ? "blocked" : "manifest-failed",
        title: "",
        type: "hls",
        page: pageUrl,
        sources: [],
      };
    }
  }

  return {
    ok: false,
    error: "no-source",
    title: "",
    type: "mp4",
    page: pageUrl,
    sources: [],
  };
}
