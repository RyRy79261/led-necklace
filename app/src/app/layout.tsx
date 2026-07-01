import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Necklace',
  description: 'Author, preview, and remote-control the LED necklace light show.',
};

const NAV_LINKS: Array<{ href: string; label: string }> = [
  { href: '/', label: 'Home' },
  { href: '/editor', label: 'Editor' },
  { href: '/preview', label: 'Preview' },
  { href: '/remote', label: 'Remote' },
];

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-stage-bg text-neutral-100">
        <header className="border-b border-stage-border bg-stage-panel">
          <nav className="mx-auto flex max-w-4xl items-center gap-1 px-4 py-3">
            <span className="mr-4 font-semibold tracking-tight text-stage-accent">
              Necklace
            </span>
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded px-3 py-1.5 text-sm text-neutral-300 transition-colors hover:bg-stage-border hover:text-white"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
