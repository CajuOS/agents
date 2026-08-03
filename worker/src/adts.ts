import {
  fetchSegment,
  decryptSegment,
  type Plan,
} from "./download-hls";

/* Demux de MPEG-TS → AAC ADTS (HLS). Sem re-encode:
   1. PAT (PID 0) → PMT → PID do stream de áudio (stream_type 0x0F = ADTS)
   2. Payloads só do PID de áudio → PES headers descartados
   3. Frames ADTS extraídos do payload contíguo (sync 0xFFF + frame_length)
   Frames podem atravessar segmento/PES — carry buffer mantém o resíduo. */

const MAX_IN_FLIGHT = 5;
const TS_PACKET = 188;

function adtsFrameLength(bytes: Uint8Array, start: number): number {
  const b3 = bytes[start + 3];
  const b4 = bytes[start + 4];
  const b5 = bytes[start + 5];
  return ((b3 & 0x03) << 11) | (b4 << 3) | (b5 >> 5);
}

function emitFrames(
  controller: ReadableStreamDefaultController<Uint8Array>,
  buf: Uint8Array
): Uint8Array {
  let i = 0;
  while (i + 7 <= buf.length) {
    if (buf[i] === 0xff && (buf[i + 1] & 0xf6) === 0xf0) {
      const len = adtsFrameLength(buf, i);
      if (len < 7 || len > 8191) {
        i++;
        continue;
      }
      const freqIdx = (buf[i + 2] >> 2) & 0x0f;
      if (freqIdx > 11) {
        i++;
        continue;
      }
      if (i + len > buf.length) break;
      controller.enqueue(buf.subarray(i, i + len));
      i += len;
      continue;
    }
    i++;
  }
  return buf.subarray(i);
}

/* ── PSI (PAT/PMT) ── */

function parsePat(payload: Uint8Array): number | null {
  const off = payload[0] + 1;
  if (off + 3 > payload.length || payload[off] !== 0x00) return null;
  const sectionLen = ((payload[off + 1] & 0x0f) << 8) | payload[off + 2];
  const end = off + 3 + sectionLen - 4;
  let i = off + 8;
  while (i + 4 <= end) {
    const prog = (payload[i] << 8) | payload[i + 1];
    const pmtPid = ((payload[i + 2] & 0x1f) << 8) | payload[i + 3];
    if (prog !== 0) return pmtPid;
    i += 4;
  }
  return null;
}

function parsePmt(payload: Uint8Array): number | null {
  const off = payload[0] + 1;
  if (off + 12 > payload.length || payload[off] !== 0x02) return null;
  const sectionLen = ((payload[off + 1] & 0x0f) << 8) | payload[off + 2];
  const end = off + 3 + sectionLen - 4;
  const progInfoLen = ((payload[off + 10] & 0x0f) << 8) | payload[off + 11];
  let i = off + 12 + progInfoLen;
  while (i + 5 <= end) {
    const streamType = payload[i];
    const pid = ((payload[i + 1] & 0x1f) << 8) | payload[i + 2];
    const esLen = ((payload[i + 3] & 0x0f) << 8) | payload[i + 4];
    if (streamType === 0x0f) return pid; // AAC ADTS
    i += 5 + esLen;
  }
  return null;
}

function tsPayload(
  packet: Uint8Array,
  pid: number
): { bytes: Uint8Array; pesStart: boolean } | null {
  if (packet.length < TS_PACKET || packet[0] !== 0x47) return null;
  const p = ((packet[1] & 0x1f) << 8) | packet[2];
  if (p !== pid) return null;
  const afc = (packet[3] >> 4) & 0x03;
  if (afc === 0 || afc === 2) return null; // adaptation-only
  let off = 4;
  if (afc === 3) off += 1 + packet[4];
  if (off >= packet.length) return null;
  return { bytes: packet.subarray(off), pesStart: (packet[1] & 0x40) !== 0 };
}

function skipPesHeader(bytes: Uint8Array): Uint8Array {
  if (bytes.length >= 9 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1) {
    return bytes.subarray(9 + bytes[8]);
  }
  return bytes;
}

