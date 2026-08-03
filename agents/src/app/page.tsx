import Link from "next/link";
import { Terminal } from "@/components/terminal";

const endpoints = [
  {
    path: "/media",
    desc: "metadados + lista de mídias da página (JSON)",
  },
  {
    path: "/media/audio",
    desc: "áudio AAC pronto pra transcrição (sem re-encode)",
  },
  {
    path: "/media/video",
    desc: "vídeo original (proxy mp4/HLS)",
  },
  {
    path: "/mcp",
    desc: "MCP remoto: extract_media, download_audio, download_video",
  },
];

export default function Home() {
  return (
    <div className="mx-auto max-w-3xl px-4 pb-24 pt-20 sm:pt-28">
      <section className="animate-in">
        <p className="mb-4 font-mono text-xs text-muted">
          tool #3 · cajuOS
        </p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          mídia para agents.
        </h1>
        <p className="mt-4 max-w-xl text-muted">
          Dê uma URL com vídeo e receba o <span className="text-foreground">áudio pronto</span>{" "}
          pra transcrever ou pesquisar — sem yt-dlp, sem ffmpeg, sem ferramenta
          local. API pública + MCP remoto.
        </p>
      </section>

      <section className="mt-10 animate-in" style={{ animationDelay: "80ms" }}>
        <Terminal
          lines={[
            'curl "https://media.cajuos.dev/media/audio?url=https://exemplo.com/video" -o audio.aac',
            "",
            "# depois, direto no agent:",
            "# transcreve audio.aac e resume o conteúdo",
          ]}
        />
      </section>

      <section className="mt-14 animate-in" style={{ animationDelay: "160ms" }}>
        <h2 className="text-lg font-medium">endpoints</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {endpoints.map((e) => (
            <Link
              key={e.path}
              href="/docs"
              className="card-hover rounded-lg border border-border bg-card p-4"
            >
              <code className="font-mono text-sm text-accent">{e.path}</code>
              <p className="mt-2 text-sm text-muted">{e.desc}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-14 animate-in" style={{ animationDelay: "240ms" }}>
        <h2 className="text-lg font-medium">como funciona</h2>
        <ol className="mt-4 space-y-3 text-sm text-muted">
          <li className="flex gap-3">
            <span className="font-mono text-accent">1.</span>
            <span>
              O worker encontra os vídeos na página (HTML, HLS, mp4 direto).
            </span>
          </li>
          <li className="flex gap-3">
            <span className="font-mono text-accent">2.</span>
            <span>
              <code className="text-foreground">/media/audio</code> extrai o AAC do
              HLS <em>sem re-encode</em> (demux TS → ADTS) — rápido e leve.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="font-mono text-accent">3.</span>
            <span>
              O agent transcreve, resume ou busca dentro do áudio.
            </span>
          </li>
        </ol>
      </section>

      <section
        className="mt-14 animate-in rounded-lg border border-border bg-card p-4"
        style={{ animationDelay: "320ms" }}
      >
        <p className="text-sm text-muted">
          <span className="font-mono text-accent">free</span> · plano gratuito:
          rate limits por IP, HLS até ~46 segmentos (~5min). Vídeos maiores
          retornam erro claro <code className="text-foreground">hls-too-long</code>.
        </p>
      </section>
    </div>
  );
}
