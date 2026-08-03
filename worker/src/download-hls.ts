import { UA, resolveUrl } from "./extract";

export interface HlsParams {
  url: string;
  referer: string;
  name: string;
  maxSegments?: number;
}

export interface KeyInfo {
  method: "AES-128";
  uri?: string;
  iv?: Uint8Array;
}

export interface Segment {
  url: string;
  byteRange?: { offset: number; length: number };
}

export interface Plan {
  mediaType: "mp4" | "ts";
  segments: Segment[];
  init?: Segment;
  key?: KeyInfo;
  mediaSequence: number;
  estimatedBytes: number | null;
}

async function fetchWith(
  url: string,
  referer: string,
  init: RequestInit = {}
): Promise<Response> {
  return fetch(url, {
    ...init,
    redirect: "follow",
    signal: init.signal ?? AbortSignal.timeout(15000),
    headers: {
      "User-Agent": UA,
      ...(referer ? { Referer: referer } : {}),
      ...(init.headers ?? {}),
    },
  });
}

function parseByteRange(raw: string, prevEnd: number): { offset: number; length: number } {
  const [lenStr, offStr] = raw.split("@");
  const length = parseInt(lenStr, 10);
  const offset = offStr ? parseInt(offStr, 10) : prevEnd;
  return { offset, length };
}

function parseKey(line: string, manifestUrl: string): KeyInfo {
  const method = line.match(/METHOD=([^,]+)/)?.[1];
  if (method !== "AES-128") throw new Error("encrypted-unsupported");
  const uri = line.match(/URI="([^"]+)"/)?.[1];
  const ivHex = line.match(/IV=0x([0-9a-fA-F]+)/)?.[1];
  return {
    method: "AES-128",
    uri: uri ? resolveUrl(manifestUrl, uri) : undefined,
    iv: ivHex ? hexToBytes(ivHex) : undefined,
  };
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function mediaSequenceIv(sequence: number): Uint8Array {
  const iv = new Uint8Array(16);
  new DataView(iv.buffer).setUint32(12, sequence);
  return iv;
}

export async function planSegments(manifestUrl: string, referer: string): Promise<Plan> {
  const resp = await fetchWith(manifestUrl, referer);
  if (!resp.ok) {
    throw new Error(resp.status === 403 || resp.status === 401 ? "blocked" : "manifest-failed");
  }
  const text = await resp.text();

  if (!text.includes("#EXT-X-ENDLIST")) throw new Error("live-stream");

  const targetDuration = parseInt(text.match(/#EXT-X-TARGETDURATION:(\d+)/)?.[1] ?? "0", 10);
  const mediaSequence = parseInt(text.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/)?.[1] ?? "0", 10);

  let key: KeyInfo | undefined;
  let init: Segment | undefined;
  const segments: Segment[] = [];
  let pendingRange: string | null = null;
  let prevEnd = 0;
  let mediaType: "mp4" | "ts" = "ts";

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("#EXT-X-KEY:")) {
      const k = parseKey(line, manifestUrl);
      if (!k.uri) throw new Error("encrypted-unsupported");
      key = k;
      continue;
    }
    if (line.startsWith("#EXT-X-MAP:")) {
      const uri = line.match(/URI="([^"]+)"/)?.[1];
      if (!uri) continue;
      const br = line.match(/BYTERANGE="([^"]+)"/)?.[1];
      init = {
        url: resolveUrl(manifestUrl, uri),
        byteRange: br ? parseByteRange(br, 0) : undefined,
      };
      mediaType = "mp4";
      continue;
    }
    if (line.startsWith("#EXT-X-BYTERANGE:")) {
      pendingRange = line.slice("#EXT-X-BYTERANGE:".length);
      continue;
    }
    if (line.startsWith("#")) continue;

    const seg: Segment = { url: resolveUrl(manifestUrl, line) };
    if (pendingRange) {
      seg.byteRange = parseByteRange(pendingRange, prevEnd);
      prevEnd = seg.byteRange.offset + seg.byteRange.length;
      pendingRange = null;
    }
    segments.push(seg);
  }

  if (segments.length === 0) throw new Error("no-segments");
  return {
    mediaType,
    segments,
    init,
    key,
    mediaSequence,
    estimatedBytes: null,
  };
}

