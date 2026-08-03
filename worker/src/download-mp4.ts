import { UA } from "./extract";

export interface DlParams {
  url: string;
  referer: string;
  name: string;
  ext?: string;
  contentType?: string;
}

export async function downloadMp4(request: Request, p: DlParams): Promise<Response> {
  const range = request.headers.get("Range") ?? "";
  const resp = await fetch(p.url, {
    redirect: "follow",
    signal: AbortSignal.timeout(60000),
    headers: {
      "User-Agent": UA,
      ...(p.referer ? { Referer: p.referer } : {}),
      ...(range ? { Range: range } : {}),
    },
  });

  if (!resp.ok && resp.status !== 206) {
    return Response.json(
      { ok: false, error: resp.status === 403 || resp.status === 401 ? "blocked" : "source-failed" },
      { status: resp.status }
    );
  }

  const headers = new Headers();
  headers.set("Content-Type", p.contentType ?? resp.headers.get("Content-Type") ?? "video/mp4");
  const clen = resp.headers.get("Content-Length");
  if (clen) headers.set("Content-Length", clen);
  headers.set("Accept-Ranges", "bytes");
  headers.set(
    "Content-Disposition",
    `attachment; filename="${p.name}.${p.ext ?? "mp4"}"`
  );

  return new Response(resp.body, {
    status: resp.status,
    headers,
  });
}
