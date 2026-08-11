import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ATENDIMENTO_PROFESSOR_TIME_ZONE } from "@/lib/atendimento/constants";
import { listRecurringWeekdayAvailability } from "@/lib/atendimento/experimentalClass";

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
    const tzRaw = String(searchParams.get("timezone") ?? "").trim() || ATENDIMENTO_PROFESSOR_TIME_ZONE;
    const admin = createSupabaseAdminClient();
    const nowIso = new Date().toISOString();
    const bookedStarts = await listBookedExperimental(admin, nowIso);

    const result = listRecurringWeekdayAvailability({
      now: new Date(nowIso),
      leadTimeZone: tzRaw,
      bookedProfessorStartAts: bookedStarts,
      lookAheadWeeks: 6,
    });

    const slotsObj: Record<string, unknown> = {};
    for (const [key, value] of result.slotsByWeekday.entries()) {
      slotsObj[key] = Array.isArray(value) ? value : [];
    }

    return NextResponse.json({
      ok: true,
      dates: result.dates,
      slotsByWeekday: slotsObj,
      timeZone: tzRaw,
      generatedAt: nowIso,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err ?? ""),
      },
      { status: 500 },
    );
  }
}
