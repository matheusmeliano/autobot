export function Logo({ className = "" }: { className?: string }) {
  return (
    <img
      src="/favicon.svg"
      alt="AutoBot"
      className={["h-9 w-9", className].join(" ")}
    />
  );
}
