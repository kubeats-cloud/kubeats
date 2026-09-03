export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-1 items-center justify-center px-5 py-12"
    >
      <span className="text-muted-foreground text-sm">Loading…</span>
    </div>
  );
}
