import type { Metadata } from "next";
import { Terminal } from "@/components/terminal";

export const metadata: Metadata = {
  title: "docs",
  description: "API caju-agents: endpoints, rate limits e erros.",
};

const errors = [
  { code: 400, error: "missing-url / invalid-url", desc: "parâmetro url ausente ou inválido" },
  { code: 400, error: "private-url", desc: "host privado (localhost, 10.x, 172.16-31.x, 192.168.x)" },
  { code: 400, error: "audio-unavailable", desc: "sem áudio extraível (fmp4, mp4 sem trilha de áudio)" },
  { code: 400, error: "live-stream", desc: "HLS ao vivo (sem EXT-X-ENDLIST) — não suportado" },
  { code: 400, error: "hls-too-long", desc: "mais de 46 segmentos (~5min) — limite do plano free" },
  { code: 404, error: "no-media", desc: "nenhum vídeo encontrado na página" },
  { code: 405, error: "method-not-allowed", desc: "só GET" },
  { code: 429, error: "rate-limited", desc: "limite por IP atingido (Retry-After: 60s)" },
  { code: 502, error: "manifest-failed / blocked", desc: "erro ao buscar o HLS ou origem bloqueou" },
];

export default function DocsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 pb-24 pt-14">
      <h1 className="text-2xl font-semibold tracking-tight">docs</h1>
      <p className="mt-2 text-sm text-muted">
        API pública em <code className="text-foreground">https://media.cajuos.dev</code>.
        Todas as rotas aceitam CORS (agents.cajuos.dev, cajuos.dev).
      </p>

      <section className="mt-10">
        <h2 className="text-lg font-medium">/media</h2>
        <p className="mt-1 text-sm text-muted">
          Metadados + lista de mídias da página.
        </p>
        <div className="mt-3">
          <Terminal
            lines={[
              'curl "https://media.cajuos.dev/media?url=https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"',
              "",
              "{",
              '  "extract": { "ok": true, "type": "hls", "title": "...", "sources": [...] },',
              '  "audio": { "available": true, "format": "aac-adts", "note": null }',
              "}",
            ]}
          />
        </div>
        <p className="mt-2 text-xs text-muted">
          <code className="text-foreground">audio.format</code>:{" "}
          <code>aac-adts</code> (HLS TS), <code>mp3</code> (direto) ou{" "}
          <code>null</code> com nota.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-medium">/media/audio</h2>
        <p className="mt-1 text-sm text-muted">
          Áudio AAC pronto pra transcrição — demux do HLS sem re-encode.
          Parâmetros: <code className="text-foreground">url</code> (obrigatório),{" "}
          <code className="text-foreground">name</code> (opcional, nome do arquivo).
        </p>
        <div className="mt-3">
          <Terminal
            lines={[
              'curl "https://media.cajuos.dev/media/audio?url=URL_DO_VIDEO&name=meu-audio" -o meu-audio.aac',
            ]}
          />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-medium">/media/video</h2>
        <p className="mt-1 text-sm text-muted">
          Vídeo original (proxy). Parâmetros:{" "}
          <code className="text-foreground">url</code>,{" "}
          <code className="text-foreground">quality</code> (opcional, ex: 720p),{" "}
          <code className="text-foreground">name</code>.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-medium">limites (plano free)</h2>
        <ul className="mt-3 space-y-2 text-sm text-muted">
          <li>
            <code className="text-foreground">/media</code> · 30 req/min por IP
          </li>
          <li>
            <code className="text-foreground">/media/audio</code> e{" "}
            <code className="text-foreground">/media/video</code> · 10 req/min por IP
          </li>
          <li>
            <code className="text-foreground">/mcp</code> · 60 req/min por IP
          </li>
          <li>
            HLS: máx 46 segmentos (~5min) — limite de subrequests do plano
            gratuito da Cloudflare. Acima disso: <code>hls-too-long</code>.
          </li>
          <li>mp4/mp3 diretos: sem limite de tamanho (proxy único).</li>
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-medium">erros</h2>
        <div className="mt-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted">
                <th className="px-4 py-2 font-medium">status</th>
                <th className="px-4 py-2 font-medium">error</th>
                <th className="px-4 py-2 font-medium">quando</th>
              </tr>
            </thead>
            <tbody>
              {errors.map((e) => (
                <tr key={e.error} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 font-mono text-xs text-accent">{e.code}</td>
                  <td className="px-4 py-2 font-mono text-xs">{e.error}</td>
                  <td className="px-4 py-2 text-xs text-muted">{e.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
