"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({
  instance_id: z.string().min(1),
  token: z.string().min(1),
  client_token: z.string().optional(),
  phone: z.string().optional(),
});

export async function upsertWhatsAppInstanceAction(input: unknown) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };

  const supabase = await createSupabaseServerClient();
  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes.user?.id;
  if (!userId) return { ok: false, error: "Sem sessão." };

  const { error } = await supabase.from("whatsapp_instances").upsert(
    {
      user_id: userId,
      instance_id: parsed.data.instance_id,
      token: parsed.data.token,
      client_token: parsed.data.client_token ?? null,
      phone: parsed.data.phone ?? null,
      status: "configured",
    },
    { onConflict: "user_id" }
  );

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
