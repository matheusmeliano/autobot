import fs from "node:fs";

const P = "src/components/app/AppShell.tsx";
let c = fs.readFileSync(P, "utf8");
const old1 = `                  <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[var(--app-border)] bg-white p-1">
                    <img
                      src="/logo%20-%20online-music-usa.png"
                      alt="Lucas Brum Online Music USA"
                      loading="lazy"
                      className="h-full w-full object-contain"
                    />
                  </div>`;

const new1 = `                  <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[var(--app-border)] bg-black p-0">
                    <img
                      src="/logo%20-%20online-music-usa.png"
                      alt="Lucas Brum Online Music USA"
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  </div>`;

if (!c.includes(old1)) { console.error("old not found"); process.exit(1); }
c = c.replace(old1, new1);
fs.writeFileSync(P, c, "utf8");
console.log("ok");
