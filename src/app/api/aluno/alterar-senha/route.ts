import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: "Sessão inválida." }, { status: 401 });
    }
    const authUserId = String(session.user.id);

    const body = (await req.json().catch(() => null)) as {
      current_password?: string | null;
      new_password?: string | null;
      confirm_password?: string | null;
    } | null;

    const current = String(body?.current_password ?? "").trim();
    const newPwd = String(body?.new_password ?? "").trim();
    const confirm = String(body?.confirm_password ?? "").trim();

    if (!current) {
      return NextResponse.json(
        { ok: false, error: "Informe a senha atual." },
        { status: 400 },
      );
    }
    if (newPwd.length < 4) {
      return NextResponse.json(
        { ok: false, error: "A nova senha deve ter no mínimo 4 caracteres." },
        { status: 400 },
      );
    }
    if (newPwd !== confirm) {
      return NextResponse.json(
        { ok: false, error: "A confirmação da nova senha não confere." },
        { status: 400 },
      );
    }

    const admin = createSupabaseAdminClient();
    const { data: profileRow } = await admin
      .from("profiles")
      .select("phone, email, access_scope, user_id")
      .eq("user_id", authUserId)
      .maybeSingle();

    if (!profileRow) {
      return NextResponse.json({ ok: false, error: "Perfil não encontrado." }, { status: 404 });
    }
    const scope = String((profileRow as any)?.access_scope ?? "").trim();
    if (scope !== "aluno") {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const profilePhoneDigits = String((profileRow as any)?.phone ?? "").replace(/\D/g, "");
    const profileEmail = String((profileRow as any)?.email ?? "").trim().toLowerCase();
    const userMetaLeadId =
      session.user.user_metadata &&
      typeof session.user.user_metadata === "object" &&
      "lead_id" in (session.user.user_metadata as object)
        ? String((session.user.user_metadata as any).lead_id ?? "")
        : "";

    let leadId: string | null = null;
    if (userMetaLeadId) {
      const { data } = await admin
      .from("atendimento_leads")
      .select("id")
      .eq("id", userMetaLeadId)
      .limit(1)
      .maybeSingle();
      if (data) leadId = String((data as any).id);
    }
    if (!leadId && profilePhoneDigits) {
      const { data: rows } = await admin
        .from("atendimento_leads")
        .select("id, phone")
        .order("updated_at", { ascending: false })
        .limit(200);
      if (Array.isArray(rows)) {
        for (const r of rows as any[]) {
          const rd = String((r as any).phone ?? "").replace(/\D/g, "");
          if (rd && (rd.endsWith(profilePhoneDigits) || profilePhoneDigits.endsWith(rd))) {
            leadId = String(r.id);
            break;
          }
        }
      }
    }
    if (!leadId && profileEmail) {
      const { data } = await admin
        .from("atendimento_leads")
        .select("id")
        .eq("student_email", profileEmail)
        .limit(1)
        .maybeSingle();
      if (data) leadId = String((data as any).id);
    }
    if (!leadId) {
      return NextResponse.json(
        { ok: false, error: "Matrícula associada não encontrada." },
        { status: 404 },
      );
    }

    const { data: leadRow } = await admin
      .from("atendimento_leads")
      .select("recurring_registration_password")
      .eq("id", leadId)
      .limit(1)
      .maybeSingle();
    const saved = String((leadRow as any)?.recurring_registration_password ?? "").trim();

    if (saved !== current) {
      return NextResponse.json(
        { ok: false, error: "Senha atual incorreta." },
        { status: 409 },
      );
    }

    const { error: updErr } = await admin
      .from("atendimento_leads")
      .update({
        recurring_registration_password: newPwd,
        updated_at: new Date().toISOString(),
      })
      .eq("id", leadId);

    if (updErr) {
      const msg = String(updErr.message ?? "").toLowerCase();
      if (/column.*does not exist|PGRST204|PGRST205|42703/i.test(msg)) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "Campo de senha ainda não disponível. Contate o suporte técnico.",
          },
          { status: 501 },
        );
      }
      throw updErr;
    }

    await admin.auth.admin
      .updateUserById(authUserId, { password: newPwd })
      .catch(() => {});

    try {
      const { data: convRow } = await admin
        .from("atendimento_conversations")
        .select("id")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if ((convRow as any)?.id) {
        const { appendHistoryEvent } = await import("@/lib/atendimento/server");
        await appendHistoryEvent({
          leadId,
          conversationId: String((convRow as any).id),
          eventType: "recurring_registration_password_changed_by_student",
          title: "Senha de matrícula recorrente alterada pelo Aluno pelo Painel do Aluno",
          details: { auth_user_id: authUserId },
          actorType: "student",
          actorEmail: profileEmail || null,
        }).catch(() => {});
      }
    } catch {}

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[aluno-alterar-senha] POST error", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Falha ao alterar a senha. Tente novamente.",
      },
      { status: 500 },
    );
  }
}
