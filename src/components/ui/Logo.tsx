import { useId } from "react";

export function Logo({ className = "" }: { className?: string }) {
  const uid = useId().replace(/:/g, "");
  const gradientId = `bot-gradient-${uid}`;
  return (
    <div
      className={[
        "flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] shadow-sm",
        className,
      ].join(" ")}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop stopColor="#6366f1" offset="0%" />
            <stop stopColor="#10b981" offset="100%" />
          </linearGradient>
        </defs>
        <path d="M12 8V4H8" stroke={`url(#${gradientId})`} />
        <rect
          width="16"
          height="12"
          x="4"
          y="8"
          rx="2"
          stroke={`url(#${gradientId})`}
        />
        <path d="M2 14h2" stroke={`url(#${gradientId})`} />
        <path d="M20 14h2" stroke={`url(#${gradientId})`} />
        <path d="M15 13v2" stroke={`url(#${gradientId})`} />
        <path d="M9 13v2" stroke={`url(#${gradientId})`} />
      </svg>
    </div>
  );
}
