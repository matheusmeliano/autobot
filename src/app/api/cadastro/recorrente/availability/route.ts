import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ATENDIMENTO_PROFESSOR_TIME_ZONE } from "@/lib/atendimento/constants";
import { listRecurringWeekdayAvailability } from "@/lib/atendimento/experimentalClass";
import {
  loadRecurringCalendarOccupiedIntervals,
  normalizeRecurringSchedulePhoneDigits,
} from "@/lib/atendimento/server";

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

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tzLead = String(searchParams.get("lead_timezone") ?? "").trim();
    const tzBrowser = String(searchParams.get("timezone") ?? "").trim();
    const leadId = String(searchParams.get("lead_id") ?? "").trim();
    const leadPhone = String(searchParams.get("phone") ?? "").trim();
    const lookAheadWeeksRaw = Number(String(searchParams.get("look_ahead_weeks") ?? "").trim());
    const lookAheadWeeks =
      Number.isFinite(lookAheadWeeksRaw) && lookAheadWeeksRaw >= 2
        ? Math.min(Math.trunc(lookAheadWeeksRaw), 6)
        : 2;
    const tzRaw = tzLead || tzBrowser || ATENDIMENTO_PROFESSOR_TIME_ZONE;
    const admin = createSupabaseAdminClient();
    const now = new Date();
    const occupiedIntervals = await loadRecurringCalendarOccupiedIntervals({
      admin,
      now,
      lookAheadWeeks: 12,
    });

    let currentLead: Record<string, unknown> | null = null;
    if (leadId) {
      const { data } = await admin.from("atendimento_leads").select("*").eq("id", leadId).maybeSingle();
      currentLead = (data as Record<string, unknown> | null) ?? null;
    } else {
      const phoneDigits = leadPhone.replace(/\D/g, "").trim();
      if (phoneDigits) {
        const { data } = await admin
          .from("atendimento_leads")
          .select("*")
          .eq("phone", phoneDigits)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        currentLead = (data as Record<string, unknown> | null) ?? null;
      }
    }

    const currentLeadId = String(currentLead?.id ?? leadId ?? "").trim();
    const currentLeadPhoneDigits = normalizeRecurringSchedulePhoneDigits(
      currentLead?.phone ?? leadPhone,
    );
    const currentProfessorPhoneDigits = normalizeRecurringSchedulePhoneDigits(
      currentLead?.recurring_class_professor_phone,
    );
    const relevantIntervals = occupiedIntervals
      .filter((interval) => {
        if (
          interval.source === "recurring_schedule" &&
          currentLeadId &&
          String(interval.lead_id ?? "").trim() === currentLeadId
        ) {
          return false;
        }

        if (!currentLeadId && !currentLeadPhoneDigits && !currentProfessorPhoneDigits) {
          return true;
        }

        const professorMatches =
          currentProfessorPhoneDigits &&
          interval.professor_phone_digits &&
          currentProfessorPhoneDigits === interval.professor_phone_digits;
        const leadMatches =
          (currentLeadId && String(interval.lead_id ?? "").trim() === currentLeadId) ||
          (currentLeadPhoneDigits &&
            interval.lead_phone_digits &&
            currentLeadPhoneDigits === interval.lead_phone_digits);

        return Boolean(professorMatches || leadMatches);
      })
      .map((interval) => ({
        startAt: interval.start_at,
        endAt: interval.end_at,
      }));

    const result = listRecurringWeekdayAvailability({
      now,
      leadTimeZone: tzRaw,
      occupiedIntervals: relevantIntervals,
      lookAheadWeeks,
    });

    const slotsMap = (result.slotsByWeekdayDate ?? result.slotsByWeekday ?? {}) as Record<string, unknown>;
    const slotsObj: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(slotsMap)) {
      slotsObj[key] = Array.isArray(value) ? value : [];
    }

    return NextResponse.json({
      ok: true,
      dates: result.dates,
      slotsByWeekday: slotsObj,
      slotsByWeekdayDate: slotsObj,
      timeZone: tzRaw,
      generatedAt: now.toISOString(),
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
