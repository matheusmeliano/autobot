import { NextRequest, NextResponse } from "next/server";
import { requireAtendimentoUser } from "@/lib/atendimento/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  try {
    const auth = await requireAtendimentoUser();
    if (!auth?.ok) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const { leadId } = await params;
    const safeLeadId = String(leadId ?? "").trim();
    if (!safeLeadId) {
      return NextResponse.json({ ok: false, error: "Lead inválido." }, { status: 400 });
    }

    const body = (await req.json().catch(() => null)) as {
      new_password?: string | null;
    } | null;

    const newPassword = String(body?.new_password ?? "").trim();
    if (newPassword.length < 4) {
      return NextResponse.json(
        { ok: false, error: "A nova senha deve ter no mínimo 4 caracteres." },
        { status: 400 },
      );
    }

    const admin = createSupabaseAdminClient();

    const { error: updErr } = await admin
      .from("atendimento_leads")
      .update({
        recurring_registration_password: newPassword,
        updated_at: new Date().toISOString(),
      })
      .eq("id", safeLeadId);

    if (updErr) {
      const msg = String(updErr.message ?? "").toLowerCase();
      if (/column.*does not exist|PGRST204|PGRST205|42703/i.test(msg)) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "Campo de senha ainda não disponível na tabela. Contate o suporte técnico.",
          },
          { status: 501 },
        );
      }
      throw updErr;
    }

    try {
      const { data: convRow } = await admin
        .from("atendimento_conversations")
        .select("id")
        .eq("lead_id", safeLeadId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if ((convRow as any)?.id) {
        const { appendHistoryEvent } = await import("@/lib/atendimento/server");
        await appendHistoryEvent({
          leadId: safeLeadId,
          conversationId: String((convRow as any).id),
          eventType: "recurring_registration_password_changed_by_attendant",
          title: "Senha de matrícula recorrente alterada pelo atendente",
          details: { actor_email: auth.user.email },
          actorType: "attendant",
          actorEmail: auth.user.email,
        }).catch(() => {});
      }
    } catch {}

    try {
      const { data: leadRow } = await admin
        .from("atendimento_leads")
        .select("phone")
        .eq("id", safeLeadId)
        .limit(1)
        .maybeSingle();
      const leadPhoneDigits = leadRow && String((leadRow as any).phone ?? "").trim()
        ? String((leadRow as any).phone).replace(/\D/g, "")
        : null;

      let targetAuthUserId: string | null = null;

      {
        const { data: profileByLeadMeta } = await admin
          .from("profiles")
          .select("user_id, phone")
          .limit(200)
          .then(
            (res: any) => res,
            () => ({ data: null } as any),
          );
        void profileByLeadMeta;
      }

      try {
        const profileList = await admin
          .from("profiles")
          .select("user_id, phone, full_name")
          .order("updated_at", { ascending: false })
          .limit(200);
        if (Array.isArray((profileList as any)?.data)) {
          for (const p of (profileList as any).data as any[]) {
            const userId = String(p?.user_id ?? "").trim();
            if (!userId) continue;
            if (leadPhoneDigits) {
              const pp = String(p?.phone ?? "").replace(/\D/g, "");
              if (pp && (pp.endsWith(leadPhoneDigits) || leadPhoneDigits.endsWith(pp))) {
                targetAuthUserId = userId;
                break;
              }
            }
          }
        }
      } catch {}

      if (!targetAuthUserId) {
        try {
          const authUsers = await admin.auth.admin
            .listUsers({ perPage: 200 })
            .catch(() => ({ users: [] } as any));
          if (Array.isArray((authUsers as any).users)) {
            for (const u of (authUsers as any).users as any[]) {
              const userId = String(u?.id ?? "").trim();
              if (!userId) continue;
              const meta =
                u && typeof u === "object" && "user_metadata" in u && u.user_metadata && typeof u.user_metadata === "object"
                  ? (u as any).user_metadata
                  : null;
              if (meta && String(meta?.lead_id ?? "").trim() === safeLeadId) {
                targetAuthUserId = userId;
                break;
              }
              if (leadPhoneDigits) {
                const up = String(u?.phone ?? u?.phone_number ?? "").replace(/\D/g, "");
                if (up && (up.endsWith(leadPhoneDigits) || leadPhoneDigits.endsWith(up))) {
                  targetAuthUserId = userId;
                  break;
                }
              }
            }
          }
        } catch {}
      }

      if (targetAuthUserId) {
        await admin.auth.admin
          .updateUserById(targetAuthUserId, { password: newPassword })
          .catch(() => {});
      }
    } catch {}

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[lead-recurring-password] patch error", error);
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
