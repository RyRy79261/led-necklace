import { PreviewSimulator } from '@/components/preview/PreviewSimulator';

export default function PreviewPage() {
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Preview</h1>
        <p className="max-w-2xl text-sm text-neutral-400">
          Offline simulator. Runs the exact same player state machine and effect
          engine the firmware uses, then applies master brightness and gamma
          before painting the virtual necklace — no hardware required. Loads your
          authored show from local storage, or a built-in demo.
        </p>
      </section>
      <PreviewSimulator />
    </div>
  );
}
