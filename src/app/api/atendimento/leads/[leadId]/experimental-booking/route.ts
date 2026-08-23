import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAtendimentoUser, appendHistoryEvent, sendAtendimentoWhatsAppText } from "@/lib/atendimento/server";
import {
  EXPERIMENTAL_CLASS_REGISTERED_ATTENDANT_NOTIFICATION_PHONE,
  buildExperimentalClassRegisteredAttendantWhatsAppMessage,
  buildExperimentalClassStudentWhatsAppMessages,
  resolveExperimentalClassAssignedProfessorPhone,
} from "@/lib/atendimento/experimentalClass";

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

function isUndefinedColumnError(err: unknown): boolean {
  const code = String((err as any)?.code ?? "").trim();
  if (code === "42703") return true;
  const msg = String(err instanceof Error ? err.message : (err as any)?.message ?? "").toLowerCase();
  return msg.includes("column") && msg.includes("does not exist");
}

const SUSPECT_MISSING_COLUMNS_BL = [
  "experimental_class_status",
  "experimental_class_lead_date",
  "experimental_class_lead_time",
  "experimental_class_professor_date",
  "experimental_class_professor_time",
  "experimental_class_lead_start_at",
  "experimental_class_professor_start_at",
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
  for (const sus of SUSPECT_MISSING_COLUMNS_BL) {
    if (patchObj[sus] !== undefined) {
      const next = { ...patchObj };
      delete next[sus];
      return { next, stripped: sus };
    }
  }
  return { next: null, stripped: null };
}

