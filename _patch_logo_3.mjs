import fs from "node:fs";

const P = "src/components/app/AppShell.tsx";
let c = fs.readFileSync(P, "utf8");
const i1 = c.indexOf(`src="/logo%20-%20online-music-usa.png"`);
if (i1 < 0) { console.error("logo src not found"); process.exit(1); }
const start = c.lastIndexOf("<div", i1 - 5);
if (start < 0) { console.error("div start not found"); process.exit(1); }
const endTag = `                    />\n                  </div>`;
const iend = c.indexOf(endTag, i1);
if (iend < 0) { console.error("end tag not found"); process.exit(1); }
const end = iend + endTag.length;
const replacement = `                  <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[var(--app-border)] bg-white p-1">
                    <img
                      src="/logo%20-%20online-music-usa.png"
                      alt="Lucas Brum Online Music USA"
                      loading="lazy"
                      className="h-full w-full object-contain"
                    />
                  </div>`;
c = c.slice(0, start) + replacement + c.slice(end);
fs.writeFileSync(P, c, "utf8");
console.log("ok");
