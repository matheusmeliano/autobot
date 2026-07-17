"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BRAZIL_TIMEZONES, zonedDateTimeToUtcIso } from "@/lib/timezone";

const schema = z.object({
  timezone: z.enum(BRAZIL_TIMEZONES),
});

const themeSchema = z.object({
  theme: z.enum(["light", "dark"]),
});

function lastDayOfMonth(year: number, month1: number) {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function buildChargeLocalDate(year: number, month: number, day: number) {
  const safeDay = Math.max(1, Math.min(day, lastDayOfMonth(year, month)));
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
}

export async function updateTimezoneAction(input: unknown) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Fuso horário inválido." };

  const supabase = await createSupabaseServerClient();
  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes.user?.id;
  if (!userId) return { ok: false, error: "Sem sessão." };

  const { error } = await supabase.from("profiles").upsert(
    {
      user_id: userId,
      timezone: parsed.data.timezone,
    },
    { onConflict: "user_id" },
  );
  if (error) {
    const msg = error.message ?? "";
    const missingColumn = /timezone/i.test(msg) && /column/i.test(msg);
    if (missingColumn) {
      return {
        ok: false,
        error: "Rode a migration para adicionar a coluna timezone em profiles e tente novamente.",
      };
    }
    return { ok: false, error: msg };
  }

  const pageSize = 200;
  for (let offset = 0; ; offset += pageSize) {
    const { data: openChargeSchedules, error: schedulesError } = await supabase
      .from("schedules")
      .select(
        "id, status, schedule_timezone, charge_due_at, data_envio, recurrence_time, payment_received_at, charge:debtor_charges!schedules_charge_id_fkey(due_day, recurrence_month, recurrence_year), debtors(retry_time)",
      )
      .eq("user_id", userId)
      .is("closed_at", null)
      .not("charge_id", "is", null)
      .eq("status", "agendado")
      .order("created_at", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (schedulesError) return { ok: false, error: schedulesError.message };

    for (const schedule of openChargeSchedules ?? []) {
      const charge = (schedule as any)?.charge ?? null;
      const dueDay = Number(charge?.due_day ?? 0);
      const recurrenceMonth = Number(charge?.recurrence_month ?? 0);
      const recurrenceYear = Number(charge?.recurrence_year ?? 0);
      if (!dueDay || !recurrenceMonth || !recurrenceYear) continue;

      const retryTime =
        String((schedule as any)?.debtors?.retry_time ?? "").trim() ||
        String((schedule as any)?.recurrence_time ?? "").trim() ||
        "09:00";
      const dueLocalDate = buildChargeLocalDate(recurrenceYear, recurrenceMonth, dueDay);
      const expectedDueAt = zonedDateTimeToUtcIso({
        date: dueLocalDate,
        time: retryTime,
        timeZone: parsed.data.timezone,
      });

      if (
        String((schedule as any)?.charge_due_at ?? "") === expectedDueAt &&
        String((schedule as any)?.data_envio ?? "") === expectedDueAt &&
        String((schedule as any)?.recurrence_time ?? "") === retryTime &&
        String((schedule as any)?.schedule_timezone ?? "") === parsed.data.timezone
      ) {
        continue;
      }

      const { error: updateScheduleError } = await supabase
        .from("schedules")
        .update({
          schedule_timezone: parsed.data.timezone,
          recurrence_day: dueDay,
          recurrence_time: retryTime,
          charge_due_at: expectedDueAt,
          data_envio: expectedDueAt,
        })
        .eq("id", String((schedule as any)?.id ?? ""));
      if (updateScheduleError) return { ok: false, error: updateScheduleError.message };
    }

    if ((openChargeSchedules ?? []).length < pageSize) break;
  }

  return { ok: true };
}

export async function updateThemeAction(input: unknown) {
  const parsed = themeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Tema inválido." };

  const supabase = await createSupabaseServerClient();
  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes.user?.id;
  if (!userId) return { ok: false, error: "Sem sessão." };

  const { error } = await supabase.from("profiles").upsert(
    {
      user_id: userId,
      theme: parsed.data.theme,
    },
    { onConflict: "user_id" },
  );

  if (error) {
    const msg = error.message ?? "";
    const missingColumn = /theme/i.test(msg) && /column/i.test(msg);
    if (missingColumn) {
      return {
        ok: false,
        error: "Rode a migration para adicionar a coluna theme em profiles e tente novamente.",
      };
    }
    return { ok: false, error: msg };
  }

  return { ok: true };
}