function safeIsoDate(date: string, time: string, timezone: string): string | null {
  const d = String(date ?? "").trim().slice(0, 10);
  const t = String(time ?? "").trim();
  if (!d || !/^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) return null;
  const isoLike = `${d}T${t.includes(":") && t.split(":").length === 2 ? `${t}:00` : t}`;
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
      .select("id, full_name, phone, assigned_user_email, city, state, country, timezone")
      .eq("id", leadId)
      .maybeSingle();

    if (leadErr) {
      return Response.json({ ok: false, error: leadErr.message }, { status: 500 });
    }
    if (!leadExists?.id) {
      return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    }

    let leadConversationId: string | null = null;
    try {
      const convRes = await admin
        .from("atendimento_conversations")
        .select("id")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!convRes.error && convRes.data?.id) {
        leadConversationId = String(convRes.data.id);
      }
    } catch {
    }

    const firstNameFromLead = (lead: { full_name?: string | null }) => {
      const clean = String(lead.full_name ?? "").trim().replace(/\s+/g, " ");
      if (!clean) return "";
      return clean.split(" ")[0] ?? "";
    };
    const firstName = firstNameFromLead(leadExists as { full_name?: string | null }) || "Aluno";

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
      ((currentActive ?? [])
        .filter((r) => String(r.status ?? "").trim().toLowerCase() !== "cancelled")
        .sort((a, b) => {
          const at = new Date(String((a as any).created_at ?? "")).getTime();
          const bt = new Date(String((b as any).created_at ?? "")).getTime();
          return bt - at;
        })?.[0]?.id ?? null) as string | null;

    try {
      await admin
        .from("atendimento_experimental_class_bookings")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("lead_id", leadId)
        .eq("status", "scheduled")
        .neq("id", activeId ?? "00000000-0000-0000-0000-000000000000");
    } catch {
    }

    const insertOrUpdateData: Record<string, unknown> = {};
    insertOrUpdateData.lead_id = leadId;
    insertOrUpdateData.status = safeStatus;
    insertOrUpdateData.source = "manual";
    insertOrUpdateData.professor_date = safeProfessorDate;
    insertOrUpdateData.professor_time = safeProfessorTime;
    insertOrUpdateData.lead_date = safeLeadDate ?? safeProfessorDate;
    insertOrUpdateData.lead_time = safeLeadTime ?? safeProfessorTime;
    insertOrUpdateData.professor_timezone = safeProfessorTz;
    insertOrUpdateData.lead_timezone = safeLeadTz;
    insertOrUpdateData.professor_start_at = professorStartAt;
    insertOrUpdateData.lead_start_at = leadStartAt;
    insertOrUpdateData.updated_at = new Date().toISOString();
    if (leadConversationId) insertOrUpdateData.conversation_id = leadConversationId;
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

    let leadUpdate: { funnel_stage?: string | null; experimental_class_status?: string | null; updated_at?: string; experimental_class_lead_date?: string | null; experimental_class_lead_time?: string | null; experimental_class_professor_date?: string | null; experimental_class_professor_time?: string | null; experimental_class_lead_start_at?: string | null; experimental_class_professor_start_at?: string | null; experimental_class_booking_id?: string | null; experimental_class_link?: string | null } | null = null;
    {
      const bookingIdStr = bookingOut?.id != null ? String(bookingOut.id) : null;
      const fullUpdateData: Record<string, any> = {
        funnel_stage: "aula_experimental_agendada",
        experimental_class_status: safeStatus,
        experimental_class_booking_id: bookingIdStr,
        experimental_class_lead_date: safeLeadDate,
        experimental_class_lead_time: safeLeadTime,
        experimental_class_professor_date: safeProfessorDate,
        experimental_class_professor_time: safeProfessorTime,
        experimental_class_lead_start_at: leadStartAt,
        experimental_class_professor_start_at: professorStartAt,
        ...(safeLessonLink ? { experimental_class_link: safeLessonLink } : {}),
        updated_at: new Date().toISOString(),
      };
      const selectFull = "id, funnel_stage, experimental_class_status, experimental_class_booking_id, experimental_class_link, updated_at, experimental_class_lead_date, experimental_class_lead_time, experimental_class_professor_date, experimental_class_professor_time, experimental_class_lead_start_at, experimental_class_professor_start_at";
      const fallback = () => ({
        funnel_stage: "aula_experimental_agendada",
        experimental_class_status: safeStatus,
        experimental_class_booking_id: bookingIdStr,
        experimental_class_link: safeLessonLink || null,
        updated_at: new Date().toISOString(),
        experimental_class_lead_date: safeLeadDate,
        experimental_class_lead_time: safeLeadTime,
        experimental_class_professor_date: safeProfessorDate,
        experimental_class_professor_time: safeProfessorTime,
        experimental_class_lead_start_at: leadStartAt,
        experimental_class_professor_start_at: professorStartAt,
      });
      type LeadRun = { err: any | null; data: any | null };
      async function attempt(updateData: Record<string, any>, select: string): Promise<LeadRun> {
        try {
          const { data, error } = await admin
            .from("atendimento_leads")
            .update(updateData)
            .eq("id", leadId)
            .select(select)
            .maybeSingle();
          return { err: error ?? null, data: data ?? null };
        } catch (e) {
          return { err: e, data: null };
        }
      }
      function runOkToLeadUpdate(leadRow: any) {
        return {
          funnel_stage: String((leadRow as any).funnel_stage ?? "aula_experimental_agendada").trim() || null,
          experimental_class_status: String((leadRow as any).experimental_class_status ?? safeStatus).trim() || null,
          experimental_class_booking_id: String((leadRow as any).experimental_class_booking_id ?? bookingIdStr ?? "").trim() || bookingIdStr,
          experimental_class_link: String((leadRow as any).experimental_class_link ?? safeLessonLink ?? "").trim() || safeLessonLink || null,
          updated_at: String((leadRow as any).updated_at ?? new Date().toISOString()),
          experimental_class_lead_date: String((leadRow as any).experimental_class_lead_date ?? safeLeadDate ?? "").trim() || safeLeadDate,
          experimental_class_lead_time: String((leadRow as any).experimental_class_lead_time ?? safeLeadTime ?? "").trim() || safeLeadTime,
          experimental_class_professor_date: String((leadRow as any).experimental_class_professor_date ?? safeProfessorDate ?? "").trim() || safeProfessorDate,
          experimental_class_professor_time: String((leadRow as any).experimental_class_professor_time ?? safeProfessorTime ?? "").trim() || safeProfessorTime,
          experimental_class_lead_start_at: String((leadRow as any).experimental_class_lead_start_at ?? leadStartAt ?? "").trim() || leadStartAt,
          experimental_class_professor_start_at: String((leadRow as any).experimental_class_professor_start_at ?? professorStartAt ?? "").trim() || professorStartAt,
        };
      }
      function stripColumnFromSelect(selectStr: string, columnName: string): string {
        const keys = selectStr.split(",").map((s) => s.trim()).filter(Boolean);
        const filtered = keys.filter((k) => k.toLowerCase() !== columnName.toLowerCase());
        return filtered.length > 0 ? filtered.join(", ") : "id, updated_at";
      }
      let pendingUpdate: Record<string, any> | null = fullUpdateData;
      let pendingSelect: string = selectFull;
      let run: LeadRun | null = null;
      let attempts = 0;
      let okAppliedEmpty = false;
      while (pendingUpdate && attempts < 10) {
        attempts += 1;
        run = await attempt(pendingUpdate, pendingSelect);
        if (!run.err && run.data) {
          leadUpdate = runOkToLeadUpdate(run.data);
          break;
        }
        const errMsg = run?.err;
        const code = String((errMsg as any)?.code ?? "").trim();
        const is42703 = code === "42703" || isUndefinedColumnError(errMsg);
        const is42P01 = code === "42P01" || isUndefinedRelationError(errMsg) || code === "23502";
        if (is42703 || is42P01) {
          const stripped = stripUndefinedColumnFromPatch(pendingUpdate, errMsg);
          if (stripped.next) {
            if (Object.keys(stripped.next).length === 0) {
              okAppliedEmpty = true;
              break;
            }
            pendingUpdate = stripped.next;
            if (stripped.stripped) {
              pendingSelect = stripColumnFromSelect(pendingSelect, stripped.stripped);
            }
            continue;
          }
        }
        break;
      }
      if (okAppliedEmpty) {
        leadUpdate = fallback();
      }
      if (!leadUpdate) {
        try {
          const { data: fb } = await (admin
            .from("atendimento_leads")
            .select("id, updated_at, funnel_stage")
            .eq("id", leadId)
            .maybeSingle()) as any;
          leadUpdate = {
            funnel_stage: String((fb as any)?.funnel_stage ?? "aula_experimental_agendada").trim() || null,
            experimental_class_status: safeStatus,
            updated_at: String((fb as any)?.updated_at ?? new Date().toISOString()),
            experimental_class_lead_date: safeLeadDate,
            experimental_class_lead_time: safeLeadTime,
            experimental_class_professor_date: safeProfessorDate,
            experimental_class_professor_time: safeProfessorTime,
            experimental_class_lead_start_at: leadStartAt,
            experimental_class_professor_start_at: professorStartAt,
          };
        } catch {
          leadUpdate = fallback();
        }
      }
    }

    try {
      await admin.from("atendimento_history_events").insert({
        lead_id: leadId,
        event_type: "experimental_class_scheduled",
        assigned_user_email: "atendimento.usa.music@gmail.com",
        details: {
          booking_id: bookingOut?.id ? String(bookingOut.id) : null,
          status: safeStatus,
          professor_date: safeProfessorDate,
          professor_time: safeProfessorTime,
          professor_timezone: safeProfessorTz,
          lead_date: safeLeadDate,
          lead_time: safeLeadTime,
          lead_timezone: safeLeadTz,
          professor_start_at: professorStartAt,
          lead_start_at: leadStartAt,
          lesson_link: safeLessonLink,
          source: "painel_atendimento_edit_experimental",
        },
      });
    } catch {
      // ignore
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

    const bookingIdForHistory = bookingOut?.id ? String(bookingOut.id) : `draft-${leadId}`;
    const studentPhone = String((leadExists as any)?.phone ?? "").trim();
    if (studentPhone) {
      try {
        for (const m of buildExperimentalClassStudentWhatsAppMessages(firstName)) {
          await sendAtendimentoWhatsAppText({
            phone: studentPhone,
            message: m,
          });
        }
      } catch (error) {
        await appendHistoryEvent({
          leadId,
          eventType: "experimental_class_whatsapp_confirmation_failed",
          title: "Falha ao enviar a confirmação da aula experimental no WhatsApp",
          details: {
            booking_id: bookingIdForHistory,
            phone: studentPhone,
            error: error instanceof Error ? error.message : String(error),
          },
          actorType: "system",
        });
      }
    }

    const assignedBookingResolved =
      resolveExperimentalClassAssignedProfessorPhone({
        bookingAssignedPhone: String((bookingOut as any)?.assigned_professor_phone ?? "").trim(),
        bookingAssignedName: String((bookingOut as any)?.assigned_professor_name ?? "").trim(),
        flatAssignedPhone: String((leadExists as any)?.experimental_class_professor_phone ?? "").trim(),
        flatAssignedName: String((leadExists as any)?.experimental_class_professor_name ?? "").trim(),
      });

    try {
      await sendAtendimentoWhatsAppText({
        phone: EXPERIMENTAL_CLASS_REGISTERED_ATTENDANT_NOTIFICATION_PHONE,
        message: buildExperimentalClassRegisteredAttendantWhatsAppMessage(firstName),
      });
      await appendHistoryEvent({
        leadId,
        eventType: "experimental_class_registered_attendant_notification_sent",
        title: "Atendente cadastrado notificado sobre novo agendamento de aula experimental",
        details: {
          booking_id: bookingIdForHistory,
          phone: EXPERIMENTAL_CLASS_REGISTERED_ATTENDANT_NOTIFICATION_PHONE,
        },
        actorType: "system",
      });
    } catch (error) {
      await appendHistoryEvent({
        leadId,
        eventType: "experimental_class_registered_attendant_notification_failed",
        title: "Falha ao notificar o atendente cadastrado sobre novo agendamento de aula experimental",
        details: {
          booking_id: bookingIdForHistory,
          phone: EXPERIMENTAL_CLASS_REGISTERED_ATTENDANT_NOTIFICATION_PHONE,
          error: error instanceof Error ? error.message : String(error),
        },
        actorType: "system",
      });
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
