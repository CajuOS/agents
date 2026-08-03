import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
        <Link
          href="/"
          className="hover-link text-sm font-medium text-muted"
        >
          caju<span className="text-accent">-agents</span>
        </Link>
        <nav className="flex items-center gap-5 text-sm text-muted">
          <Link href="/docs" className="hover-link">
            docs
          </Link>
          <Link href="/mcp" className="hover-link">
            mcp
          </Link>
          <a
            href="https://cajuos.dev"
            className="hover-link"
            target="_blank"
            rel="noreferrer"
          >
            cajuos
          </a>
        </nav>
      </div>
    </header>
  );
}
