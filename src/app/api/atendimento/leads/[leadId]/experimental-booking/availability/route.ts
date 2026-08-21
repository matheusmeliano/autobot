import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAtendimentoUser } from "@/lib/atendimento/server";
import { ATENDIMENTO_PROFESSOR_TIME_ZONE } from "@/lib/atendimento/constants";
import { listExperimentalClassAvailability } from "@/lib/atendimento/experimentalClass";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ leadId: string }> }) {
  try {
    const leadId = String((await params).leadId ?? "").trim();
    if (!leadId) {
      return Response.json({ ok: false, error: "lead_missing" }, { status: 400 });
    }
    const auth = await requireAtendimentoUser();
    if (!auth?.ok) {
      return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
    }
    const supabase = createSupabaseAdminClient();
    const leadRes = await supabase
      .from("atendimento_leads")
      .select("id,assigned_user_email,timezone,country,city,state")
      .eq("id", leadId)
      .limit(1)
      .maybeSingle();
    if (leadRes.error) {
      console.error("[experimental-booking-availability-get-lead]", leadRes.error);
      return Response.json({ ok: false, error: "db_error" }, { status: 500 });
    }
    const leadRow = leadRes.data as
      | {
          id: string;
          assigned_user_email: string | null;
          timezone: string | null;
          country: string | null;
          city: string | null;
          state: string | null;
        }
      | null;
    if (!leadRow) {
      return Response.json({ ok: false, error: "lead_not_found" }, { status: 404 });
    }
    if (String(leadRow.assigned_user_email ?? "").trim() !== "atendimento.usa.music@gmail.com") {
      return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const leadTimeZoneRaw = String(leadRow.timezone ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE;

    const bookedRes = await supabase
      .from("atendimento_experimental_class_bookings")
      .select("id,professor_start_at")
      .eq("assigned_user_email", "atendimento.usa.music@gmail.com")
      .eq("status", "scheduled")
      .not("professor_start_at", "is", null);
    if (bookedRes.error) {
      console.error("[experimental-booking-availability-get-booked]", bookedRes.error);
      return Response.json({ ok: false, error: "db_error" }, { status: 500 });
    }
    const allBookedRows = (Array.isArray(bookedRes.data) ? bookedRes.data : []) as Array<{
      id: string;
      professor_start_at: string | null;
    }>;

    const existingBookingRes = await supabase
      .from("atendimento_experimental_class_bookings")
      .select("id")
      .eq("lead_id", leadId)
      .eq("status", "scheduled")
      .limit(5)
      .maybeSingle();
    const currentBookingIds = new Set<string>();
    if (!existingBookingRes.error && existingBookingRes.data) {
      const rows = (Array.isArray(existingBookingRes.data)
        ? existingBookingRes.data
        : [existingBookingRes.data]) as Array<{ id: string }>;
      for (const r of rows) {
        if (r?.id) currentBookingIds.add(String(r.id));
      }
    }

    const bookedAts: string[] = [];
    for (const row of allBookedRows) {
      if (!row?.professor_start_at) continue;
      if (row?.id && currentBookingIds.has(String(row.id))) continue;
      const value = String(row.professor_start_at).trim();
      if (value) bookedAts.push(value);
    }

    const availability = listExperimentalClassAvailability({
      now: new Date(),
      leadTimeZone: leadTimeZoneRaw,
      bookedProfessorStartAts: bookedAts,
    });

    const slotsByDate: Record<string, any[]> = {};
    availability.slotsByDate.forEach((value, key) => {
      slotsByDate[String(key)] = value;
    });

    return Response.json({
      ok: true,
      dates: availability.dates,
      slotsByDate,
      lead_timezone: leadTimeZoneRaw,
    });
  } catch (err) {
    console.error("[experimental-booking-availability-get]", err);
    return Response.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
