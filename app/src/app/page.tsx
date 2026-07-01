import Link from 'next/link';

const SURFACES: Array<{ href: string; title: string; blurb: string }> = [
  {
    href: '/editor',
    title: 'Editor',
    blurb:
      'Author a sequence: an ordered list of cues (solid, fade, breathe, strobe). Set colours, durations, and brightness, then encode it for upload.',
  },
  {
    href: '/preview',
    title: 'Preview',
    blurb:
      'Watch the sequence play on a virtual necklace. The canvas runs the exact same player + effect engine the firmware uses, gamma-corrected.',
  },
  {
    href: '/remote',
    title: 'Remote',
    blurb:
      'Connect over BLE (or a local mock) to play, stop, step cues, set master brightness, and upload sequences to the necklace.',
  },
];

export default function HomePage() {
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">
          LED Necklace Control
        </h1>
        <p className="max-w-2xl text-neutral-300">
          A single companion app for the wearable LED necklace. Author a light
          show, preview it exactly as the hardware will render it, then drive the
          board live over Bluetooth. Three surfaces, one shared data model.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {SURFACES.map((surface) => (
          <Link
            key={surface.href}
            href={surface.href}
            className="block rounded-lg border border-stage-border bg-stage-panel p-4 transition-colors hover:border-stage-accent"
          >
            <h2 className="mb-2 text-lg font-medium text-white">
              {surface.title}
            </h2>
            <p className="text-sm text-neutral-400">{surface.blurb}</p>
          </Link>
        ))}
      </section>
    </div>
  );
}
