import type { AtendimentoLead } from "./types.ts";
import { isValidCPF, firstTwoNamesFromFullName } from "./bot.ts";

export type ContractData = {
  studentFullName: string;
  studentCPF: string;
  studentPhone: string;
  studentCity: string | null;
  legalResponsibleName: string | null;
  legalResponsibleCPF: string | null;
  signedAtIso: string;
  signedByLabel: string;
  signedByCPF: string;
  teacherFullName: string;
  contractedCompanyName: string;
  contractedCNPJ: string;
};

const CONTRATADA_NOME = "INNOVALAND DESENVOLVIMENTO E PARTICIPAÇÕES LTDA";
const CONTRATADA_CNPJ = "63.088.381/0001-22";
const PROFESSOR_NOME = "Lucas Brum de Castro";

function isLessThan18YearsOld(): boolean {
  return false;
}

export function buildContractData(params: {
  lead: Partial<AtendimentoLead>;
  overrideLegalResponsible?: { name?: string | null; cpf?: string | null } | null;
  overrideSignedAtIso?: string | null;
}): ContractData {
  const lead = params.lead ?? {};
  const legalResponsibleNameRaw =
    String(params.overrideLegalResponsible?.name ?? lead.legal_responsible_name ?? "").trim() ||
    null;
  const legalResponsibleCPFRaw =
    String(params.overrideLegalResponsible?.cpf ?? lead.legal_responsible_cpf ?? "").trim() ||
    null;
  const hasLegalResponsible = Boolean(legalResponsibleNameRaw && legalResponsibleCPFRaw);

  const studentFullName = String(lead.full_name ?? "").trim() || "ALUNO(A)";
  const studentCPFValid = isValidCPF(lead.cpf);
  const studentCPF = studentCPFValid.formatted || String(lead.cpf ?? "").trim() || "___.___.___-__";
  const studentPhone = String(lead.phone ?? "").trim() || "(  ) _________";
  const studentCity = String(lead.city ?? "").trim() || null;
  const signedAtIso = params.overrideSignedAtIso || new Date().toISOString();
  const signedByLabel = hasLegalResponsible ? legalResponsibleNameRaw! : studentFullName;
  const signedByCPFRaw = hasLegalResponsible ? legalResponsibleCPFRaw! : lead.cpf ?? "";
  const signedByCPFValid = isValidCPF(signedByCPFRaw);
  const signedByCPF = signedByCPFValid.formatted || String(signedByCPFRaw ?? "").trim() || "___.___.___-__";

  return {
    studentFullName,
    studentCPF,
    studentPhone,
    studentCity,
    legalResponsibleName: hasLegalResponsible ? legalResponsibleNameRaw : null,
    legalResponsibleCPF: hasLegalResponsible
      ? isValidCPF(legalResponsibleCPFRaw).formatted || legalResponsibleCPFRaw
      : null,
    signedAtIso,
    signedByLabel,
    signedByCPF,
    teacherFullName: PROFESSOR_NOME,
    contractedCompanyName: CONTRATADA_NOME,
    contractedCNPJ: CONTRATADA_CNPJ,
  };
}

export function formatLocalizedDateSigned(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    const now = new Date();
    return formatLocalizedDateSigned(now.toISOString());
  }
  const dia = String(d.getDate()).padStart(2, "0");
  const meses = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
  ];
  const mes = meses[d.getMonth()] ?? "";
  const ano = String(d.getFullYear());
  return [dia, mes, ano].join(" de ");
}

