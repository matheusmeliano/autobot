export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="h-6 w-48 rounded-xl bg-white/[0.06]" />
      <div className="mt-3 h-4 w-72 rounded-xl bg-white/[0.05]" />
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="h-24 rounded-2xl border border-white/10 bg-white/[0.03]" />
        <div className="h-24 rounded-2xl border border-white/10 bg-white/[0.03]" />
        <div className="h-24 rounded-2xl border border-white/10 bg-white/[0.03]" />
      </div>
      <div className="mt-6 h-56 rounded-2xl border border-white/10 bg-white/[0.03]" />
    </div>
  );
}

