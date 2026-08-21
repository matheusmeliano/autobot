import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ATENDIMENTO_PROFESSOR_TIME_ZONE } from "@/lib/atendimento/constants";
import { listRecurringWeekdayAvailability } from "@/lib/atendimento/experimentalClass";

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

async function listBookedExperimental(admin: ReturnType<typeof createSupabaseAdminClient>, nowIso: string) {
  try {
    const { data, error } = await admin
      .from("atendimento_experimental_class_bookings")
      .select("professor_start_at")
      .eq("status", "scheduled")
      .gte("professor_start_at", nowIso);
    if (error && !String((error as any)?.code ?? "").includes("42P01")) return [];
    const arr = Array.isArray(data) ? (data as Array<{ professor_start_at?: string | null }>) : [];
    return arr.map((r) => String(r?.professor_start_at ?? "")).filter(Boolean);
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tzLead = String(searchParams.get("lead_timezone") ?? "").trim();
    const tzBrowser = String(searchParams.get("timezone") ?? "").trim();
    const tzRaw = tzLead || tzBrowser || ATENDIMENTO_PROFESSOR_TIME_ZONE;
    const admin = createSupabaseAdminClient();
    const nowIso = new Date().toISOString();
    const bookedStarts = await listBookedExperimental(admin, nowIso);

    const result = listRecurringWeekdayAvailability({
      now: new Date(nowIso),
      leadTimeZone: tzRaw,
      bookedProfessorStartAts: bookedStarts,
      lookAheadWeeks: 2,
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
      generatedAt: nowIso,
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