export function buildContractHtml(data: ContractData): string {
  const dataLocal = data.studentCity && data.studentCity.trim()
    ? `${data.studentCity}, ${formatLocalizedDateSigned(data.signedAtIso)}.`
    : `${formatLocalizedDateSigned(data.signedAtIso)}.`;

  const responsavelLinha1 = data.legalResponsibleName
    ? `<p style="margin: 0 0 8px 0; line-height: 1.45;"><strong>Responsável legal, se menor:</strong> ${data.legalResponsibleName}</p>`
    : "";
  const responsavelLinha2 = data.legalResponsibleCPF
    ? `<p style="margin: 0 0 8px 0; line-height: 1.45;"><strong>CPF do responsável:</strong> ${data.legalResponsibleCPF}</p>`
    : "";

  const alunoAssina =
    !data.legalResponsibleName
      ? `
      <div style="margin-top: 56px; page-break-inside: avoid;">
        <div style="border-top: 1px solid #111; width: 80%; margin: 0 auto 10px auto;"></div>
        <p style="text-align: center; margin: 0 0 4px 0; font-size: 12px;">
          <strong>Aluno(a):</strong> ${data.studentFullName}
        </p>
        <p style="text-align: center; margin: 0; font-size: 12px;">
          CPF: ${data.studentCPF}
        </p>
      </div>`
      : `
      <div style="margin-top: 56px; page-break-inside: avoid;">
        <div style="border-top: 1px solid #111; width: 80%; margin: 0 auto 10px auto;"></div>
        <p style="text-align: center; margin: 0 0 4px 0; font-size: 12px;">
          <strong>Responsável legal / Assinatura do(a) aluno(a):</strong> ${data.signedByLabel}
        </p>
        <p style="text-align: center; margin: 0; font-size: 12px;">
          CPF: ${data.signedByCPF}
        </p>
      </div>`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Contrato de Prestação de Serviços Educacionais</title>
<style>
  @page { size: A4; margin: 2.2cm 2cm; }
  body {
    font-family: "Times New Roman", "Liberation Serif", Georgia, serif;
    color: #111;
    font-size: 13px;
    line-height: 1.55;
  }
  h1 {
    font-size: 16px;
    text-align: center;
    margin: 0 0 18px 0;
  }
  h2 {
    font-size: 14px;
    margin: 18px 0 8px 0;
  }
  p { margin: 0 0 10px 0; text-align: justify; }
  .header-block p { margin: 0 0 6px 0; }
  .assinaturas-linha {
    border-top: 1px solid #111;
    width: 80%;
    margin: 0 auto 10px auto;
  }
</style>
</head>
<body>
  <h1>CONTRATO DE PRESTAÇÃO DE SERVIÇOS EDUCACIONAIS<br/>AULAS ONLINE DE MÚSICA</h1>

  <div class="header-block">
    <p style="margin: 0 0 14px 0;">
      <strong>CONTRATADA:</strong> ${data.contractedCompanyName}, inscrita no CNPJ nº ${data.contractedCNPJ},
      responsável pela marca Lucas Brum Online Music USA, representada pelo professor ${data.teacherFullName}.
    </p>
    <p style="margin: 0 0 8px 0;"><strong>Aluno(a):</strong> ${data.studentFullName}</p>
    <p style="margin: 0 0 8px 0;"><strong>CPF:</strong> ${data.studentCPF}</p>
    <p style="margin: 0 0 8px 0;"><strong>Telefone/WhatsApp:</strong> ${data.studentPhone}</p>
    ${responsavelLinha1}
    ${responsavelLinha2}
  </div>

  <h2>1. OBJETO</h2>
  <p>
    A CONTRATADA prestará ao(à) aluno(a) aulas individuais, online e ao vivo de música, em português,
    ministradas pelo professor ${data.teacherFullName}, com conteúdo adequado ao nível, ao instrumento
    escolhido e aos objetivos do(a) aluno(a).
  </p>

  <h2>2. PLANO, VALOR E PAGAMENTO</h2>
  <p>
    O plano compreende 1 (uma) aula por semana, com duração de 40 (quarenta) minutos, pelo valor mensal
    de US$ 119,00 (cento e dezenove dólares). O pagamento será mensal e antecipado, por Stripe, Wise,
    Pix, transferência ou outro meio informado pela CONTRATADA.
  </p>

  <h2>3. AGENDA, FALTAS E REPOSIÇÕES</h2>
  <p>
    As aulas ocorrerão em horário previamente combinado. A remarcação deverá ser solicitada com, no
    mínimo, 24 (vinte e quatro) horas de antecedência. Faltas sem aviso prévio não geram reposição.
    Problemas técnicos ou de internet que impeçam a aula poderão resultar em reagendamento, mediante
    acordo entre as partes.
  </p>

  <h2>4. CANCELAMENTO</h2>
  <p>
    O contrato poderá ser cancelado a qualquer momento, sem multa. Os valores já pagos não serão
    devolvidos proporcionalmente, pois o horário permanecerá reservado ao(à) aluno(a) durante o
    respectivo ciclo mensal.
  </p>

  <h2>5. RESPONSABILIDADES DO(A) ALUNO(A)</h2>
  <p>
    O(A) aluno(a) deverá possuir o instrumento musical necessário às aulas, acesso à internet,
    câmera, microfone e ambiente adequado. O desenvolvimento dependerá da frequência, dedicação
    e prática individual, não havendo garantia de resultado específico.
  </p>

  <h2>6. MATERIAL DIDÁTICO</h2>
  <p>
    Os materiais fornecidos são de uso pessoal do(a) aluno(a) e não poderão ser vendidos,
    publicados ou compartilhados sem autorização da CONTRATADA.
  </p>

  <h2>7. USO DE IMAGEM</h2>
  <p>
    O(A) aluno(a), ou seu responsável legal, autoriza gratuitamente o uso de imagens, vídeos e
    trechos das aulas em que apareça para divulgação da Lucas Brum Online Music USA em redes
    sociais, site e materiais institucionais. Caso não concorde, deverá informar a CONTRATADA
    antes do início das aulas, e esta cláusula será retirada do contrato.
  </p>

  <h2>8. VIGÊNCIA E ACEITE</h2>
  <p>
    O contrato terá vigência inicial de 6 (seis) meses, com renovação automática, podendo ser
    cancelado conforme a Cláusula 4. A assinatura eletrônica, o aceite por WhatsApp, formulário,
    e-mail ou o primeiro pagamento confirmam a concordância com este contrato.
  </p>

  <h2>9. DISPOSIÇÕES FINAIS</h2>
  <p>
    Este contrato não gera vínculo empregatício. Eventuais alterações deverão ser acordadas entre
    as partes. Fica eleito o foro da comarca de Campo Novo do Parecis/MT para resolver controvérsias,
    ressalvadas as hipóteses legais de foro obrigatório.
  </p>

  <p style="margin-top: 26px;">
    Declaro que li, compreendi e concordo com as condições deste contrato.
  </p>

  <p style="margin-top: 30px; text-align: left;">${dataLocal}</p>

  <div style="margin-top: 56px; page-break-inside: avoid;">
    <div class="assinaturas-linha"></div>
    <p style="text-align: center; margin: 0 0 4px 0; font-size: 12px;">
      <strong>CONTRATADA – Lucas Brum de Castro (professor representante)</strong>
    </p>
    <p style="text-align: center; margin: 0; font-size: 12px;">
      ${data.contractedCompanyName} – CNPJ ${data.contractedCNPJ}
    </p>
  </div>

  ${alunoAssina}
</body>
</html>`;
}

export async function buildContractPdfBytes(data: ContractData): Promise<Uint8Array> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginLeft = 60;
  const marginRight = 60;
  const marginTop = 62;
  const marginBottom = 60;
  const contentWidth = pageWidth - marginLeft - marginRight;
  const lineHeight = 17;
  const yState: { y: number } = { y: marginTop };

  const safeText = (s: string | null | undefined): string => String(s ?? "").replace(/\s+/g, " ");

  function newPageIfNeeded(needLines: number) {
    if (yState.y + needLines * lineHeight > pageHeight - marginBottom) {
      doc.addPage();
      yState.y = marginTop;
    }
  }

  function addParagraph(
    text: string,
    opts?: { align?: "left" | "center" | "justify"; bold?: boolean; size?: number; skipAfter?: number }
  ) {
    const align = opts?.align ?? "justify";
    const bold = Boolean(opts?.bold);
    const size = opts?.size ?? 11;
    doc.setFont("times", bold ? "bold" : "normal");
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(safeText(text), contentWidth);
    newPageIfNeeded(lines.length + 1);
    doc.text(lines, marginLeft, yState.y, { align, maxWidth: contentWidth });
    yState.y += lines.length * lineHeight;
    const skipAfter = typeof opts?.skipAfter === "number" ? opts.skipAfter : 6;
    yState.y += skipAfter;
  }

  function addClauseTitle(text: string) {
    doc.setFont("times", "bold");
    doc.setFontSize(12);
    newPageIfNeeded(2);
    doc.text(safeText(text), marginLeft, yState.y);
    yState.y += lineHeight + 2;
  }

  function addSignatureLine(label: string, subline: string) {
    newPageIfNeeded(6);
    yState.y += 12;
    const lineX1 = marginLeft + contentWidth * 0.1;
    const lineX2 = marginLeft + contentWidth * 0.9;
    doc.setDrawColor(10);
    doc.setLineWidth(0.6);
    doc.line(lineX1, yState.y, lineX2, yState.y);
    yState.y += 14;
    doc.setFont("times", "bold");
    doc.setFontSize(10);
    doc.text(safeText(label), pageWidth / 2, yState.y, { align: "center" });
    yState.y += 13;
    doc.setFont("times", "normal");
    doc.setFontSize(10);
    doc.text(safeText(subline), pageWidth / 2, yState.y, { align: "center" });
    yState.y += 16;
  }

  // Título
  addParagraph("CONTRATO DE PRESTAÇÃO DE SERVIÇOS EDUCACIONAIS", { align: "center", bold: true, size: 13, skipAfter: 0 });
  addParagraph("AULAS ONLINE DE MÚSICA", { align: "center", bold: true, size: 12, skipAfter: 14 });

  // Cabeçalho contratada e dados do aluno
  addParagraph(
    `CONTRATADA: ${data.contractedCompanyName}, inscrita no CNPJ nº ${data.contractedCNPJ}, responsável pela marca Lucas Brum Online Music USA, representada pelo professor ${data.teacherFullName}.`,
    { bold: false, size: 11, skipAfter: 10 },
  );
  addParagraph(`Aluno(a): ${data.studentFullName}`, { bold: false, size: 11, skipAfter: 2 });
  addParagraph(`CPF: ${data.studentCPF}`, { bold: false, size: 11, skipAfter: 2 });
  addParagraph(`Telefone/WhatsApp: ${data.studentPhone}`, { bold: false, size: 11, skipAfter: 2 });
  if (data.legalResponsibleName) {
    addParagraph(`Responsável legal, se menor: ${data.legalResponsibleName}`, { bold: false, size: 11, skipAfter: 2 });
  }
  if (data.legalResponsibleCPF) {
    addParagraph(`CPF do responsável: ${data.legalResponsibleCPF}`, { bold: false, size: 11, skipAfter: 2 });
  }
  yState.y += 6;

  addClauseTitle("1. OBJETO");
  addParagraph(
    `A CONTRATADA prestará ao(à) aluno(a) aulas individuais, online e ao vivo de música, em português, ministradas pelo professor ${data.teacherFullName}, com conteúdo adequado ao nível, ao instrumento escolhido e aos objetivos do(a) aluno(a).`,
  );

  addClauseTitle("2. PLANO, VALOR E PAGAMENTO");
  addParagraph(
    "O plano compreende 1 (uma) aula por semana, com duração de 40 (quarenta) minutos, pelo valor mensal de US$ 119,00 (cento e dezenove dólares). O pagamento será mensal e antecipado, por Stripe, Wise, Pix, transferência ou outro meio informado pela CONTRATADA.",
  );

  addClauseTitle("3. AGENDA, FALTAS E REPOSIÇÕES");
  addParagraph(
    "As aulas ocorrerão em horário previamente combinado. A remarcação deverá ser solicitada com, no mínimo, 24 (vinte e quatro) horas de antecedência. Faltas sem aviso prévio não geram reposição. Problemas técnicos ou de internet que impeçam a aula poderão resultar em reagendamento, mediante acordo entre as partes.",
  );

  addClauseTitle("4. CANCELAMENTO");
  addParagraph(
    "O contrato poderá ser cancelado a qualquer momento, sem multa. Os valores já pagos não serão devolvidos proporcionalmente, pois o horário permanecerá reservado ao(à) aluno(a) durante o respectivo ciclo mensal.",
  );

  addClauseTitle("5. RESPONSABILIDADES DO(A) ALUNO(A)");
  addParagraph(
    "O(A) aluno(a) deverá possuir o instrumento musical necessário às aulas, acesso à internet, câmera, microfone e ambiente adequado. O desenvolvimento dependerá da frequência, dedicação e prática individual, não havendo garantia de resultado específico.",
  );

  addClauseTitle("6. MATERIAL DIDÁTICO");
  addParagraph(
    "Os materiais fornecidos são de uso pessoal do(a) aluno(a) e não poderão ser vendidos, publicados ou compartilhados sem autorização da CONTRATADA.",
  );

  addClauseTitle("7. USO DE IMAGEM");
  addParagraph(
    "O(A) aluno(a), ou seu responsável legal, autoriza gratuitamente o uso de imagens, vídeos e trechos das aulas em que apareça para divulgação da Lucas Brum Online Music USA em redes sociais, site e materiais institucionais. Caso não concorde, deverá informar a CONTRATADA antes do início das aulas, e esta cláusula será retirada do contrato.",
  );

  addClauseTitle("8. VIGÊNCIA E ACEITE");
  addParagraph(
    "O contrato terá vigência inicial de 6 (seis) meses, com renovação automática, podendo ser cancelado conforme a Cláusula 4. A assinatura eletrônica, o aceite por WhatsApp, formulário, e-mail ou o primeiro pagamento confirmam a concordância com este contrato.",
  );

  addClauseTitle("9. DISPOSIÇÕES FINAIS");
  addParagraph(
    "Este contrato não gera vínculo empregatício. Eventuais alterações deverão ser acordadas entre as partes. Fica eleito o foro da comarca de Campo Novo do Parecis/MT para resolver controvérsias, ressalvadas as hipóteses legais de foro obrigatório.",
  );

  yState.y += 10;
  addParagraph("Declaro que li, compreendi e concordo com as condições deste contrato.");

  yState.y += 12;
  const localData = data.studentCity && data.studentCity.trim()
    ? `${data.studentCity}, ${formatLocalizedDateSigned(data.signedAtIso)}.`
    : `${formatLocalizedDateSigned(data.signedAtIso)}.`;
  addParagraph(localData, { align: "left", skipAfter: 10 });

  addSignatureLine(
    "CONTRATADA – Lucas Brum de Castro (professor representante)",
    `${data.contractedCompanyName} – CNPJ ${data.contractedCNPJ}`,
  );

  const alunoOuResponsavelLabel = data.legalResponsibleName
    ? `Responsável legal / Assinatura do(a) aluno(a): ${data.signedByLabel}`
    : `Aluno(a): ${data.signedByLabel}`;
  addSignatureLine(alunoOuResponsavelLabel, `CPF: ${data.signedByCPF}`);

  const arrayBuffer = doc.output("arraybuffer");
  return new Uint8Array(arrayBuffer);
}

export function buildContractFileName(lead: Partial<AtendimentoLead>): string {
  const nameSnake = String(lead.full_name ?? "contrato")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 60) || "contrato";
  return `contrato_${nameSnake}_${Date.now()}.pdf`;
}

export { firstTwoNamesFromFullName };
export { isLessThan18YearsOld };
