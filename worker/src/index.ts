import { slugify, type ExtractResult } from "./extract";
import { downloadMp4 } from "./download-mp4";
import {
  downloadHls,
  planSegments,
  MAX_HLS_SEGMENTS,
} from "./download-hls";
import { extractAdtsStream } from "./adts";
import { handleMcp } from "./mcp";
import {
  cachedMedia,
  rateLimited,
  trackUsage,
  corsHeaders,
  allowedOrigins,
  assertPublicHttp,
  type Env,
} from "./core";

async function handleMedia(
  url: URL,
  cors: Headers,
  env: Env,
  ip: string
): Promise<Response> {
  const page = assertPublicHttp(url.searchParams.get("url"));
  const { info, cached } = await cachedMedia(page, env);
  const headers = new Headers(cors);
  headers.set("X-Cache", cached ? "HIT" : "MISS");
  if (!info.extract.ok) {
    return Response.json(info.extract, { status: 404, headers });
  }
  await trackUsage(env, "media", ip);
  return Response.json(info, { headers });
}

async function handleAudio(
  request: Request,
  url: URL,
  cors: Headers,
  env: Env,
  ip: string
): Promise<Response> {
  const page = assertPublicHttp(url.searchParams.get("url"));
  const { info } = await cachedMedia(page, env);
  if (!info.extract.ok) {
    return Response.json(info.extract, { status: 404, headers: cors });
  }
  const name = slugify(url.searchParams.get("name") ?? info.extract.title);

  /* MP3 direto: proxy com Range. */
  const mp3 = info.extract.sources.find((s) => s.ext === "mp3");
  if (mp3) {
    await trackUsage(env, "media-audio", ip);
    const resp = await downloadMp4(request, {
      url: mp3.url,
      referer: info.extract.page,
      name,
      ext: "mp3",
      contentType: "audio/mpeg",
    });
    cors.forEach((v, k) => resp.headers.set(k, v));
    return resp;
  }

  if (info.extract.type !== "hls") {
    return Response.json(
      {
        ok: false,
        error: "audio-unavailable",
        note: "mp4-audio-unsupported: use /media/video",
      },
      { status: 400, headers: cors }
    );
  }

  const source = info.extract.sources[0];
  let plan;
  try {
    plan = await planSegments(source.url, info.extract.page);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return Response.json(
      { ok: false, error: msg === "live-stream" ? "live-stream" : "manifest-failed" },
      { status: msg === "live-stream" ? 400 : 502, headers: cors }
    );
  }
  if (plan.mediaType !== "ts") {
    return Response.json(
      {
        ok: false,
        error: "audio-unavailable",
        note: "fmp4-audio-unsupported: use /media/video",
      },
      { status: 400, headers: cors }
    );
  }
  const maxSegments = Number(env.MAX_HLS_SEGMENTS ?? MAX_HLS_SEGMENTS);
  if (plan.segments.length > maxSegments) {
    return Response.json(
      {
        ok: false,
        error: "hls-too-long",
        note: `free plan: máx ${maxSegments} segmentos (~5min); esse tem ${plan.segments.length}`,
      },
      { status: 400, headers: cors }
    );
  }

  await trackUsage(env, "media-audio", ip);
  const debug = (kind: string) => (msg: string) => {
    env.AGENTS_CACHE?.put(
      `dbg:${kind}`,
      JSON.stringify({ t: Date.now(), msg, url: page.slice(0, 120) })
    ).catch(() => {});
  };
  const stream = await extractAdtsStream(plan, info.extract.page, debug("audio"));
  const headers = new Headers(cors);
  headers.set("Content-Type", "audio/aac");
  headers.set(
    "Content-Disposition",
    `attachment; filename="${name}.aac"`
  );
  headers.set("Accept-Ranges", "bytes");
  return new Response(stream, { status: 200, headers });
}

async function handleVideo(
  request: Request,
  url: URL,
  cors: Headers,
  env: Env,
  ip: string
): Promise<Response> {
  const page = assertPublicHttp(url.searchParams.get("url"));
  const { info } = await cachedMedia(page, env);
  if (!info.extract.ok) {
    return Response.json(info.extract, { status: 404, headers: cors });
  }
  const q = url.searchParams.get("quality");
  let source = info.extract.sources[0];
  if (q) source = info.extract.sources.find((s) => s.quality === q) ?? source;
  const name = slugify(url.searchParams.get("name") ?? info.extract.title);

  await trackUsage(env, "media-video", ip);
  const debug = (msg: string) => {
    env.AGENTS_CACHE?.put(
      "dbg:video",
      JSON.stringify({ t: Date.now(), msg, url: page.slice(0, 120) })
    ).catch(() => {});
  };
  const resp =
    info.extract.type === "hls"
      ? await downloadHls(
          {
            url: source.url,
            referer: info.extract.page,
            name,
            maxSegments: Number(env.MAX_HLS_SEGMENTS ?? MAX_HLS_SEGMENTS),
          },
          debug
        )
      : await downloadMp4(request, {
          url: source.url,
          referer: info.extract.page,
          name,
        });
  cors.forEach((v, k) => resp.headers.set(k, v));
  return resp;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const cors = corsHeaders(origin, allowedOrigins(env));
    const ip = request.headers.get("CF-Connecting-IP") ?? "";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      const path = url.pathname;
      let bucket: keyof typeof import("./core").RATE_LIMITS | null = null;
      if (path === "/media") bucket = "media";
      else if (path === "/media/audio") bucket = "media-audio";
      else if (path === "/media/video") bucket = "media-video";
      else if (path === "/mcp") bucket = "mcp";

      if (bucket && (await rateLimited(env, ip, bucket))) {
        const resp = Response.json(
          { ok: false, error: "rate-limited" },
          { status: 429, headers: cors }
        );
        resp.headers.set("Retry-After", "60");
        return resp;
      }

      if (path === "/mcp") {
        return await handleMcp(request, env, ip);
      }
      if (request.method !== "GET") {
        return Response.json(
          { ok: false, error: "method-not-allowed" },
          { status: 405, headers: cors }
        );
      }
      if (path === "/media") return await handleMedia(url, cors, env, ip);
      if (path === "/media/audio") return await handleAudio(request, url, cors, env, ip);
      if (path === "/media/video") return await handleVideo(request, url, cors, env, ip);
      if (path === "/__dbg") {
        const key = url.searchParams.get("key") ?? "";
        const val = await env.AGENTS_CACHE?.get(`dbg:${key}`);
        return Response.json({ key, val: val ? JSON.parse(val) : null });
      }
      return Response.json({ ok: false, error: "not-found" }, { status: 404, headers: cors });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      const bad = ["missing-url", "invalid-url", "invalid-scheme", "private-url"];
      return Response.json(
        { ok: false, error: msg },
        { status: bad.includes(msg) ? 400 : 500, headers: cors }
      );
    }
  },
} satisfies ExportedHandler<Env>;
