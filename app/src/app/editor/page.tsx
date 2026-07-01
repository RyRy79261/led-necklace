import { CueListEditor } from '@/components/editor/CueListEditor';

export default function EditorPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Sequence Editor</h1>
        <p className="max-w-2xl text-sm text-neutral-400">
          Build a light show as an ordered list of cues. Add, duplicate, reorder, and delete
          cues, then tune each one&apos;s effect, colours, duration, and brightness. Your work is
          saved to this browser automatically; export or import it as JSON, and upload the encoded
          sequence to the necklace.
        </p>
      </header>
      <CueListEditor />
    </div>
  );
}
