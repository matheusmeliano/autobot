import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAtendimentoUser } from "@/lib/atendimento/server";

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

function safeIsoDate(date: string, time: string, timezone: string): string | null {
  const d = String(date ?? "").trim().slice(0, 10);
  const t = String(time ?? "").trim();
  if (!d || !/^\d{2}:\d{2}$/.test(t)) return null;
  const isoLike = `${d}T${t}:00`;
  try {
    const dt = new Date(isoLike);
    if (Number.isNaN(dt.getTime())) return null;
    return dt.toISOString();
  } catch {
    try {
      const utc = new Date(`${isoLike}Z`);
      if (Number.isNaN(utc.getTime())) return null;
      return utc.toISOString();
    } catch {
      return null;
    }
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ leadId: string }> }) {
  try {
    const leadIdRaw = (await params).leadId;
    const leadId = String(leadIdRaw ?? "").trim();
    if (!leadId) {
      return Response.json({ ok: false, error: "lead_missing" }, { status: 400 });
    }
    const auth = await requireAtendimentoUser();
    if (!auth?.ok) {
      return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const schema = z.object({
      status: z.string().trim().max(80).optional(),
      professor_date: z.string().trim().max(40).optional(),
      professor_time: z.string().trim().max(20).optional(),
      lead_date: z.string().trim().max(40).optional(),
      lead_time: z.string().trim().max(20).optional(),
      professor_timezone: z.string().trim().max(120).optional(),
      lead_timezone: z.string().trim().max(120).optional(),
      lesson_link: z.string().trim().max(500).nullable().optional(),
      attendance_status: z.string().trim().max(80).nullable().optional(),
    });

    const json = (await req.json().catch(() => null)) as unknown;
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      return Response.json({ ok: false, error: "invalid_payload" }, { status: 400 });
    }

    const safeStatus = parsed.data.status ?? "scheduled";
    const safeProfessorDate = String(parsed.data.professor_date ?? "").trim() || null;
    const safeProfessorTime = String(parsed.data.professor_time ?? "").trim() || null;
    const safeLeadDate = String(parsed.data.lead_date ?? "").trim() || null;
    const safeLeadTime = String(parsed.data.lead_time ?? "").trim() || null;
    const safeProfessorTz = String(parsed.data.professor_timezone ?? "America/Cuiaba").trim() || "America/Cuiaba";
    const safeLeadTz = String(parsed.data.lead_timezone ?? "America/Cuiaba").trim() || "America/Cuiaba";
    const lessonLinkRaw = parsed.data.lesson_link;
    const safeLessonLink =
      lessonLinkRaw === undefined
        ? undefined
        : lessonLinkRaw === null
          ? null
          : String(lessonLinkRaw).trim() || null;
    const attendanceRaw = parsed.data.attendance_status;
    const safeAttendance =
      attendanceRaw === undefined
        ? undefined
        : attendanceRaw === null
          ? null
          : String(attendanceRaw).trim() || null;

    const professorStartAt = safeProfessorDate && safeProfessorTime
      ? safeIsoDate(safeProfessorDate, safeProfessorTime, safeProfessorTz)
      : null;
    const leadStartAt = (safeLeadDate || safeProfessorDate) && (safeLeadTime || safeProfessorTime)
      ? safeIsoDate(safeLeadDate || safeProfessorDate || "", safeLeadTime || safeProfessorTime || "", safeLeadTz)
      : null;

    const admin = createSupabaseAdminClient();

    const { data: leadExists, error: leadErr } = await admin
      .from("atendimento_leads")
      .select("id, assigned_user_email")
      .eq("id", leadId)
      .eq("assigned_user_email", "atendimento.usa.music@gmail.com")
      .maybeSingle();

    if (leadErr) {
      return Response.json({ ok: false, error: leadErr.message }, { status: 500 });
    }
    if (!leadExists?.id) {
      return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    }

    let currentActive: any[] | null = null;
    try {
      const res = await admin
        .from("atendimento_experimental_class_bookings")
        .select("id, status")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (res.error) {
        if (!isUndefinedRelationError(res.error)) {
          return Response.json({ ok: false, error: res.error.message }, { status: 500 });
        }
        currentActive = [];
      } else {
        currentActive = Array.isArray(res.data) ? res.data : [];
      }
    } catch (err) {
      if (!isUndefinedRelationError(err)) {
        return Response.json(
          { ok: false, error: err instanceof Error ? err.message : "db_error" },
          { status: 500 },
        );
      }
      currentActive = [];
    }

    const activeId =
      (currentActive ?? []).find(
        (r) => String(r.status ?? "").trim().toLowerCase() !== "cancelled",
      )?.id ?? null;

    const insertOrUpdateData: Record<string, unknown> = {};
    insertOrUpdateData.lead_id = leadId;
    insertOrUpdateData.status = safeStatus;
    insertOrUpdateData.professor_date = safeProfessorDate;
    insertOrUpdateData.professor_time = safeProfessorTime;
    insertOrUpdateData.lead_date = safeLeadDate ?? safeProfessorDate;
    insertOrUpdateData.lead_time = safeLeadTime ?? safeProfessorTime;
    insertOrUpdateData.professor_timezone = safeProfessorTz;
    insertOrUpdateData.lead_timezone = safeLeadTz;
    insertOrUpdateData.professor_start_at = professorStartAt;
    insertOrUpdateData.lead_start_at = leadStartAt;
    if (safeLessonLink !== undefined) insertOrUpdateData.lesson_link = safeLessonLink;
    if (safeAttendance !== undefined) insertOrUpdateData.attendance_status = safeAttendance;

    let bookingOut: Record<string, unknown> | null = null;

    if (activeId) {
      try {
        const { data, error } = await admin
          .from("atendimento_experimental_class_bookings")
          .update(insertOrUpdateData)
          .eq("id", activeId)
          .eq("lead_id", leadId)
          .select("*")
          .maybeSingle();
        if (error) {
          if (isUndefinedRelationError(error)) {
            bookingOut = { id: "fallback", ...insertOrUpdateData };
          } else {
            return Response.json({ ok: false, error: error.message }, { status: 500 });
          }
        } else {
          bookingOut = data ? (data as Record<string, unknown>) : null;
        }
      } catch (err) {
        if (isUndefinedRelationError(err)) {
          bookingOut = { id: "fallback", ...insertOrUpdateData };
        } else {
          throw err;
        }
      }
    } else {
      try {
        const { data, error } = await admin
          .from("atendimento_experimental_class_bookings")
          .insert(insertOrUpdateData)
          .select("*")
          .maybeSingle();
        if (error) {
          const code = String((error as any)?.code ?? "");
          if (isUndefinedRelationError(error)) {
            bookingOut = { id: "fallback", ...insertOrUpdateData };
          } else if (code === "23505") {
            let firstId: string | null = null;
            try {
              const res = await admin
                .from("atendimento_experimental_class_bookings")
                .select("id, status")
                .eq("lead_id", leadId)
                .order("created_at", { ascending: false })
                .limit(1);
              if (!res.error) {
                firstId = ((Array.isArray(res.data) ? res.data : []) as any[])?.[0]?.id ?? null;
              } else if (!isUndefinedRelationError(res.error)) {
                return Response.json({ ok: false, error: res.error.message }, { status: 500 });
              }
            } catch (err2) {
              if (!isUndefinedRelationError(err2)) throw err2;
            }
            if (firstId) {
              try {
                const { data: upd2, error: updErr } = await admin
                  .from("atendimento_experimental_class_bookings")
                  .update(insertOrUpdateData)
                  .eq("id", firstId)
                  .eq("lead_id", leadId)
                  .select("*")
                  .maybeSingle();
                if (updErr) {
                  if (isUndefinedRelationError(updErr)) {
                    bookingOut = { id: firstId, ...insertOrUpdateData };
                  } else {
                    return Response.json({ ok: false, error: updErr.message }, { status: 500 });
                  }
                } else {
                  bookingOut = upd2 ? (upd2 as Record<string, unknown>) : null;
                }
              } catch (err2) {
                if (isUndefinedRelationError(err2)) {
                  bookingOut = { id: firstId, ...insertOrUpdateData };
                } else {
                  throw err2;
                }
              }
            } else {
              return Response.json({ ok: false, error: error.message }, { status: 500 });
            }
          } else {
            return Response.json({ ok: false, error: error.message }, { status: 500 });
          }
        } else {
          bookingOut = data ? (data as Record<string, unknown>) : null;
        }
      } catch (err) {
        if (isUndefinedRelationError(err)) {
          bookingOut = { id: "fallback", ...insertOrUpdateData };
        } else {
          throw err;
        }
      }
    }

    let leadUpdate: { funnel_stage?: string | null; experimental_class_status?: string | null; updated_at?: string } | null = null;
    try {
      const { data: leadUpd, error: leadUpdErr } = await admin
        .from("atendimento_leads")
        .update({
          funnel_stage: "aula_experimental_agendada",
          experimental_class_status: safeStatus,
        })
        .eq("id", leadId)
        .eq("assigned_user_email", "atendimento.usa.music@gmail.com")
        .select("id, funnel_stage, experimental_class_status, updated_at")
        .maybeSingle();
      if (!leadUpdErr && leadUpd) {
        leadUpdate = {
          funnel_stage: String((leadUpd as any).funnel_stage ?? "aula_experimental_agendada").trim() || null,
          experimental_class_status: String((leadUpd as any).experimental_class_status ?? safeStatus).trim() || null,
          updated_at: String((leadUpd as any).updated_at ?? new Date().toISOString()),
        };
      }
    } catch {
      leadUpdate = {
        funnel_stage: "aula_experimental_agendada",
        experimental_class_status: safeStatus,
        updated_at: new Date().toISOString(),
      };
    }

    try {
      await admin.from("atendimento_history_events").insert({
        lead_id: leadId,
        event_type: "experimental_class_edited_by_attendant",
        assigned_user_email: "atendimento.usa.music@gmail.com",
        details: {
          booking_id: bookingOut?.id ? String(bookingOut.id) : null,
          status: safeStatus,
          professor_date: safeProfessorDate,
          professor_time: safeProfessorTime,
          lesson_link: safeLessonLink,
          source: "painel_atendimento_edit_experimental",
        },
      });
    } catch {
      // ignore
    }

    return Response.json({
      ok: true,
      booking: bookingOut,
      lead_update: leadUpdate,
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "internal_error" },
      { status: 500 },
    );
  }
}
