import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { findLeadByPhone, triggerRecurringPaymentIntentIfNeeded } from "@/lib/atendimento/server";
import { ATENDIMENTO_STAGE_ORDER, ATENDIMENTO_STATUS_ORDER } from "@/lib/atendimento/constants";
import { RECURRING_WEEKDAY_LABELS_PT_BR } from "@/lib/atendimento/experimentalClass";

function toErrorMessage(raw: unknown, fallback = "Erro desconhecido."): string {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw === "string") {
    const s = raw.trim();
    return s || fallback;
  }
  if (raw instanceof Error) {
    const m = raw.message?.trim();
    return m || fallback;
  }
  if (typeof raw === "object") {
    const any = raw as Record<string, unknown>;
    const candidates = [any.message, any.error, any.error_message, any.msg, any.detail];
    for (const c of candidates) {
      if (typeof c === "string" && c.trim()) return c.trim();
    }
    try {
      return JSON.stringify(raw);
    } catch {
      return String(raw) || fallback;
    }
  }
  return String(raw) || fallback;
}

function toNomeESobrenome(raw: string | null | undefined): string {
  const clean = String(raw ?? "").trim();
  if (!clean) return "";
  const parts = clean.split(/\s+/).filter((s) => s && s.trim());
  if (parts.length <= 2) return clean;
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

function isLeadRecurringRegistrationConcluded(lead: unknown): boolean {
  const obj = (lead ?? {}) as Record<string, unknown>;
  const payStatusRaw = String(obj?.payment_status ?? "").trim().toLowerCase();
  const payConfirmedAtRaw = String(obj?.payment_confirmed_at ?? "").trim();
  const leadStatusRaw = String(obj?.status ?? "").trim().toLowerCase();
  const funnelRaw = String(obj?.funnel_stage ?? "").trim().toLowerCase();
  return (
    payStatusRaw === "confirmado" ||
    payStatusRaw === "matriculado" ||
    Boolean(payConfirmedAtRaw && payConfirmedAtRaw !== "null") ||
    leadStatusRaw === "matriculado" ||
    leadStatusRaw === "matricula_confirmada" ||
    funnelRaw === "matriculado" ||
    funnelRaw === "matricula_confirmada"
  );
}

function isUndefinedColumnErrorDraft(error: unknown): boolean {
  const code = String((error as any)?.code ?? "").trim();
  if (code === "42703") return true;
  const msg = String(error instanceof Error ? error.message : (error as any)?.message ?? "").toLowerCase();
  return msg.includes("column") && msg.includes("does not exist");
}

function buildEnrollmentNumberDraft({
  existingMax,
  createdAt,
  uuidHead,
}: {
  existingMax: string | null;
  createdAt: string | null;
  uuidHead: string | null;
}) {
  let seq = 1;
  if (existingMax) {
    const stripped = String(existingMax).replace(/\D+/g, "");
    if (/^\d+$/.test(stripped)) {
      const parsed = Number.parseInt(stripped, 10);
      if (Number.isFinite(parsed) && parsed >= 0) {
        seq = parsed + 1;
      }
    }
  }
  if (seq < 100000) seq = Math.max(seq, 100000);
  const digits = String(seq).padStart(6, "0");
  const dvRaw = (() => {
    try {
      let sum = 0;
      for (let i = 0; i < digits.length; i++) {
        const n = Number(digits[i] ?? 0);
        const weight = (digits.length - i) + 2;
        sum += n * weight;
      }
      const mod = sum % 11;
      const d = 11 - mod;
      return String(d >= 10 ? 0 : d);
    } catch {
      return "0";
    }
  })();
  const year = (() => {
    try {
      const d = createdAt ? new Date(createdAt) : new Date();
      if (Number.isFinite(d.getTime())) return String(d.getUTCFullYear());
      return String(new Date().getUTCFullYear());
    } catch {
      return String(new Date().getUTCFullYear());
    }
  })();
  const tail = (() => {
    const clean = String(uuidHead ?? "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 3).toUpperCase();
    if (clean.length >= 2) return clean;
    try {
      return Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(3, "X");
    } catch {
      return "AAA";
    }
  })();
  return `LB${year}${digits}${dvRaw}${tail}`;
}

export const runtime = "nodejs";

type DraftPayload = {
  telefone: string;
  nome?: string | null;
  weekday?: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun" | null;
  weekdayLabel?: string | null;
  professorTime?: string | null;
  leadTime?: string | null;
  step?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | null;
  password?: string | null;
  state?: string | null;
  city?: string | null;
  country?: string | null;
  timezone?: string | null;
  leadId?: string | null;
  lead_id?: string | null;
};

export async function GET(req: NextRequest) {
  try {
    const admin = createSupabaseAdminClient();
    const sp = req.nextUrl.searchParams;
    const telefoneRaw = String(sp.get("telefone") ?? "").trim();
    const safePhoneDigits = telefoneRaw.replace(/\D/g, "").trim();
    if (safePhoneDigits.length < 10) {
      return NextResponse.json({ ok: false, error: "telefone obrigatório" }, { status: 400 });
    }
    const normalizedPhone = safePhoneDigits;
    let data: any = null;
    try {
      const selFull = await admin
        .from("atendimento_leads")
        .select("*")
        .eq("phone", normalizedPhone)
        .limit(1)
        .maybeSingle();
      if (!selFull.error) {
        data = selFull.data ?? null;
      } else if (/column.*does not exist|PGRST204|42703/i.test(String(selFull.error?.message ?? ""))) {
          const fallback = await admin
            .from("atendimento_leads")
            .select("id, phone, full_name, cpf, legal_responsible_name, legal_responsible_cpf, contract_pdf_url, contract_signed_at, state, city, country, timezone, recurring_registration_step, signup_password_raw_temp, recurring_registration_password, recurring_class_weekday, recurring_class_weekday_label, recurring_class_professor_time, recurring_class_lead_time, recurring_class_professor_name, plan_name, plan_monthly_value, payment_status, payment_confirmed_at, status, funnel_stage, enrollment_number, student_email, email")
            .eq("phone", normalizedPhone)
            .limit(1)
            .maybeSingle();
          data = fallback?.data ?? null;
        } else {
          throw selFull.error;
        }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e ?? "");
      if (/column.*does not exist|PGRST204|42703/i.test(msg)) {
        try {
          const fallback = await admin
            .from("atendimento_leads")
            .select("id, phone, full_name, cpf, legal_responsible_name, legal_responsible_cpf, contract_pdf_url, contract_signed_at, state, city, country, timezone, recurring_registration_step, signup_password_raw_temp, recurring_registration_password, recurring_class_weekday, recurring_class_weekday_label, recurring_class_professor_time, recurring_class_lead_time, recurring_class_professor_name, plan_name, plan_monthly_value, payment_status, payment_confirmed_at, status, funnel_stage, enrollment_number, student_email, email")
            .eq("phone", normalizedPhone)
            .limit(1)
            .maybeSingle();
          data = fallback?.data ?? null;
        } catch {
          data = null;
        }
      } else {
        throw e;
      }
    }
    if (!data) {
      return NextResponse.json(
        {
          ok: false,
          blocked: true,
          error:
            "Acesso bloqueado. Seu cadastro foi excluído. Para acessar novamente, inicie um novo atendimento pelo WhatsApp.",
        },
        { status: 403 },
      );
    }

    const curLeadStatus = String((data as any).status ?? "").trim().toLowerCase();
    const curFunnelStage = String((data as any).funnel_stage ?? "").trim().toLowerCase();
    const curContractStatus = String((data as any).contract_status ?? "").trim().toLowerCase();
    const curPaymentStatus = String((data as any).payment_status ?? "").trim().toLowerCase();
    const curRecurringClassStatus = String((data as any).recurring_class_status ?? "").trim().toLowerCase();
    let existingEnrollmentNumber = String((data as any).enrollment_number ?? "").trim();
    const existingContractSignedAtRaw = String((data as any).contract_signed_at ?? "").trim();
    const existingContractPdfUrl = String((data as any).contract_pdf_url ?? "").trim();
    const existingRecurringRegistrationPassword = String((data as any).recurring_registration_password ?? "").trim();
    const existingSignupPasswordRawTemp = String((data as any).signup_password_raw_temp ?? "").trim();
    const hasAnySavedPassword = Boolean(existingRecurringRegistrationPassword || existingSignupPasswordRawTemp);

    const stepRaw = (data as any)?.recurring_registration_step;
    const parsedStep =
      typeof stepRaw === "number" && stepRaw >= 0 && stepRaw <= 6
        ? (stepRaw as 0 | 1 | 2 | 3 | 4 | 5 | 6)
        : 0;

    const isMatriculaConcluida = isLeadRecurringRegistrationConcluded(data);

    if (isMatriculaConcluida && !existingEnrollmentNumber) {
      try {
        let existingMax: string | null = null;
        try {
          const { data: maxRow, error: maxErr } = await (admin as any)
            .from("atendimento_leads")
            .select("enrollment_number")
            .not("enrollment_number", "is", null)
            .neq("enrollment_number", "")
            .order("enrollment_number", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (!maxErr && maxRow) existingMax = String((maxRow as any)?.enrollment_number ?? "").trim() || null;
        } catch {
          existingMax = null;
        }
        const generatedEnrollment = buildEnrollmentNumberDraft({
          existingMax,
          createdAt: String((data as any)?.created_at ?? "").trim() || null,
          uuidHead: String((data as any)?.id ?? "").trim().split("-")[0] ?? null,
        });
        if (generatedEnrollment) {
          let persisted = false;
          try {
            const { error: updErr } = await admin
              .from("atendimento_leads")
              .update({ enrollment_number: generatedEnrollment } as any)
              .eq("id", String((data as any).id));
            if (!updErr) {
              persisted = true;
            } else if (isUndefinedColumnErrorDraft(updErr)) {
              persisted = true;
            }
          } catch (err) {
            if (isUndefinedColumnErrorDraft(err)) {
              persisted = true;
            }
          }
          if (persisted) {
            (data as any).enrollment_number = generatedEnrollment;
            existingEnrollmentNumber = generatedEnrollment;
          }
        }
      } catch {}
    }

    const readStr = (key: string) => {
      const v = (data as any)?.[key];
      return typeof v === "string" && v.trim() ? v.trim() : null;
    };
    return NextResponse.json({
      ok: true,
      lead: {
        id: (data as any).id,
        phone: String((data as any).phone ?? ""),
        full_name: readStr("full_name"),
        contract_pdf_url: readStr("contract_pdf_url"),
        contract_signed_at: readStr("contract_signed_at"),
        state: readStr("state"),
        city: readStr("city"),
        country: readStr("country"),
        timezone: readStr("timezone"),
        enrollment_number: readStr("enrollment_number"),
        student_email: readStr("student_email"),
        email: readStr("email"),
        recurring_class_weekday: readStr("recurring_class_weekday"),
        recurring_class_weekday_label: readStr("recurring_class_weekday_label"),
        recurring_class_professor_time: readStr("recurring_class_professor_time"),
        recurring_class_lead_time: readStr("recurring_class_lead_time"),
        recurring_class_professor_name: readStr("recurring_class_professor_name"),
        plan_name: readStr("plan_name"),
        plan_monthly_value: readStr("plan_monthly_value"),
        payment_status: readStr("payment_status"),
        payment_confirmed_at: readStr("payment_confirmed_at"),
        status: readStr("status"),
        funnel_stage: readStr("funnel_stage"),
        recurring_matricula_concluida_dismissed_at: readStr("recurring_matricula_concluida_dismissed_at"),
      },
      progress: {
        step: parsedStep,
        has_password: Boolean(String((data as any).recurring_registration_password ?? "").trim()),
        recurring_class_weekday: readStr("recurring_class_weekday"),
        recurring_class_weekday_label: readStr("recurring_class_weekday_label"),
        recurring_class_professor_time: readStr("recurring_class_professor_time"),
        recurring_class_lead_time: readStr("recurring_class_lead_time"),
      },
      is_matricula_concluida: isMatriculaConcluida,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e ?? "Erro GET recorrente draft.") },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const rawBody = (await req.json().catch(() => null)) as DraftPayload | null;
    if (!rawBody || typeof rawBody !== "object") {
      return NextResponse.json({ ok: false, error: "Corpo inválido." }, { status: 400 });
    }
    const { telefone, nome, weekday, weekdayLabel, professorTime, leadTime, step, password, state, city, country, timezone, leadId, lead_id } =
      rawBody as DraftPayload;

    const safePhoneDigits = String(telefone ?? "").replace(/\D/g, "").trim();
    const safeLeadId = String(leadId ?? lead_id ?? "").trim();
    if (!safeLeadId && safePhoneDigits.length < 10) {
      return NextResponse.json({ ok: false, error: "Telefone inválido." }, { status: 400 });
    }

    const safeNome = toNomeESobrenome(nome);
    const safeState = String(state ?? "").trim();
    const safeCity = String(city ?? "").trim();
    const safeCountry = String(country ?? "").trim();
    const safeTimezone = String(timezone ?? "").trim();

    const safeWeekday = weekday ? String(weekday).trim().toLowerCase() : "";
    const validWeekday = safeWeekday && ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(safeWeekday)
      ? (safeWeekday as "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun")
      : null;

    const safeProfessorTime = String(professorTime ?? "").trim();
    const safeLeadTime = String(leadTime ?? "").trim();
    const hasAnyTime = Boolean(safeProfessorTime || safeLeadTime);

    const safeStepRaw =
      typeof step === "number" && Number.isInteger(step) && step >= 0 && step <= 6 ? step : null;

    const safePassword =
      typeof password === "string" && password.trim().length >= 4 ? password.trim() : null;

    const hasAnyPayload =
      Boolean(validWeekday) ||
      hasAnyTime ||
      Boolean(safeNome) ||
      safeStepRaw !== null ||
      Boolean(safePassword) ||
      Boolean(safeState) ||
      Boolean(safeCity) ||
      Boolean(safeCountry) ||
      Boolean(safeTimezone);

    if (!hasAnyPayload) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Informe pelo menos dia, horário, nome, etapa do passo (step) ou senha para salvar o progresso.",
        },
        { status: 400 },
      );
    }

    const admin = createSupabaseAdminClient();
    let lead: any = null;
    if (safeLeadId) {
      try {
        const { data: leadById } = await admin
          .from("atendimento_leads")
          .select("*")
          .eq("id", safeLeadId)
          .limit(1)
          .maybeSingle();
        lead = leadById ?? null;
      } catch {}
    }
    if (!lead?.id && safePhoneDigits) {
      lead = await findLeadByPhone({ phone: safePhoneDigits });
    }
    if (!lead?.id && safePhoneDigits) {
      try {
        function phoneCandidates(base: string): string[] {
          const out = new Set<string>();
          out.add(base);
          if (base.startsWith("55") && base.length >= 12) out.add(base.slice(2));
          else if (base.length >= 10 && !base.startsWith("55")) out.add(`55${base}`);
          if (base.length === 10 && !base.startsWith("55")) {
            const ddd = base.slice(0, 2); const rest = base.slice(2);
            out.add(`${ddd}9${rest}`); out.add(`55${ddd}9${rest}`);
          } else if (base.length === 11 && !base.startsWith("55") && base[2] === "9") {
            const ddd = base.slice(0, 2); const rest = base.slice(3);
            out.add(`${ddd}${rest}`); out.add(`55${ddd}${rest}`);
          } else if (base.length === 13 && base.startsWith("55") && base[4] === "9") {
            const ddd = base.slice(2, 4); const rest = base.slice(5);
            out.add(`55${ddd}${rest}`); out.add(`${ddd}${rest}`);
          } else if (base.length === 12 && base.startsWith("55")) {
            const ddd = base.slice(2, 4); const rest = base.slice(4);
            out.add(`55${ddd}9${rest}`); out.add(`${ddd}9${rest}`);
          }
          return Array.from(out);
        }
        const cands = phoneCandidates(safePhoneDigits);
        const fallbackSel = await admin
          .from("atendimento_leads")
          .select("*")
          .in("phone", cands)
          .order("created_at", { ascending: false })
          .limit(5)
          .maybeSingle();
        if (!fallbackSel.error && fallbackSel.data && (fallbackSel.data as any).id) {
          lead = fallbackSel.data as any;
        }
      } catch {}
    }
    if (!lead?.id) {
      return NextResponse.json(
        {
          ok: false,
          blocked: true,
          error:
            "Acesso bloqueado. Seu cadastro foi excluído. Para acessar novamente, inicie um novo atendimento pelo WhatsApp.",
        },
        { status: 403 },
      );
    }

    const nowIso = new Date().toISOString();
    const patch: Record<string, unknown> = {
      updated_at: nowIso,
    };

    const currentStatus = String((lead as any)?.status ?? "").trim().toLowerCase();
    const currentFunnel = String((lead as any)?.funnel_stage ?? "").trim().toLowerCase();
    const currentRcs = String((lead as any)?.recurring_class_status ?? "").trim().toLowerCase();
    const currentContractStatus = String((lead as any)?.contract_status ?? "").trim().toLowerCase();
    const existingContractSignedAtRaw = String((lead as any)?.contract_signed_at ?? "").trim();
    const existingContractPdfUrl = String((lead as any)?.contract_pdf_url ?? "").trim();
    const existingPaymentStatus = String((lead as any)?.payment_status ?? "").trim().toLowerCase();
    const isContractFormallySignedAlready =
      currentContractStatus === "assinado" ||
      Boolean(existingContractSignedAtRaw && existingContractSignedAtRaw !== "null") ||
      Boolean(existingContractPdfUrl);
    const currentStageIdx = ATENDIMENTO_STAGE_ORDER.indexOf(
      (currentFunnel as (typeof ATENDIMENTO_STAGE_ORDER)[number]) ??
        ("" as (typeof ATENDIMENTO_STAGE_ORDER)[number]),
    );
    const currentStatusIdx = ATENDIMENTO_STATUS_ORDER.indexOf(
      (currentStatus as (typeof ATENDIMENTO_STATUS_ORDER)[number]) ??
        ("" as (typeof ATENDIMENTO_STATUS_ORDER)[number]),
    );

    function applyForwardOnlyFunnelAndStatus(target: { funnel?: (typeof ATENDIMENTO_STAGE_ORDER)[number] | null; status?: (typeof ATENDIMENTO_STATUS_ORDER)[number] | null; contractStatus?: "coletando_dados" | "aguardando_aceite" | "assinado" | null }) {
      if (target.funnel) {
        const idx = ATENDIMENTO_STAGE_ORDER.indexOf(target.funnel);
        if (idx >= 0 && (currentStageIdx < 0 || currentStageIdx < idx)) {
          patch.funnel_stage = target.funnel;
        }
      }
      if (target.status) {
        const idx = ATENDIMENTO_STATUS_ORDER.indexOf(target.status);
        if (idx >= 0 && (currentStatusIdx < 0 || currentStatusIdx < idx)) {
          patch.status = target.status;
        }
      }
      if (target.contractStatus) {
        const cs = currentContractStatus;
        const rank: Record<string, number> = { coletando_dados: 1, aguardando_aceite: 2, assinado: 3 };
        const cur = rank[cs] ?? 0;
        const tgt = rank[target.contractStatus] ?? 0;
        if (tgt > cur) {
          patch.contract_status = target.contractStatus;
        }
      }
    }

    function shouldPromoteToAlunosSection(): boolean {
      const stChain = new Set([
        "matriculado",
        "aluno",
        "cadastro_recorrente_pendente_plataforma",
        "contrato_assinado",
        "contrato_aguardando_aceite",
        "contrato_coletando_dados",
        "matricula_confirmada",
      ]);
      if (stChain.has(currentStatus) || stChain.has(currentFunnel)) return false;
      if (currentRcs === "confirmado" || currentRcs === "cadastro_plataforma_pendente") return false;

      // REGRA GERAL: só promove para Alunos APÓS concluir a etapa de REGISTRO (e-mail + senha).
      // Acessar link, informar dia/horário ou avançar steps parciais NÃO são suficientes.
      if (safePassword) return true;
      return false;
    }

    if (shouldPromoteToAlunosSection()) {
      patch.status = patch.status ?? "aluno";
      patch.funnel_stage = patch.funnel_stage ?? "cadastro_recorrente_pendente_plataforma";
      if (!currentRcs) {
        patch.recurring_class_status = "cadastro_plataforma_pendente";
      }
    }

    if (validWeekday) {
      patch.recurring_class_weekday = validWeekday;
      const safeLabel =
        String(weekdayLabel ?? "").trim() ||
        RECURRING_WEEKDAY_LABELS_PT_BR[validWeekday as keyof typeof RECURRING_WEEKDAY_LABELS_PT_BR] ||
        "";
      if (safeLabel) patch.recurring_class_weekday_label = safeLabel;
    }
    if (safeProfessorTime) patch.recurring_class_professor_time = safeProfessorTime;
    if (safeLeadTime) patch.recurring_class_lead_time = safeLeadTime;
    else if (safeProfessorTime && !String((lead as any)?.recurring_class_lead_time ?? "").trim()) {
      patch.recurring_class_lead_time = safeProfessorTime;
    }

    if (safeNome) {
      patch.full_name = safeNome;
    }
    if (safeState) {
      patch.state = safeState;
    }
    if (safeCity) {
      patch.city = safeCity;
    }
    if (safeCountry) {
      patch.country = safeCountry;
    }
    if (safeTimezone) {
      patch.timezone = safeTimezone;
    }

    if (safeStepRaw !== null) {
      patch.recurring_registration_step = safeStepRaw;
    }

    if (isContractFormallySignedAlready) {
      applyForwardOnlyFunnelAndStatus({ funnel: "contrato_assinado", status: "contrato_assinado", contractStatus: "assinado" });
    } else if (existingPaymentStatus === "pendente_confirmacao" || existingPaymentStatus === "nao_realizado" || existingPaymentStatus === "confirmado") {
      // Pagamento já tem estado definido: não retroceder contrato
    } else if (safeStepRaw !== null && safeStepRaw >= 5) {
      applyForwardOnlyFunnelAndStatus({ funnel: "contrato_assinado", status: "contrato_assinado", contractStatus: "assinado" });
    } else if (safeStepRaw !== null && safeStepRaw >= 4) {
      applyForwardOnlyFunnelAndStatus({ funnel: "contrato_aguardando_aceite", status: "contrato_aguardando_aceite", contractStatus: "aguardando_aceite" });
    } else if (safeStepRaw !== null && safeStepRaw >= 2) {
      applyForwardOnlyFunnelAndStatus({ funnel: "contrato_coletando_dados", status: "contrato_coletando_dados", contractStatus: "coletando_dados" });
    }

    if (safePassword) {
      patch.recurring_registration_password = safePassword;
    }

    try {
      const { error } = await admin
        .from("atendimento_leads")
        .update(patch as any)
        .eq("id", String(lead.id));
      if (error) throw error;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e ?? "Erro desconhecido.");
      if (/column|does not exist|PGRST204|PGRST205|42703/i.test(msg)) {
        try {
          const fallback: Record<string, unknown> = { updated_at: nowIso };
          if (safeNome) {
            fallback.full_name = safeNome;
          }
          await admin
            .from("atendimento_leads")
            .update(fallback as any)
            .eq("id", String(lead.id));
        } catch {}
      } else {
        return NextResponse.json({ ok: false, error: msg }, { status: 500 });
      }
    }

    try {
      if (safeStepRaw !== null && safeStepRaw >= 5) {
        const paymentRawNow = String((lead as any)?.payment_status ?? "").trim().toLowerCase();
        const paymentAlready =
          paymentRawNow === "pendente_confirmacao" ||
          paymentRawNow === "nao_realizado" ||
          paymentRawNow === "confirmado";
        if (!paymentAlready) {
          await triggerRecurringPaymentIntentIfNeeded({
            admin,
            leadId: String(lead.id),
            triggeredFrom: "draft_step6_entry",
          }).catch(() => {});
        }
      }
    } catch {}

    try {
      const { data: convRow } = await admin
        .from("atendimento_conversations")
        .select("id")
        .eq("lead_id", String(lead.id))
        .eq("channel", "whatsapp")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if ((convRow as any)?.id) {
        const { appendHistoryEvent } = await import("@/lib/atendimento/server");
        await appendHistoryEvent({
          leadId: String(lead.id),
          conversationId: String((convRow as any).id),
          eventType: "recurring_class_draft_saved",
          title: "Rascunho de dia/horário recorrente salvo (plataforma)",
          details: {
            weekday: validWeekday || null,
            weekday_label: patch.recurring_class_weekday_label || null,
            professor_time: safeProfessorTime || null,
            lead_time: (patch.recurring_class_lead_time as string) || null,
            source: "cadastro_recorrente_plataforma_draft",
          },
          actorType: "lead",
        }).catch(() => {});
      }
    } catch {}

    return NextResponse.json({
      ok: true,
      leadId: String(lead.id),
      saved: {
        weekday: validWeekday || null,
        weekday_label: (patch.recurring_class_weekday_label as string) || null,
        professor_time: safeProfessorTime || null,
        lead_time: (patch.recurring_class_lead_time as string) || null,
        step: safeStepRaw ?? null,
        has_password: Boolean(safePassword),
        state: safeState || null,
        city: safeCity || null,
        country: safeCountry || null,
        timezone: safeTimezone || null,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: toErrorMessage(err, ""),
      },
      { status: 500 },
    );
  }
}