export async function fetchSegment(seg: Segment, referer: string): Promise<Uint8Array> {
  const resp = await fetchWith(seg.url, referer, {
    signal: AbortSignal.timeout(60000),
    ...(seg.byteRange
      ? {
          headers: {
            Range: `bytes=${seg.byteRange.offset}-${seg.byteRange.offset + seg.byteRange.length - 1}`,
          },
        }
      : {}),
  });
  if (!resp.ok || !resp.body) {
    console.log(`seg fetch ${seg.url.slice(0, 80)} status=${resp.status}`);
    throw new Error("segment-failed");
  }
  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  const out = new Uint8Array(size);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

/* Plano free: 50 subrequests por invocação. O pipeline HLS gasta
   2 (playlists) + N (segmentos). Teto conservador: 46 segmentos. */
export const MAX_HLS_SEGMENTS = 46;

/* Concorrência limitada + ordem estrita: dispara até MAX_IN_FLIGHT
   fetches à frente e consome em ordem (segment i só sai após i-1). */
const MAX_IN_FLIGHT = 5;

function createSegmentStream(
  plan: Plan,
  referer: string,
  onError?: (msg: string) => void
): ReadableStream<Uint8Array> {
  const n = plan.segments.length;
  const done = Array(n).fill(false);
  const pending: (Promise<Uint8Array> | null)[] = Array(n).fill(null);
  let nextDispatch = 0;

  const dispatch = (i: number): void => {
    if (i >= n || pending[i]) return;
    pending[i] = fetchSegment(plan.segments[i], referer).finally(() => {
      done[i] = true;
    });
  };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (plan.init) {
          const initBytes = await fetchSegment(plan.init, referer);
          controller.enqueue(initBytes);
        }

        let cursor = 0;
        while (cursor < n) {
          while (nextDispatch < n && nextDispatch - cursor < MAX_IN_FLIGHT) {
            dispatch(nextDispatch);
            nextDispatch++;
          }
          const bytes = await pending[cursor];
          if (!bytes) throw new Error("segment-failed");
          let out = bytes;
          if (plan.key) out = await decryptSegment(plan.key, referer, plan.mediaSequence + cursor, bytes);
          controller.enqueue(out);
          pending[cursor] = null;
          cursor++;
        }
        controller.close();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "unknown";
        if (onError) onError(msg);
        controller.error(e instanceof Error ? e : new Error("segment-failed"));
      }
    },
  });
}

const keyCache = new Map<string, CryptoKey>();

async function keyCryptoKey(uri: string, referer: string): Promise<CryptoKey> {
  const cached = keyCache.get(uri);
  if (cached) return cached;
  const resp = await fetchWith(uri, referer);
  if (!resp.ok) throw new Error("segment-failed");
  const raw = new Uint8Array(await resp.arrayBuffer());
  if (raw.length !== 16) throw new Error("segment-failed");
  const cryptoKey = await crypto.subtle.importKey("raw", raw, { name: "AES-CBC" }, false, ["decrypt"]);
  keyCache.set(uri, cryptoKey);
  return cryptoKey;
}

export async function decryptSegment(
  key: KeyInfo,
  referer: string,
  sequence: number,
  bytes: Uint8Array
): Promise<Uint8Array> {
  const cryptoKey = await keyCryptoKey(key.uri!, referer);
  const iv = key.iv ?? mediaSequenceIv(sequence);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv: iv as BufferSource },
    cryptoKey,
    bytes as BufferSource
  );
  return new Uint8Array(plain);
}

export async function estimateBytes(plan: Plan, referer: string): Promise<number | null> {
  const first = plan.segments[0];
  try {
    const resp = await fetchWith(first.url, referer, {
      ...(first.byteRange
        ? { headers: { Range: `bytes=${first.byteRange.offset}-${first.byteRange.offset + Math.min(first.byteRange.length, 1024 * 1024) - 1}` } }
        : {}),
    });
    if (!resp.ok) return null;
    let size: number | null = null;
    const cr = resp.headers.get("Content-Range");
    if (cr) {
      const m = cr.match(/(\d+)-(\d+)\/(\d+|\*)/);
      if (m) {
        const len = parseInt(m[2], 10) - parseInt(m[1], 10) + 1;
        if (first.byteRange) size = Math.min(len, first.byteRange.length);
        else size = len;
      }
    } else {
      const clen = resp.headers.get("Content-Length");
      if (clen) {
        size = parseInt(clen, 10);
        if (first.byteRange) size = Math.min(size, first.byteRange.length);
      }
    }
    return size != null ? size * plan.segments.length : null;
  } catch {
    return null;
  }
}

export async function downloadHls(
  p: HlsParams,
  onError?: (msg: string) => void
): Promise<Response> {
  let plan: Plan;
  try {
    plan = await planSegments(p.url, p.referer);
    const max = p.maxSegments ?? MAX_HLS_SEGMENTS;
    if (plan.segments.length > max) {
      return Response.json(
        {
          ok: false,
          error: "hls-too-long",
          note: `free plan: máx ${max} segmentos; esse tem ${plan.segments.length}`,
        },
        { status: 400 }
      );
    }
    plan.estimatedBytes = await estimateBytes(plan, p.referer);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return Response.json({ ok: false, error: msg }, { status: msg === "live-stream" ? 400 : 502 });
  }

  const stream = createSegmentStream(plan, p.referer, onError);
  const ext = plan.mediaType === "mp4" ? "mp4" : "ts";
  const headers = new Headers();
  headers.set("Content-Type", plan.mediaType === "mp4" ? "video/mp4" : "video/mp2t");
  headers.set("Content-Disposition", `attachment; filename="${p.name}.${ext}"`);
  headers.set("Accept-Ranges", "bytes");
  if (plan.estimatedBytes != null) {
    headers.set("X-Estimated-Length", String(plan.estimatedBytes));
  }
  return new Response(stream, { status: 200, headers });
}
