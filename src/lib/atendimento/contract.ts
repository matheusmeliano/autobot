import type { AtendimentoLead } from "./types.ts";

export type ContractData = {
  studentFullName: string;
  classWeekdayLabel: string;
  classTimeLabel: string;
  signedAtIso: string;
  durationMin: number;
  weeklyFrequency: number;
  monthlyUsd: string;
  initialPlannedMonths: number;
};

export function buildContractData(params: {
  lead: Partial<AtendimentoLead>;
  overrideWeekdayLabel?: string | null;
  overrideTimeLabel?: string | null;
  overrideSignedAtIso?: string | null;
}): ContractData {
  const lead = params.lead ?? {};

  const weekdayLabelRaw =
    (params.overrideWeekdayLabel != null &&
      typeof params.overrideWeekdayLabel === "string" &&
      params.overrideWeekdayLabel.trim() !== ""
      ? params.overrideWeekdayLabel
      : null) ??
    (typeof (lead as any).recurring_class_weekday_label === "string" &&
    String((lead as any).recurring_class_weekday_label ?? "").trim() !== ""
      ? String((lead as any).recurring_class_weekday_label)
      : typeof (lead as any).recurring_class_weekday === "string" &&
          String((lead as any).recurring_class_weekday ?? "").trim() !== ""
        ? String((lead as any).recurring_class_weekday)
        : "");

  const weekdayMap: Record<string, string> = {
    mon: "Segunda-feira",
    tue: "Terça-feira",
    wed: "Quarta-feira",
    thu: "Quinta-feira",
    fri: "Sexta-feira",
    sat: "Sábado",
    sun: "Domingo",
  };
  const classWeekdayLabel =
    weekdayLabelRaw.trim() !== ""
      ? weekdayLabelRaw.trim()
      : (typeof (lead as any).recurring_class_weekday === "string" &&
          weekdayMap[String((lead as any).recurring_class_weekday).toLowerCase()]
        ? weekdayMap[String((lead as any).recurring_class_weekday).toLowerCase()]
        : "");

  const timeRaw =
    (params.overrideTimeLabel != null &&
      typeof params.overrideTimeLabel === "string" &&
      params.overrideTimeLabel.trim() !== ""
      ? params.overrideTimeLabel
      : null) ??
    (typeof (lead as any).recurring_class_lead_time === "string" &&
    String((lead as any).recurring_class_lead_time ?? "").trim() !== ""
      ? String((lead as any).recurring_class_lead_time)
      : typeof (lead as any).recurring_class_professor_time === "string" &&
          String((lead as any).recurring_class_professor_time ?? "").trim() !== ""
        ? String((lead as any).recurring_class_professor_time)
        : "");
  const classTimeLabel = (() => {
    const s = timeRaw.trim();
    if (!s) return "";
    const m = s.match(/(\d{1,2})[:hH](\d{2})/);
    if (m) {
      return `${m[1]}:${m[2]}h`;
    }
    if (/^\d{1,2}\d{2}$/.test(s)) {
      return `${s.slice(0, s.length - 2)}:${s.slice(-2)}h`;
    }
    return s;
  })();

  const signedAtIso =
    (params.overrideSignedAtIso != null &&
      typeof params.overrideSignedAtIso === "string" &&
      params.overrideSignedAtIso.trim() !== ""
      ? params.overrideSignedAtIso
      : null) ?? new Date().toISOString();

  return {
    studentFullName: String(lead.full_name ?? "").trim() || "ALUNO(A)",
    classWeekdayLabel: classWeekdayLabel || "-",
    classTimeLabel: classTimeLabel || "-",
    signedAtIso,
    durationMin: 40,
    weeklyFrequency: 1,
    monthlyUsd: "US$ 119,00",
    initialPlannedMonths: 6,
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
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
  ];
  const mes = meses[d.getMonth()] ?? "";
  const ano = String(d.getFullYear());
  return [dia, mes, ano].join(" de ");
}

