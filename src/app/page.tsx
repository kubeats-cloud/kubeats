export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-5 py-12">
      <p className="text-primary text-xs font-semibold tracking-widest uppercase">
        Field Ops
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        Project skeleton is running.
      </h1>
      <p className="text-muted-foreground mt-3 text-sm">
        Next.js, Tailwind, shadcn/ui and the Supabase clients are wired up.
        Authentication and the rep/admin screens land in the next steps.
      </p>
    </main>
  );
}
