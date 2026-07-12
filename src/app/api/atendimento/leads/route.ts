import { ATENDIMENTO_PROFESSOR_TIME_ZONE } from "@/lib/atendimento/constants";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAtendimentoUser } from "@/lib/atendimento/server";

function isExperimentalClassBookingsTableUnavailable(error: unknown) {
  const code = String((error as any)?.code ?? "").trim();
  const message = String((error as any)?.message ?? "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    /relation .*atendimento_experimental_class_bookings.*does not exist/i.test(message) ||
    /could not find the table .*atendimento_experimental_class_bookings.* in the schema cache/i.test(message)
  );
}

function getLeadSortTime(row: any) {
  const candidates = [
    row?.last_interaction_at,
    row?.conversation?.last_message_at,
    row?.conversation?.updated_at,
    row?.updated_at,
    row?.created_at,
  ];

  for (const candidate of candidates) {
    const time = new Date(String(candidate ?? "")).getTime();
    if (Number.isFinite(time) && time > 0) return time;
  }

  return 0;
}

export async function GET(req: Request) {
  const auth = await requireAtendimentoUser();
  if (!auth.ok) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const q = String(searchParams.get("q") ?? "").trim().toLowerCase();
  const status = String(searchParams.get("status") ?? "").trim().toLowerCase();
  const stage = String(searchParams.get("stage") ?? "").trim().toLowerCase();
  const admin = createSupabaseAdminClient();

  const { data: leads, error } = await admin
    .from("atendimento_leads")
    .select("*")
    .eq("assigned_user_email", "atendimento.usa.music@gmail.com")
    .order("created_at", { ascending: false })
    .limit(300);

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  const leadRows = (leads ?? []) as any[];
  const leadIds = leadRows.map((row) => String(row.id ?? "")).filter(Boolean);
  const conversationsByLeadId = new Map<string, any>();
  const bookingsByLeadId = new Map<string, any>();

  if (leadIds.length > 0) {
    const { data: conversations, error: conversationsError } = await admin
      .from("atendimento_conversations")
      .select("id, lead_id, public_link_id, channel, public_slug, bot_enabled, last_message_preview, last_message_at, created_at, updated_at")
      .in("lead_id", leadIds)
      .order("updated_at", { ascending: false });

    if (conversationsError) {
      return Response.json({ ok: false, error: conversationsError.message }, { status: 500 });
    }

    for (const conversation of conversations ?? []) {
      const leadId = String((conversation as any)?.lead_id ?? "");
      if (!leadId || conversationsByLeadId.has(leadId)) continue;
      conversationsByLeadId.set(leadId, conversation);
    }

    const { data: bookings, error: bookingsError } = await admin
      .from("atendimento_experimental_class_bookings")
      .select(
        "id, lead_id, status, professor_timezone, lead_timezone, professor_date, professor_time, professor_start_at, lead_date, lead_time, lead_start_at, created_at, updated_at",
      )
      .in("lead_id", leadIds)
      .order("updated_at", { ascending: false })
      .order("created_at", { ascending: false });

    if (bookingsError && !isExperimentalClassBookingsTableUnavailable(bookingsError)) {
      return Response.json({ ok: false, error: bookingsError.message }, { status: 500 });
    }

    for (const booking of bookings ?? []) {
      const leadId = String((booking as any)?.lead_id ?? "");
      if (!leadId || bookingsByLeadId.has(leadId)) continue;
      bookingsByLeadId.set(leadId, {
        ...(booking as any),
        professor_timezone: String((booking as any)?.professor_timezone ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE,
        source: "table",
      });
    }

    const { data: historyEvents, error: historyError } = await admin
      .from("atendimento_history_events")
      .select("id, lead_id, created_at, details")
      .in("lead_id", leadIds)
      .eq("event_type", "experimental_class_scheduled")
      .order("created_at", { ascending: false });

    if (historyError) {
      return Response.json({ ok: false, error: historyError.message }, { status: 500 });
    }

    for (const event of historyEvents ?? []) {
      const leadId = String((event as any)?.lead_id ?? "");
      if (!leadId || bookingsByLeadId.has(leadId)) continue;
      const details = ((event as any)?.details ?? {}) as Record<string, unknown>;
      bookingsByLeadId.set(leadId, {
        id: String((event as any)?.id ?? ""),
        status: "scheduled",
        professor_timezone: String(details.professor_timezone ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE,
        lead_timezone: String(details.lead_timezone ?? ""),
        professor_date: String(details.professor_date ?? ""),
        professor_time: String(details.professor_time ?? ""),
        professor_start_at: String(details.professor_start_at ?? ""),
        lead_date: String(details.lead_date ?? ""),
        lead_time: String(details.lead_time ?? ""),
        lead_start_at: String(details.lead_start_at ?? ""),
        created_at: String((event as any)?.created_at ?? ""),
        source: "history",
      });
    }
  }

  const rows = leadRows
    .map((row) => ({
      ...row,
      conversation: conversationsByLeadId.get(String(row.id ?? "")) ?? null,
      experimental_class_booking: bookingsByLeadId.get(String(row.id ?? "")) ?? null,
    }))
    .filter((row) => {
    const name = String(row.full_name ?? "").toLowerCase();
    const phone = String(row.phone ?? "").toLowerCase();
    const cpf = String(row.cpf ?? "").toLowerCase();
    if (q && !name.includes(q) && !phone.includes(q) && !cpf.includes(q)) return false;
    if (status && String(row.status ?? "").toLowerCase() !== status) return false;
    if (stage && String(row.funnel_stage ?? "").toLowerCase() !== stage) return false;
    return true;
    })
    .sort((left, right) => {
      const timeDiff = getLeadSortTime(right) - getLeadSortTime(left);
      if (timeDiff !== 0) return timeDiff;
      return new Date(String(right.created_at ?? "")).getTime() - new Date(String(left.created_at ?? "")).getTime();
    });

  return Response.json({ ok: true, leads: rows });
}