/* Acha PID do stream AAC ADTS: PAT → PMT. PAT/PMT chegam no início
   do stream; varre os primeiros segmentos até achar. Os bytes baixados
   são devolvidos pro pipeline (evita re-fetch: cada um vale 1 subrequest). */
async function findAudioPid(
  plan: Plan,
  referer: string
): Promise<{ pid: number | null; scanned: number; bytes: Uint8Array[] }> {
  const bytes: Uint8Array[] = [];
  for (let s = 0; s < Math.min(3, plan.segments.length); s++) {
    const raw = await fetchSegment(plan.segments[s], referer);
    bytes.push(raw);
    const dec = plan.key
      ? await decryptSegment(plan.key, referer, plan.mediaSequence + s, raw)
      : raw;

    let pmtPid: number | null = null;
    for (let off = 0; off + TS_PACKET <= dec.length; off += TS_PACKET) {
      const pkt = tsPayload(dec.subarray(off, off + TS_PACKET), 0);
      if (pkt && pkt.pesStart) {
        pmtPid = parsePat(pkt.bytes);
        if (pmtPid != null) break;
      }
    }
    if (pmtPid == null) continue;

    for (let off = 0; off + TS_PACKET <= dec.length; off += TS_PACKET) {
      const pkt = tsPayload(dec.subarray(off, off + TS_PACKET), pmtPid);
      if (pkt && pkt.pesStart) {
        const pid = parsePmt(pkt.bytes);
        if (pid != null) return { pid, scanned: s + 1, bytes };
      }
    }
  }
  return { pid: null, scanned: bytes.length, bytes };
}

export async function extractAdtsStream(
  plan: Plan,
  referer: string,
  onError?: (msg: string) => void
): Promise<ReadableStream<Uint8Array>> {
  const n = plan.segments.length;
  const pending: (Promise<Uint8Array> | null)[] = Array(n).fill(null);
  let nextDispatch = 0;
  let carry: Uint8Array<ArrayBufferLike> = new Uint8Array(0);

  const dispatch = (i: number): void => {
    if (i >= n || pending[i]) return;
    pending[i] = fetchSegment(plan.segments[i], referer).catch((e) => {
      console.log(
        `seg ${i} fail: ${e instanceof Error ? e.message : "unknown"}`
      );
      throw e;
    });
  };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const { pid, scanned, bytes } = await findAudioPid(plan, referer);
        if (pid == null) {
          controller.error(new Error("no-audio-track"));
          return;
        }
        for (let k = 0; k < scanned; k++) {
          pending[k] = Promise.resolve(bytes[k]);
        }

        let cursor = 0;
        const started = Date.now();
        while (cursor < n) {
          while (nextDispatch < n && nextDispatch - cursor < MAX_IN_FLIGHT) {
            dispatch(nextDispatch);
            nextDispatch++;
          }
          let bytes = await pending[cursor];
          if (!bytes) throw new Error("segment-failed");
          if (plan.key) {
            bytes = await decryptSegment(
              plan.key,
              referer,
              plan.mediaSequence + cursor,
              bytes
            );
          }
          let buf = carry;
          for (let off = 0; off + TS_PACKET <= bytes.length; off += TS_PACKET) {
            const pkt = tsPayload(bytes.subarray(off, off + TS_PACKET), pid);
            if (!pkt) continue;
            const payload = skipPesHeader(pkt.bytes);
            const joined = new Uint8Array(buf.length + payload.length);
            joined.set(buf, 0);
            joined.set(payload, buf.length);
            buf = emitFrames(controller, joined);
          }
          carry = buf;
          pending[cursor] = null;
          cursor++;
          if (cursor % 10 === 0 || cursor === n) {
            console.log(
              `adts progress ${cursor}/${n} segs=${Math.round(bytes.length / 1024)}KB elapsed=${Math.round((Date.now() - started) / 1000)}s`
            );
          }
        }
        console.log(`adts done ${n} segs`);
        controller.close();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "unknown";
        console.log(`adts error: ${msg}`);
        if (onError) onError(msg);
        controller.error(e instanceof Error ? e : new Error("segment-failed"));
      }
    },
  });
}
