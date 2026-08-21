import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  appendHistoryEvent,
  findLeadByPhone,
  formalizeAndPersistContract,
  sendAtendimentoWhatsAppText,
  syncConversationPreview,
} from "@/lib/atendimento/server";
import {
  ATENDIMENTO_STAGE_ORDER,
  ATENDIMENTO_STATUS_ORDER,
  EXPERIMENTAL_CLASS_REGISTERED_ATTENDANT_NOTIFICATION_PHONE,
  buildRecurringPaymentPendingConfirmationAttendantNotification,
} from "@/lib/atendimento/experimentalClass";

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

function isUndefinedColumnError(error: unknown): boolean {
  const code = String((error as any)?.code ?? "").trim();
  if (code === "42703") return true;
  const msg = String(error instanceof Error ? error.message : (error as any)?.message ?? "").toLowerCase();
  return msg.includes("column") && msg.includes("does not exist");
}

function buildEnrollmentNumber({
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

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const telefone = String(body?.telefone ?? "").replace(/\D/g, "").trim();
  const leadId = String(body?.leadId ?? "").trim();
  try {
    const admin = createSupabaseAdminClient();
    let lead: any = null;
    if (leadId && leadId.length > 0) {
      const { data } = await admin
        .from("atendimento_leads")
        .select("*")
        .eq("id", leadId)
        .maybeSingle();
      lead = data;
    }
    if (!lead?.id && telefone.length >= 10) {
      lead = await findLeadByPhone({ phone: telefone });
    }
    if (!lead?.id) {
      return Response.json({
        ok: false,
        blocked: true,
        error:
          "Acesso bloqueado. Seu cadastro foi excluído. Para acessar novamente, inicie um novo atendimento pelo WhatsApp.",
      }, { status: 403 });
    }

    const finalLeadId = String(lead.id);
    let enrollmentNumber = String(lead?.enrollment_number ?? "").trim();
    if (!enrollmentNumber) {
      enrollmentNumber = String(lead?.enrollment_number ?? "").trim();
    }
    if (!enrollmentNumber) {
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
      enrollmentNumber = buildEnrollmentNumber({
        existingMax,
        createdAt: String(lead?.created_at ?? "").trim() || null,
        uuidHead: String(lead?.id ?? "").trim().split("-")[0] ?? null,
      });

      let applied = false;
      if (enrollmentNumber) {
        try {
          const safeUpdate: any = { enrollment_number: enrollmentNumber };
          const { error: updErr } = await admin
            .from("atendimento_leads")
            .update(safeUpdate)
            .eq("id", finalLeadId);
          if (!updErr) {
            applied = true;
          } else if (isUndefinedColumnError(updErr)) {
            applied = true;
          }
        } catch (err) {
          if (isUndefinedColumnError(err)) {
            applied = true;
          }
        }
        try {
          await appendHistoryEvent({
            leadId: finalLeadId,
            eventType: "enrollment_number_generated",
            title: "Número de matrícula gerado",
            details: {
              enrollment_number: enrollmentNumber,
              gerado_em: new Date().toISOString(),
            },
            actorType: "system",
          });
        } catch {}
      }
      if (!enrollmentNumber) {
        enrollmentNumber = buildEnrollmentNumber({
          existingMax,
          createdAt: String(lead?.created_at ?? "").trim() || null,
          uuidHead: String(lead?.id ?? "").trim().split("-")[0] ?? null,
        });
      }
      void applied;
    }

    try {
      const existingStage = String((lead as any)?.funnel_stage ?? "").trim() as
        | (typeof ATENDIMENTO_STAGE_ORDER)[number]
        | "";
      const existingStatus = String((lead as any)?.status ?? "").trim() as
        | (typeof ATENDIMENTO_STATUS_ORDER)[number]
        | "";
      const currentStageIdx = existingStage
        ? ATENDIMENTO_STAGE_ORDER.indexOf(existingStage)
        : -1;
      const currentStatusIdx = existingStatus
        ? ATENDIMENTO_STATUS_ORDER.indexOf(existingStatus)
        : -1;
      const targetStage = "pagamento_pendente_confirmacao" as const;
      const targetStatus = "pagamento_pendente_confirmacao" as const;
      const targetStageIdx = ATENDIMENTO_STAGE_ORDER.indexOf(targetStage);
      const targetStatusIdx = ATENDIMENTO_STATUS_ORDER.indexOf(targetStatus);
      const baseUpdate: any = {
        contract_status: "aguardando_aceite",
        payment_status: "pendente_confirmacao",
        payment_confirmed_at: null,
        payment_rejected_at: null,
      };
      if (targetStageIdx >= 0 && (currentStageIdx < 0 || currentStageIdx < targetStageIdx)) {
        baseUpdate.funnel_stage = targetStage;
      }
      if (targetStatusIdx >= 0 && (currentStatusIdx < 0 || currentStatusIdx < targetStatusIdx)) {
        baseUpdate.status = targetStatus;
      }
      if (enrollmentNumber) baseUpdate.enrollment_number = enrollmentNumber;
      await admin
        .from("atendimento_leads")
        .update(baseUpdate)
        .eq("id", String(lead.id));
      try {
        await appendHistoryEvent({
          leadId: finalLeadId,
          eventType: "recurring_payment_pending_confirmation",
          title: "Pagamento pendente de confirmação (Finalizar Matrícula)",
          details: {
            enrollment_number: enrollmentNumber || null,
            triggered_from: "contract_finalize_finalizar_matricula",
            pending_since: new Date().toISOString(),
          },
          actorType: "system",
        });
      } catch {}
    } catch {}

    const result: any = await (formalizeAndPersistContract as any)({
      admin,
      leadId: String(lead.id),
    });

    try {
      const { data: conversations } = await admin
        .from("atendimento_conversations")
        .select("id, lead_id")
        .eq("lead_id", String(lead.id))
        .order("created_at", { ascending: false })
        .limit(1);
      const conversation = conversations?.[0] ?? null;
      if (conversation?.id) {
        try {
          await (syncConversationPreview as any)({
            conversationId: String(conversation.id),
          });
        } catch {}
      }
    } catch {}

    try {
      const attendantMsg = buildRecurringPaymentPendingConfirmationAttendantNotification(
        String((lead as any)?.full_name ?? null),
        enrollmentNumber || null,
      );
      await sendAtendimentoWhatsAppText({
        toPhone: EXPERIMENTAL_CLASS_REGISTERED_ATTENDANT_NOTIFICATION_PHONE,
        contentText: attendantMsg,
        leadId: finalLeadId,
        silentFail: true,
      });
      try {
        await appendHistoryEvent({
          leadId: finalLeadId,
          eventType: "attendant_payment_pending_confirmation_sent",
          title: "Notificação atendente: Pagamento pendente enviada",
          details: {
            enrollment_number: enrollmentNumber || null,
            attendant_phone: EXPERIMENTAL_CLASS_REGISTERED_ATTENDANT_NOTIFICATION_PHONE,
          },
          actorType: "system",
        });
      } catch {}
    } catch {}

    return Response.json({
      ok: true,
      contract_pdf_url: String(result?.contract_pdf_url ?? result?.contractPdfUrl ?? null),
      contract_signed_at: String(result?.contract_signed_at ?? result?.signedAtIso ?? new Date().toISOString()),
      leadId: String(lead.id),
      enrollment_number: enrollmentNumber,
    });
  } catch (e: any) {
    return Response.json({ ok: false, error: toErrorMessage(e, "Falha ao gerar o contrato.") }, { status: 500 });
  }
}
