import fs from "node:fs";
const P = "src/components/app/templates/TemplatesClient.tsx";
let c = fs.readFileSync(P, "utf8");
c = c.replace(/Use variÃ¡veis:/g, "Use variáveis:");
c = c.replace(/com variaveis, PIX/g, "com variáveis, PIX");
fs.writeFileSync(P, c, "utf8");
console.log("ok");
