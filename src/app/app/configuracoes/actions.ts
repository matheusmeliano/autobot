"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BRAZIL_TIMEZONES } from "@/lib/timezone";

const schema = z.object({
  timezone: z.enum(BRAZIL_TIMEZONES),
});

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

  return { ok: true };
}
