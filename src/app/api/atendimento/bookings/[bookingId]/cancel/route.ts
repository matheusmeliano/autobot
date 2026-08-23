import { requireAtendimentoUser, appendHistoryEvent } from "@/lib/atendimento/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function isExperimentalClassBookingsTableUnavailable(error: unknown) {
  const code = String((error as any)?.code ?? "").trim();
  const message = String((error as any)?.message ?? "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    /relation .*atendimento_experimental_class_bookings.*does not exist/i.test(message) ||
    /could not find the table .*atendimento_experimental_class_bookings.* in the schema cache/i.test(
      message,
    )
  );
}

const BOOKING_UNDO__SUSPECT_MISSING_FLAT_COLS = [
  "experimental_class_booking_id",
  "experimental_class_status",
  "experimental_class_lead_date",
  "experimental_class_lead_time",
  "experimental_class_professor_date",
  "experimental_class_professor_time",
  "experimental_class_lead_start_at",
  "experimental_class_professor_start_at",
  "experimental_class_link",
  "latest_experimental_class_cancelled_at",
  "experimental_class_professor_name",
  "experimental_class_professor_phone",
] as const;

function extractUndefinedColumnName(raw: unknown): string | null {
  if (!raw) return null;
  const msg = String(raw).toLowerCase();
  const m1 = /column "([^"]+)" does not exist/.exec(msg);
  if (m1 && m1[1]) return m1[1];
  const m2 = /could not find the '([^']+)' column/.exec(msg);
  if (m2 && m2[1]) return m2[1];
  return null;
}
function stripUndefinedColumnFromPatch(patchObj: Record<string, unknown>, error: unknown): {
  next: Record<string, unknown> | null;
  stripped: string | null;
} {
  const col = extractUndefinedColumnName((error as any)?.message || String(error ?? ""));
  if (col && patchObj[col] !== undefined) {
    const next = { ...patchObj };
    delete next[col];
    return { next, stripped: col };
  }
  for (const sus of BOOKING_UNDO__SUSPECT_MISSING_FLAT_COLS) {
    if (patchObj[sus] !== undefined) {
      const next = { ...patchObj };
      delete next[sus];
      return { next, stripped: sus };
    }
  }
  return { next: null, stripped: null };
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  const auth = await requireAtendimentoUser();
  if (!auth.ok) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { bookingId } = await params;
  const normalizedBookingId = String(bookingId ?? "").trim();
  if (!normalizedBookingId) {
    return Response.json({ ok: false, error: "missing_booking_id" }, { status: 400 });
  }

  const payload = (await req.json().catch(() => null)) as
    | {
        leadId?: string | null;
        conversationId?: string | null;
        professorDate?: string | null;
        professorTime?: string | null;
        professorStartAt?: string | null;
        leadDate?: string | null;
        leadTime?: string | null;
      }
    | null;

  const admin = createSupabaseAdminClient();
  const { data: booking, error: bookingError } = await admin
    .from("atendimento_experimental_class_bookings")
    .select(
      "id, lead_id, conversation_id, status, professor_date, professor_time, professor_start_at, lead_date, lead_time, lead_timezone, professor_timezone",
    )
    .eq("id", normalizedBookingId)
    .maybeSingle();

  const tableUnavailable = isExperimentalClassBookingsTableUnavailable(bookingError);
  if (bookingError && !tableUnavailable) {
    return Response.json({ ok: false, error: bookingError.message }, { status: 500 });
  }

  let resolvedBooking = booking as Record<string, unknown> | null;

  if (!resolvedBooking && !tableUnavailable && payload?.leadId) {
    const query = admin
      .from("atendimento_experimental_class_bookings")
      .select(
        "id, lead_id, conversation_id, status, professor_date, professor_time, professor_start_at, lead_date, lead_time, lead_start_at, lead_timezone, professor_timezone, created_at",
      )
      .eq("lead_id", String(payload.leadId))
      .order("updated_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(10);

    const { data: leadBookings, error: leadBookingsError } = await query;
    if (leadBookingsError && !isExperimentalClassBookingsTableUnavailable(leadBookingsError)) {
      return Response.json({ ok: false, error: leadBookingsError.message }, { status: 500 });
    }

    resolvedBooking =
      ((leadBookings ?? []) as Record<string, unknown>[]).find((row) => {
        const sameProfessorStartAt =
          String(row?.professor_start_at ?? "").trim() &&
          String(row?.professor_start_at ?? "").trim() ===
            String(payload.professorStartAt ?? "").trim();
        const sameConversation =
          String(row?.conversation_id ?? "").trim() &&
          String(row?.conversation_id ?? "").trim() ===
            String(payload.conversationId ?? "").trim();
        return sameProfessorStartAt || sameConversation;
      }) ?? null;
  }

  if (resolvedBooking) {
    const currentStatus = String((resolvedBooking as any)?.status ?? "").trim().toLowerCase();
    if (currentStatus !== "scheduled") {
      return Response.json(
        {
          ok: false,
          error: "only_scheduled_bookings_can_be_cancelled",
          booking: resolvedBooking,
        },
        { status: 409 },
      );
    }
  }

  const resolvedLeadId = String(
    (resolvedBooking as any)?.lead_id ?? payload?.leadId ?? "",
  ).trim();
  if (!resolvedLeadId) {
    return Response.json({ ok: false, error: "lead_not_found" }, { status: 404 });
  }

  const { data: lead, error: leadError } = await admin
    .from("atendimento_leads")
    .select("id, status, funnel_stage, experimental_class_booking_id")
    .eq("id", resolvedLeadId)
    .maybeSingle();

  if (leadError) {
    return Response.json({ ok: false, error: leadError.message }, { status: 500 });
  }

  if (!lead?.id) {
    return Response.json({ ok: false, error: "lead_not_found" }, { status: 404 });
  }

  // 1) EXCLUIR o booking em si (regra nova: cancelar = excluir o agendamento)
  let deletedBookingId: string | null = resolvedBooking ? String((resolvedBooking as any).id ?? "").trim() : null;
  const currentBookingId = String((lead as any)?.experimental_class_booking_id ?? "").trim();

  if (resolvedBooking && !tableUnavailable) {
    const targetId = String((resolvedBooking as any).id ?? "").trim();
    if (targetId) {
      const { error: delBookingErr } = await admin
        .from("atendimento_experimental_class_bookings")
        .delete()
        .eq("id", targetId);
      if (delBookingErr && !isExperimentalClassBookingsTableUnavailable(delBookingErr)) {
        return Response.json({ ok: false, error: delBookingErr.message }, { status: 500 });
      }
      deletedBookingId = targetId;
    }
  }

  // 2) Limpar TODAS as colunas flat experimentais (data/horario/id/link/cancelled_at/professor)
  //    e reverter o funil do lead para Falta dia e horario (agendamento deixou de existir)
  let leadPatch: Record<string, unknown> = {
    experimental_class_booking_id: null,
    experimental_class_status: null,
    experimental_class_lead_date: null,
    experimental_class_lead_time: null,
    experimental_class_professor_date: null,
    experimental_class_professor_time: null,
    experimental_class_lead_start_at: null,
    experimental_class_professor_start_at: null,
    experimental_class_link: null,
    latest_experimental_class_cancelled_at: null,
    experimental_class_professor_name: null,
    experimental_class_professor_phone: null,
    status: "aguardando_aula_experimental",
    funnel_stage: "aula_experimental_antecipada",
  };

  let finalLeadUpdated: Record<string, unknown> | null = null;
  let retries = 0;
  while (retries < 12) {
    const { data: updRow, error: updErr } = await admin
      .from("atendimento_leads")
      .update(leadPatch)
      .eq("id", resolvedLeadId)
      .select("id")
      .maybeSingle();
    if (!updErr) {
      finalLeadUpdated = (updRow as Record<string, unknown> | null) ?? { id: resolvedLeadId };
      break;
    }
    const stripped = stripUndefinedColumnFromPatch(leadPatch, updErr);
    if (!stripped.next || stripped.stripped === null) {
      return Response.json({ ok: false, error: updErr.message }, { status: 500 });
    }
    leadPatch = stripped.next;
    retries++;
  }

  // 3) Se o booking deletado ERA o apontado por experimental_class_booking_id e ainda existem
  //    outros bookings vinculados, remover também o resto (garante exclusao do agendamento completo)
  if (!tableUnavailable && currentBookingId && currentBookingId === (deletedBookingId ?? "")) {
    const { error: delAllErr } = await admin
      .from("atendimento_experimental_class_bookings")
      .delete()
      .eq("lead_id", resolvedLeadId);
    if (delAllErr && !isExperimentalClassBookingsTableUnavailable(delAllErr)) {
      // nao bloqueia o fluxo, o booking principal ja foi apagado
    }
  }

  // 4) appendHistoryEvent confirmando cancelamento/exclusao
  try {
    await appendHistoryEvent({
      admin,
      leadId: resolvedLeadId,
      conversationId: null,
      eventType: "experimental_class_cancelled",
      details: {
        booking_id: deletedBookingId ?? normalizedBookingId,
        action: "deleted_and_unlinked",
        status_before: "scheduled",
        status_after: null,
        lead_date_before: String(
          (resolvedBooking as any)?.lead_date ?? payload?.leadDate ?? "",
        ).trim() || null,
        lead_time_before: String(
          (resolvedBooking as any)?.lead_time ?? payload?.leadTime ?? "",
        ).trim() || null,
        professor_date_before: String(
          (resolvedBooking as any)?.professor_date ?? payload?.professorDate ?? "",
        ).trim() || null,
        professor_time_before: String(
          (resolvedBooking as any)?.professor_time ?? payload?.professorTime ?? "",
        ).trim() || null,
      },
    });
  } catch {
    // history nao bloqueia sucesso do cancelamento
  }

  return Response.json({
    ok: true,
    booking_deleted: true,
    booking_id: deletedBookingId ?? normalizedBookingId,
    lead: {
      ...finalLeadUpdated,
      status_after_undo: leadPatch.status,
      funnel_stage_after_undo: leadPatch.funnel_stage,
    },
  });
}
