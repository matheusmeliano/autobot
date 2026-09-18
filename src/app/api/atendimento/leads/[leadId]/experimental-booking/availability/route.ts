import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAtendimentoUser } from "@/lib/atendimento/server";
import { ATENDIMENTO_PROFESSOR_TIME_ZONE } from "@/lib/atendimento/constants";
import { listExperimentalClassAvailability } from "@/lib/atendimento/experimentalClass";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isUndefinedRelationError(err: unknown): boolean {
  const code = String((err as any)?.code ?? "").trim();
  if (code === "42P01") return true;
  const msg = String(err instanceof Error ? err.message : (err as any)?.message ?? "").toLowerCase();
  if (msg.includes("could not find the table")) return true;
  if (msg.includes("schema cache")) return true;
  if (msg.includes("relation") && msg.includes("does not exist")) return true;
  return false;
}

async function listBookedExperimental(admin: ReturnType<typeof createSupabaseAdminClient>, nowIso: string) {
  try {
    const { data, error } = await admin
      .from("atendimento_experimental_class_bookings")
      .select("id, professor_start_at, status")
      .not("professor_start_at", "is", null);
    if (error) {
      if (isUndefinedRelationError(error)) return { rows: [], selfId: null as string | null, ok: true as const };
      throw error;
    }
    const arr = Array.isArray(data)
      ? (data as Array<{ id: unknown; professor_start_at?: string | null; status?: string | null }>)
      : [];
    const rows = arr
      .filter((r) => {
        const status = String(r?.status ?? "").trim().toLowerCase();
        return status !== "cancelled";
      })
      .map((r) => ({
        id: String(r?.id ?? ""),
        professor_start_at: String(r?.professor_start_at ?? "").trim(),
      }))
      .filter((r) => r.professor_start_at);
    void nowIso;
    return { rows, selfId: null as string | null, ok: true as const };
  } catch (err) {
    if (isUndefinedRelationError(err)) {
      return { rows: [] as Array<{ id: string; professor_start_at: string }>, selfId: null as string | null, ok: true as const };
    }
    throw err;
  }
}

async function findLeadCurrentBookingIds(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  leadId: string,
): Promise<string[]> {
  try {
    const { data, error } = await admin
      .from("atendimento_experimental_class_bookings")
      .select("id, status")
      .eq("lead_id", leadId);
    if (error) {
      if (isUndefinedRelationError(error)) return [];
      throw error;
    }
    const arr = Array.isArray(data)
      ? (data as Array<{ id: unknown; status?: string | null }>)
      : [];
    return arr
      .filter((r) => {
        const status = String(r?.status ?? "").trim().toLowerCase();
        return status !== "cancelled";
      })
      .map((r) => String(r?.id ?? ""))
      .filter(Boolean);
  } catch (err) {
    if (isUndefinedRelationError(err)) return [];
    throw err;
  }
}

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

    const nowIso = new Date().toISOString();
    const currentBookingIds = new Set<string>(await findLeadCurrentBookingIds(supabase, leadId));
    const booked = await listBookedExperimental(supabase, nowIso);

    const bookedAts: string[] = [];
    for (const row of booked.rows) {
      if (!row?.professor_start_at) continue;
      if (row?.id && currentBookingIds.has(String(row.id))) continue;
      bookedAts.push(row.professor_start_at);
    }

    const availability = listExperimentalClassAvailability({
      now: new Date(nowIso),
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
    if (isUndefinedRelationError(err)) {
      const supabase = createSupabaseAdminClient();
      const nowIso = new Date().toISOString();
      const fallbackLead = await (async () => {
        try {
          const leadId = String((await params).leadId ?? "").trim();
          if (!leadId) return null as any;
          const { data } = await supabase
            .from("atendimento_leads")
            .select("timezone")
            .eq("id", leadId)
            .eq("assigned_user_email", "atendimento.usa.music@gmail.com")
            .limit(1)
            .maybeSingle();
          return data;
        } catch {
          return null as any;
        }
      })();
      const tz = String((fallbackLead as any)?.timezone ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE;
      const availability = listExperimentalClassAvailability({
        now: new Date(nowIso),
        leadTimeZone: tz,
        bookedProfessorStartAts: [],
      });
      const slotsByDate: Record<string, any[]> = {};
      availability.slotsByProfessorDate.forEach((value, key) => {
        slotsByDate[String(key)] = value;
      });
      return Response.json({
        ok: true,
        dates: availability.dates,
        slotsByDate,
        lead_timezone: tz,
      });
    }
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "server_error" },
      { status: 500 },
    );
  }
}
