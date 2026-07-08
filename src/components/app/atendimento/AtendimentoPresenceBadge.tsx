"use client";

export function AtendimentoPresenceBadge({
  online,
  className = "",
}: {
  online: boolean;
  className?: string;
}) {
  return (
    <span
      className={[
        "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-semibold",
        online
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
          : "border-[var(--app-border)] bg-[var(--app-card)] text-[var(--app-text-55)]",
        className,
      ].join(" ")}
    >
      <span
        className={[
          "h-2 w-2 rounded-full",
          online ? "bg-emerald-500" : "bg-[var(--app-text-35)]",
        ].join(" ")}
        aria-hidden="true"
      />
      <span>{online ? "Online" : "Offline"}</span>
    </span>
  );
}
