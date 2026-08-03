import type { Metadata } from "next";
import { Terminal } from "@/components/terminal";

export const metadata: Metadata = {
  title: "mcp",
  description: "MCP remoto caju-agents: config em Claude Code, Cursor e opencode.",
};

const tools = [
  {
    name: "extract_media",
    args: "url: string",
    desc: "metadados + mídias da página (JSON)",
  },
  {
    name: "download_audio",
    args: "url: string, name?: string",
    desc: "URL do áudio AAC pronto pra transcrição",
  },
  {
    name: "download_video",
    args: "url: string, quality?: string, name?: string",
    desc: "URL do vídeo original",
  },
];

export default function McpPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 pb-24 pt-14">
      <h1 className="text-2xl font-semibold tracking-tight">mcp</h1>
      <p className="mt-2 text-sm text-muted">
        MCP remoto (streamable HTTP, sem install). O agent fala com a API
        nativamente: pede o áudio e transcreve.
      </p>

      <section className="mt-10">
        <h2 className="text-lg font-medium">tools</h2>
        <div className="mt-3 space-y-3">
          {tools.map((t) => (
            <div
              key={t.name}
              className="rounded-lg border border-border bg-card p-4"
            >
              <code className="font-mono text-sm text-accent">{t.name}</code>
              <span className="ml-2 font-mono text-xs text-muted">({t.args})</span>
              <p className="mt-1 text-sm text-muted">{t.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-medium">claude code</h2>
        <div className="mt-3">
          <Terminal
            prompt=""
            lines={[
              "claude mcp add --transport http caju-agents https://media.cajuos.dev/mcp",
            ]}
          />
        </div>
        <p className="mt-2 text-sm text-muted">
          Depois: <em>&quot;transcreve o áudio desta página e me dá o resumo&quot;</em>.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-medium">cursor</h2>
        <div className="mt-3">
          <Terminal
            prompt=""
            lines={[
              "// .cursor/mcp.json",
              "{",
              '  "mcpServers": {',
              '    "caju-agents": {',
              '      "url": "https://media.cajuos.dev/mcp"',
              "    }",
              "  }",
              "}",
            ]}
          />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-medium">opencode</h2>
        <div className="mt-3">
          <Terminal
            prompt=""
            lines={[
              "// opencode.json",
              "{",
              '  "mcp": {',
              '    "caju-agents": {',
              '      "type": "remote",',
              '      "url": "https://media.cajuos.dev/mcp"',
              "    }",
              "  }",
              "}",
            ]}
          />
        </div>
      </section>

      <section className="mt-10 rounded-lg border border-border bg-card p-4">
        <p className="text-sm text-muted">
          O MCP usa o mesmo rate limit dos endpoints (60 req/min). Áudios de
          HLS acima de 46 segmentos retornam erro{" "}
          <code className="text-foreground">hls-too-long</code>.
        </p>
      </section>
    </div>
  );
}
