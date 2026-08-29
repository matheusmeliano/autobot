const fs = require("fs");
const path = require("path");

const root = __dirname;

const patches = [
  {
    file: "src/components/app/atendimento/AtendimentoSummaryCards.tsx",
    rules: [
      {
        from: `function isLeadRepescagem(lead: AtendimentoLeadListItem | null | undefined) {
  if (!lead) return false;
  const stage = String((lead as any)?.funnel_stage ?? "").trim().toLowerCase();
  const st = String((lead as any)?.status ?? "").trim().toLowerCase();
  return (
    stage === "repescagem" ||
    st === "repescagem" ||
    stage === "matricula_pendente_recusada" ||
    st === "matricula_pendente_recusada"
  );
}`,
        to: `function isLeadRepescagem(_lead: AtendimentoLeadListItem | null | undefined) {
  return false;
}`,
      },
      {
        from: `function RepescagemBadge({ className = "" }: { className?: string }) {
  return (
    <div
      className={[
        "inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-100",
        className,
      ].join(" ")}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
      Repescagem
    </div>
  );
}`,
        to: `function RepescagemBadge(_props?: { className?: string }) {
  return null;
}`,
      },
      {
        from: `        "contrato_aguardando_aceite",
        "contrato_assinado",
        "cadastro_recorrente_pendente_plataforma",
        "aluno_recorrente_cadastrado",
        "repescagem",
      ];`,
        to: `        "contrato_aguardando_aceite",
        "contrato_assinado",
        "cadastro_recorrente_pendente_plataforma",
        "aluno_recorrente_cadastrado",
      ];`,
      },
      {
        from: `          : "Aluno marcado para repescagem manual.",`,
        to: `          : "Aluno marcado como não compareceu.",`,
      },
    ],
  },
  {
    file: "src/app/api/atendimento/bookings/[bookingId]/attendance/route.ts",
    rules: [
      {
        from: `        if (attendance === "no_show") {
          patchLead.experimental_class_link = null;
          patchLead.experimental_class_student_notification_sent_at = null;
          patchLead.experimental_class_attendant_notification_sent_at = null;
          patchLead.funnel_stage = "repescagem";
          patchLead.status = "repescagem";
        }`,
        to: `        if (attendance === "no_show") {
          patchLead.experimental_class_link = null;
          patchLead.experimental_class_student_notification_sent_at = null;
          patchLead.experimental_class_attendant_notification_sent_at = null;
          patchLead.funnel_stage = "matricula_pendente_recusada";
          patchLead.status = "matricula_pendente_recusada";
        }`,
      },
      {
        from: `  } else if (attendance === "no_show") {
    nextLeadFunnelStage = "repescagem";
    nextLeadStatus = "repescagem";
  }`,
        to: `  } else if (attendance === "no_show") {
    nextLeadFunnelStage = "matricula_pendente_recusada";
    nextLeadStatus = "matricula_pendente_recusada";
  }`,
      },
    ],
  },
  {
    file: "src/lib/atendimento/constants.ts",
    rules: [
      {
        from: `  repescagem: "Repescagem",
  encerrado: "Encerrado",
};`,
        to: `  repescagem: "",
  encerrado: "Encerrado",
};`,
      },
      {
        from: `  matriculado: "Matrícula Concluída",
  aluno: "Aluno",
  repescagem: "Repescagem",`,
        to: `  matriculado: "Matrícula Concluída",
  aluno: "Aluno",
  repescagem: "",`,
      },
    ],
  },
];

let allOk = true;
for (const p of patches) {
  const fpath = path.join(root, p.file);
  let s = fs.readFileSync(fpath, "utf8");
  for (const rule of p.rules) {
    if (!s.includes(rule.from)) {
      console.error(`[FAIL] OLD not found in ${p.file}: ${rule.from.slice(0, 80).replace(/\n/g, "\\n")}`);
      allOk = false;
      continue;
    }
    s = s.split(rule.from).join(rule.to);
    console.log(`[OK] patched ${p.file}`);
  }
  fs.writeFileSync(fpath, s);
}
process.exit(allOk ? 0 : 2);
