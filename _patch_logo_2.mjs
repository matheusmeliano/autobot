import fs from "node:fs";

const P = "src/components/app/AppShell.tsx";
let c = fs.readFileSync(P, "utf8");
const needle = `                  <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[var(--app-border)] bg-white p-1">
                    <img
                      src="/logo%20-%20online-music-usa.png"
                      alt="Lucas Brum Online Music USA"
                      loading="lazy"
                      className="h-full w-full object-contain"
                      onError={(e) => {
                        const img = e.currentTarget as HTMLImageElement;
                        const parent = img.parentElement;
                        if (!parent) return;
                        img.remove();
                        const fallback = document.createElement("div");
                        fallback.className = "inline-flex h-full w-full items-center justify-center rounded-2xl bg-[var(--app-card)] text-sm font-semibold text-[var(--app-text-85)]";
                        fallback.textContent = "${avatarLabel || 'U'}";
                        parent.appendChild(fallback);
                      }}
                    />
                  </div>`;

const replacement = `                  <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[var(--app-border)] bg-white p-1">
                    <img
                      src="/logo%20-%20online-music-usa.png"
                      alt="Lucas Brum Online Music USA"
                      loading="lazy"
                      className="h-full w-full object-contain"
                    />
                  </div>`;

if (!c.includes(needle)) {
  console.error("needle not found");
  // dump debug snippet
  const idx = c.indexOf('src="/logo%20-%20online-music-usa.png"');
  if (idx >= 0) {
    console.error("snippet:", c.slice(Math.max(0, idx - 200), idx + 600));
  }
  process.exit(1);
}
c = c.replace(needle, replacement);
fs.writeFileSync(P, c, "utf8");
console.log("ok");
