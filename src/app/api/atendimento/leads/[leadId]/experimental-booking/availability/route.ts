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

    const { data: leadExists, error: leadErr } = await supabase
      .from("atendimento_leads")
      .select("id, assigned_user_email, timezone, country, city, state")
      .eq("id", leadId)
      .eq("assigned_user_email", "atendimento.usa.music@gmail.com")
      .maybeSingle();
    if (leadErr) {
      console.error("[experimental-booking-availability-get-lead]", leadErr);
      return Response.json({ ok: false, error: leadErr.message }, { status: 500 });
    }
    if (!leadExists?.id) {
      return Response.json({ ok: false, error: "lead_not_found" }, { status: 404 });
    }

    const leadTimeZoneRaw =
      String((leadExists as any)?.timezone ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE;

    const { data: currentActiveRows, error: curErr } = await supabase
      .from("atendimento_experimental_class_bookings")
      .select("id, status")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (curErr) {
      console.error("[experimental-booking-availability-get-current]", curErr);
      return Response.json({ ok: false, error: curErr.message }, { status: 500 });
    }
    const currentBookingIds = new Set<string>();
    for (const r of Array.isArray(currentActiveRows) ? currentActiveRows : []) {
      const status = String((r as any)?.status ?? "").trim().toLowerCase();
      if (status !== "cancelled" && (r as any)?.id) {
        currentBookingIds.add(String((r as any).id));
      }
    }

    const { data: allBookedRows, error: bookedErr } = await supabase
      .from("atendimento_experimental_class_bookings")
      .select("id, professor_start_at, status")
      .not("professor_start_at", "is", null);
    if (bookedErr) {
      console.error("[experimental-booking-availability-get-booked]", bookedErr);
      return Response.json({ ok: false, error: bookedErr.message }, { status: 500 });
    }

    const bookedAts: string[] = [];
    for (const row of Array.isArray(allBookedRows) ? allBookedRows : []) {
      const r = row as any;
      const startAt = String(r?.professor_start_at ?? "").trim();
      if (!startAt) continue;
      const status = String(r?.status ?? "").trim().toLowerCase();
      if (status === "cancelled") continue;
      if (r?.id && currentBookingIds.has(String(r.id))) continue;
      bookedAts.push(startAt);
    }

    const availability = listExperimentalClassAvailability({
      now: new Date(),
      leadTimeZone: leadTimeZoneRaw,
      bookedProfessorStartAts: bookedAts,
    });

    const slotsByDate: Record<string, any[]> = {};
    availability.slotsByProfessorDate.forEach((value, key) => {
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
