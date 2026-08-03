"use client";

import { useState } from "react";

export function Terminal({
  lines,
  prompt = "$",
}: {
  lines: string[];
  prompt?: string;
}) {
  const [copied, setCopied] = useState(false);
  const text = lines.join("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard indisponível — ignora
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="font-mono text-xs text-muted">terminal</span>
        <button
          type="button"
          onClick={copy}
          className="pressable text-xs text-muted hover-link"
        >
          {copied ? "copiado ✓" : "copiar"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-sm leading-relaxed">
        {lines.map((line, i) => (
          <div key={i} className="whitespace-pre-wrap break-all">
            <span className="select-none text-accent">{prompt} </span>
            {line}
          </div>
        ))}
      </pre>
    </div>
  );
}
