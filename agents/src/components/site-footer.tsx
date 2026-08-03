import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4 text-xs text-muted">
        <span>uma tool por semana</span>
        <div className="flex items-center gap-4">
          <a
            href="https://github.com/CajuOS/agents"
            className="hover-link"
            target="_blank"
            rel="noreferrer"
          >
            github
          </a>
          <Link href="/docs" className="hover-link">
            docs
          </Link>
        </div>
      </div>
    </footer>
  );
}
