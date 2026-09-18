import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAtendimentoUser } from "@/lib/atendimento/server";

export async function GET() {
  try {
    const auth = await requireAtendimentoUser();
    if (!auth.ok) {
      return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
    }
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("app_settings")
      .select("value, updated_at")
      .eq("key", "experimental_class_bot_disabled")
      .maybeSingle();
    if (error && String((error as any)?.code ?? "") !== "42P01") {
      return Response.json({ ok: false, error: error.message }, { status: 500 });
    }
    const raw = (data as any)?.value;
    const disabled =
      raw === true ||
      raw === "true" ||
      raw === 1 ||
      raw === "1" ||
      String(raw ?? "").trim().toLowerCase() === "true";
    return Response.json({
      ok: true,
      experimental_class_bot_disabled: disabled,
      updated_at: (data as any)?.updated_at ?? null,
    });
  } catch (error: any) {
    return Response.json(
      { ok: false, error: String(error?.message ?? error ?? "erro interno") },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const auth = await requireAtendimentoUser();
    if (!auth.ok) {
      return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
    }
    const body = await req.json().catch(() => null);
    const rawDisabled = (body as any)?.experimental_class_bot_disabled;
    const disabled =
      rawDisabled === true ||
      rawDisabled === "true" ||
      rawDisabled === 1 ||
      rawDisabled === "1";
    const admin = createSupabaseAdminClient();
    const nowIso = new Date().toISOString();
    const { error: upsertError } = await admin.from("app_settings").upsert(
      {
        key: "experimental_class_bot_disabled",
        value: disabled,
        updated_at: nowIso,
      },
      { onConflict: "key" },
    );
    if (upsertError && String((upsertError as any)?.code ?? "") === "42P01") {
      return Response.json(
        { ok: false, error: "app_settings table missing in Supabase. Please run latest migration." },
        { status: 500 },
      );
    }
    if (upsertError) {
      return Response.json({ ok: false, error: upsertError.message }, { status: 500 });
    }
    return Response.json({
      ok: true,
      experimental_class_bot_disabled: disabled,
      updated_at: nowIso,
    });
  } catch (error: any) {
    return Response.json(
      { ok: false, error: String(error?.message ?? error ?? "erro interno") },
      { status: 500 },
    );
  }
}
