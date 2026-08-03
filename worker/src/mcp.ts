import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import {
  cachedMedia,
  assertPublicHttp,
  trackUsage,
  type Env,
} from "./core";
import { slugify } from "./extract";

/* MCP remoto (streamable HTTP), stateless: server novo por request.
   Tools delegam nas rotas internas e devolvem URLs de download
   relativas ao origin do request. */

export async function handleMcp(
  request: Request,
  env: Env,
  ip: string
): Promise<Response> {
  const origin = new URL(request.url).origin;

  const server = new McpServer({
    name: "caju-agents",
    version: "1.0.0",
  });

  server.tool(
    "extract_media",
    "Extrai metadados e lista de mídias (mp4/mp3/m3u8) de uma página com vídeo. Retorna JSON: título, tipo, sources com qualidade/tamanho e se áudio está disponível.",
    { url: z.string() },
    async ({ url }) => {
      try {
        const page = assertPublicHttp(url);
        const { info, cached } = await cachedMedia(page, env);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ ...info, cached }),
            },
          ],
        };
      } catch (e) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                ok: false,
                error: e instanceof Error ? e.message : "unknown",
              }),
            },
          ],
        };
      }
    }
  );

  server.tool(
    "download_audio",
    "Gera URL de download do áudio de uma página (AAC/ADTS de HLS ou MP3 direto). O agente faz fetch na URL retornada. Sem re-encode.",
    { url: z.string() },
    async ({ url }) => {
      try {
        const page = assertPublicHttp(url);
        const { info } = await cachedMedia(page, env);
        if (!info.extract.ok) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ ok: false, error: info.extract.error }),
              },
            ],
          };
        }
        if (!info.audio.available) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  ok: false,
                  error: "audio-unavailable",
                  note: info.audio.note,
                }),
              },
            ],
          };
        }
        const name = slugify(info.extract.title);
        const ext = info.audio.format === "mp3" ? "mp3" : "aac";
        const downloadUrl = `${origin}/media/audio?url=${encodeURIComponent(page)}&name=${encodeURIComponent(name)}`;
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                ok: true,
                format: info.audio.format,
                filename: `${name}.${ext}`,
                url: downloadUrl,
              }),
            },
          ],
        };
      } catch (e) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                ok: false,
                error: e instanceof Error ? e.message : "unknown",
              }),
            },
          ],
        };
      }
    }
  );

  server.tool(
    "download_video",
    "Gera URL de download do vídeo de uma página (mp4 direto ou HLS concatenado em .ts, lossless). quality opcional: 2160p, 1440p, 1080p, 720p, 480p, 360p, source.",
    {
      url: z.string(),
      quality: z.string().optional(),
    },
    async ({ url, quality }) => {
      try {
        const page = assertPublicHttp(url);
        const { info } = await cachedMedia(page, env);
        if (!info.extract.ok) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ ok: false, error: info.extract.error }),
              },
            ],
          };
        }
        let source = info.extract.sources[0];
        if (quality) {
          source =
            info.extract.sources.find((s) => s.quality === quality) ?? source;
        }
        const name = slugify(info.extract.title);
        const ext = info.extract.type === "hls" ? "ts" : source.ext;
        const downloadUrl = `${origin}/media/video?url=${encodeURIComponent(page)}&quality=${encodeURIComponent(source.quality)}&name=${encodeURIComponent(name)}`;
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                ok: true,
                format: info.extract.type,
                quality: source.quality,
                filename: `${name}.${ext}`,
                url: downloadUrl,
              }),
            },
          ],
        };
      } catch (e) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                ok: false,
                error: e instanceof Error ? e.message : "unknown",
              }),
            },
          ],
        };
      }
    }
  );

  await trackUsage(env, "mcp", ip);
  const transport = new WebStandardStreamableHTTPServerTransport();
  server.connect(transport);
  return transport.handleRequest(request);
}