export function buildContractHtml(data: ContractData): string {
  const dataLocal = formatLocalizedDateSigned(data.signedAtIso);
  const diaAula = data.classWeekdayLabel || "-";
  const horarioAula = data.classTimeLabel || "-";

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Confirmação de Matrícula</title>
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
    margin: 0 0 22px 0;
    letter-spacing: 0.02em;
  }
  h1 .brand { font-weight: 700; }
  h1 .title { font-weight: 700; display: block; margin-top: 6px; }
  p { margin: 0 0 14px 0; text-align: justify; }
  .lead { font-size: 14px; margin-bottom: 20px; }
  .block { margin: 22px 0 6px 0; }
  .k { display: inline-block; min-width: 150px; }
  .assinaturas-linha {
    border-top: 1px solid #111;
    width: 80%;
    margin: 0 auto 10px auto;
  }
</style>
</head>
<body>
  <h1>
    <span class="brand">LUCAS BRUM ONLINE MUSIC USA</span>
    <span class="title">CONFIRMAÇÃO DE MATRÍCULA</span>
  </h1>

  <p class="lead">
    Eu, <strong>${data.studentFullName}</strong>, confirmo minha matrícula na Lucas Brum Online Music USA para participar de aulas individuais e online de música.
  </p>

  <p class="block"><span class="k"><strong>Dia da aula:</strong></span><strong>${diaAula}</strong></p>
  <p class="block" style="margin-top:4px;"><span class="k"><strong>Horário:</strong></span><strong>${horarioAula}</strong></p>
  <p class="block" style="margin-top:4px;"><span class="k"><strong>Frequência:</strong></span>${data.weeklyFrequency} aula por semana</p>
  <p class="block" style="margin-top:4px;"><span class="k"><strong>Duração:</strong></span>${data.durationMin} minutos por aula</p>
  <p class="block" style="margin-top:4px;"><span class="k"><strong>Mensalidade:</strong></span><strong>${data.monthlyUsd}</strong></p>

  <p class="block"><span class="k"><strong>Plano:</strong></span>Inicialmente previsto para ${data.initialPlannedMonths} meses, podendo ser cancelado a qualquer momento, sem multa.</p>

  <p class="block"><span class="k"><strong>Pagamento:</strong></span>A mensalidade de ${data.monthlyUsd} será paga pela forma de pagamento selecionada pelo aluno no processo de matrícula.</p>

  <p class="block" style="margin-top: 26px;">Documento simplificado para confirmação eletrônica de matrícula.</p>

  <p style="margin-top: 30px; text-align: left;">${dataLocal}.</p>

  <div style="margin-top: 64px; page-break-inside: avoid;">
    <div class="assinaturas-linha"></div>
    <p style="text-align: center; margin: 0 0 4px 0; font-size: 12px;">
      <strong>Aluno(a): ${data.studentFullName}</strong>
    </p>
    <p style="text-align: center; margin: 0; font-size: 12px;">
      Confirmação eletrônica de matrícula
    </p>
  </div>

  <div style="margin-top: 56px; page-break-inside: avoid;">
    <div class="assinaturas-linha"></div>
    <p style="text-align: center; margin: 0 0 4px 0; font-size: 12px;">
      <strong>LUCAS BRUM ONLINE MUSIC USA</strong>
    </p>
    <p style="text-align: center; margin: 0; font-size: 12px;">
      Lucas Brum de Castro (professor responsável)
    </p>
  </div>
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

  const safeText = (s: string | null | undefined): string =>
    String(s ?? "").replace(/\s+/g, " ");

  function newPageIfNeeded(needLines: number) {
    if (yState.y + needLines * lineHeight > pageHeight - marginBottom) {
      doc.addPage();
      yState.y = marginTop;
    }
  }

  function addParagraph(
    text: string,
    opts?: {
      align?: "left" | "center" | "justify";
      bold?: boolean;
      size?: number;
      skipAfter?: number;
    },
  ) {
    const align = opts?.align ?? "justify";
    const bold = Boolean(opts?.bold);
    const size = opts?.size ?? 11;
    doc.setFont("times", bold ? "bold" : "normal");
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(safeText(text), contentWidth);
    newPageIfNeeded(lines.length + 1);
    const textX = align === "center" ? marginLeft + contentWidth / 2 : marginLeft;
    for (let i = 0; i < lines.length; i++) {
      doc.text(lines[i], textX, yState.y + i * lineHeight, {
        align,
        maxWidth: contentWidth,
      });
    }
    yState.y += lines.length * lineHeight;
    const skipAfter = typeof opts?.skipAfter === "number" ? opts.skipAfter : 8;
    yState.y += skipAfter;
  }

  function addKeyValuePair(key: string, value: string, opts?: { valueBold?: boolean }) {
    doc.setFont("times", "bold");
    doc.setFontSize(11);
    const keyText = safeText(key);
    const keyWidth = doc.getTextWidth(keyText) + 8;
    newPageIfNeeded(2);
    doc.text(keyText, marginLeft, yState.y);

    doc.setFont("times", opts?.valueBold === false ? "normal" : "bold");
    doc.text(safeText(value), marginLeft + keyWidth, yState.y, {
      maxWidth: contentWidth - keyWidth,
    });
    yState.y += lineHeight + 4;
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
  addParagraph("LUCAS BRUM ONLINE MUSIC USA", {
    align: "center",
    bold: true,
    size: 13,
    skipAfter: 2,
  });
  addParagraph("CONFIRMAÇÃO DE MATRÍCULA", {
    align: "center",
    bold: true,
    size: 13,
    skipAfter: 22,
  });

  // Parágrafo inicial
  addParagraph(
    `Eu, ${data.studentFullName}, confirmo minha matrícula na Lucas Brum Online Music USA para participar de aulas individuais e online de música.`,
    { bold: false, size: 12, skipAfter: 18 },
  );

  // Bloco chave-valor
  addKeyValuePair("Dia da aula:", data.classWeekdayLabel || "-");
  addKeyValuePair("Horário:", data.classTimeLabel || "-");
  addKeyValuePair(
    "Frequência:",
    `${data.weeklyFrequency} aula por semana`,
    { valueBold: false },
  );
  addKeyValuePair(
    "Duração:",
    `${data.durationMin} minutos por aula`,
    { valueBold: false },
  );
  addKeyValuePair("Mensalidade:", data.monthlyUsd);

  yState.y += 6;

  addKeyValuePair(
    "Plano:",
    `Inicialmente previsto para ${data.initialPlannedMonths} meses, podendo ser cancelado a qualquer momento, sem multa.`,
    { valueBold: false },
  );

  addKeyValuePair(
    "Pagamento:",
    `A mensalidade de ${data.monthlyUsd} será paga pela forma de pagamento selecionada pelo aluno no processo de matrícula.`,
    { valueBold: false },
  );

  yState.y += 6;
  addParagraph("Documento simplificado para confirmação eletrônica de matrícula.", {
    bold: false,
    size: 11,
    skipAfter: 10,
  });

  addParagraph(`${formatLocalizedDateSigned(data.signedAtIso)}.`, {
    align: "left",
    skipAfter: 12,
  });

  addSignatureLine(
    `Aluno(a): ${data.studentFullName}`,
    "Confirmação eletrônica de matrícula",
  );

  addSignatureLine(
    "LUCAS BRUM ONLINE MUSIC USA",
    "Lucas Brum de Castro (professor responsável)",
  );

  const arrayBuffer = doc.output("arraybuffer");
  return new Uint8Array(arrayBuffer);
}

export function buildContractFileName(lead: Partial<AtendimentoLead>): string {
  const nameSnake = String(lead.full_name ?? "confirmacao_matricula")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 60) || "confirmacao_matricula";
  return `confirmacao_matricula_${nameSnake}_${Date.now()}.pdf`;
}
