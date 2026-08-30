import fs from "node:fs";

const P = "src/components/app/AppShell.tsx";
let c = fs.readFileSync(P, "utf8");
const oldBlock = `              <div className="mt-4 rounded-[1.5rem] border border-[var(--app-border)] bg-[var(--app-card-2)] px-4 py-4">
                <div className="flex items-center gap-3">
                  <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] text-sm font-semibold text-[var(--app-text-85)]">
                    {avatarLabel || "U"}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[var(--app-text-85)]">
                      {displayName}
                    </div>
                    <div className="mt-1 truncate text-xs text-[var(--app-text-55)]">
                      {email || "Sem e-mail"}
                    </div>
                  </div>
                </div>
              </div>`;

const newBlock = `              <div className="mt-4 rounded-[1.5rem] border border-[var(--app-border)] bg-[var(--app-card-2)] px-4 py-4">
                <div className="flex items-center gap-3">
                  <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[var(--app-border)] bg-white p-1">
                    <img
                      src="/logo%20-%20online-music-usa.png"
                      alt="Lucas Brum Online Music USA"
                      loading="lazy"
                      className="h-full w-full object-contain"
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[var(--app-text-85)]">
                      {displayName}
                    </div>
                    <div className="mt-1 truncate text-xs text-[var(--app-text-55)]">
                      {email || "Sem e-mail"}
                    </div>
                  </div>
                </div>
              </div>`;

if (!c.includes(oldBlock)) {
  console.error("block not found");
  process.exit(1);
}
c = c.replace(oldBlock, newBlock);
fs.writeFileSync(P, c, "utf8");
console.log("ok");
