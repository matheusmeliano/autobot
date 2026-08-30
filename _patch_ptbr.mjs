import fs from "node:fs";

function patch(file, replacements) {
  let c = fs.readFileSync(file, "utf8");
  for (const [from, to] of replacements) {
    if (!c.includes(from)) console.log("  [warn] not found:", from.slice(0, 60));
    c = c.replace(from, to);
  }
  fs.writeFileSync(file, c, "utf8");
  console.log("[ok]", file);
}

patch("src/components/pix/PixCopyClient.tsx", [
  ["Toque no botao abaixo para copiar a chave PIX e concluir o pagamento.", "Toque no botão abaixo para copiar a chave PIX e concluir o pagamento."],
]);

patch("src/components/app/debtors/DebtorsClient.tsx", [
  ["Quando ativado, mensalidades vencidas somam automaticamente aos meses seguintes ate o pagamento ou encerramento da cobranca.", "Quando ativado, mensalidades vencidas somam automaticamente aos meses seguintes até o pagamento ou encerramento da cobrança."],
]);

patch("src/components/app/templates/TemplatesClient.tsx", [
  [
    `"Ola {nome}, tudo bem?\\n\\nSeu pagamento de {valor} vence em {vencimento}.\\nPara copiar a chave PIX, acesse: {pix_link}\\n\\nObrigado!"`,
    `"Olá {nome}, tudo bem?\\n\\nSeu pagamento de {valor} vence em {vencimento}.\\nPara copiar a chave PIX, acesse: {pix_link}\\n\\nObrigado!"`,
  ],
]);

console.log("done");
