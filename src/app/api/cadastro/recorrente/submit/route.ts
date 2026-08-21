import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { findLeadByPhone } from "@/lib/atendimento/server";
import { RECURRING_WEEKDAY_LABELS_PT_BR } from "@/lib/atendimento/experimentalClass";

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

function toNomeESobrenome(raw: string | null | undefined): string {
  const clean = String(raw ?? "").trim();
  if (!clean) return "";
  const parts = clean.split(/\s+/).filter((s) => s && s.trim());
  if (parts.length <= 2) return clean;
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

export const runtime = "nodejs";

type SubmitPayload = {
  nome?: string | null;
  telefone: string;
  senha?: string | null;
  weekday: "mon" | "tue" | "wed" | "thu" | "fri" | "sat";
  professorTime: string;
  leadTime?: string | null;
  weekdayLabel?: string | null;
  professorDate?: string | null;
  professorStartAt?: string | null;
};

export async function POST(req: NextRequest) {
  try {
    const rawBody = (await req.json().catch(() => null)) as SubmitPayload | null;
    if (!rawBody || typeof rawBody !== "object") {
      return NextResponse.json({ ok: false, error: "Corpo inválido." }, { status: 400 });
    }
    const {
      nome,
      telefone,
      senha,
      weekday,
      professorTime,
      leadTime,
      weekdayLabel,
      professorDate,
      professorStartAt,
    } = rawBody as SubmitPayload;

    const safePhoneDigits = String(telefone ?? "").replace(/\D/g, "").trim();
    if (safePhoneDigits.length < 10) {
      return NextResponse.json({ ok: false, error: "Telefone inválido." }, { status: 400 });
    }
    if (!weekday || !["mon", "tue", "wed", "thu", "fri", "sat"].includes(String(weekday))) {
      return NextResponse.json({ ok: false, error: "Dia inválido." }, { status: 400 });
    }
    if (!String(professorTime ?? "").trim()) {
      return NextResponse.json({ ok: false, error: "Horário inválido." }, { status: 400 });
    }

    const safeNome = toNomeESobrenome(nome);

    const admin = createSupabaseAdminClient();
    let lead = await findLeadByPhone({ phone: safePhoneDigits });
    if (!lead?.id) {
      try {
        function phoneCandidates(base: string): string[] {
          const out = new Set<string>();
          out.add(base);
          if (base.startsWith("55") && base.length >= 12) out.add(base.slice(2));
          else if (base.length >= 10 && !base.startsWith("55")) out.add(`55${base}`);
          if (base.length === 10 && !base.startsWith("55")) {
            const ddd = base.slice(0, 2); const rest = base.slice(2);
            out.add(`${ddd}9${rest}`); out.add(`55${ddd}9${rest}`);
          } else if (base.length === 11 && !base.startsWith("55") && base[2] === "9") {
            const ddd = base.slice(0, 2); const rest = base.slice(3);
            out.add(`${ddd}${rest}`); out.add(`55${ddd}${rest}`);
          } else if (base.length === 13 && base.startsWith("55") && base[4] === "9") {
            const ddd = base.slice(2, 4); const rest = base.slice(5);
            out.add(`55${ddd}${rest}`); out.add(`${ddd}${rest}`);
          } else if (base.length === 12 && base.startsWith("55")) {
            const ddd = base.slice(2, 4); const rest = base.slice(4);
            out.add(`55${ddd}9${rest}`); out.add(`${ddd}9${rest}`);
          }
          return Array.from(out);
        }
        const cands = phoneCandidates(safePhoneDigits);
        const fallbackSel = await admin
          .from("atendimento_leads")
          .select("*")
          .in("phone", cands)
          .order("created_at", { ascending: false })
          .limit(5)
          .maybeSingle();
        if (!fallbackSel.error && fallbackSel.data && (fallbackSel.data as any).id) {
          lead = fallbackSel.data as any;
        }
      } catch {}
    }
    if (!lead?.id) {
      return NextResponse.json(
        {
          ok: false,
          blocked: true,
          error:
            "Acesso bloqueado. Seu cadastro foi excluído. Para acessar novamente, inicie um novo atendimento pelo WhatsApp.",
        },
        { status: 403 },
      );
    }

    const safeWeekdayLabel =
      String(weekdayLabel ?? "").trim() ||
      RECURRING_WEEKDAY_LABELS_PT_BR[weekday as keyof typeof RECURRING_WEEKDAY_LABELS_PT_BR] ||
      "";
    const nowIso = new Date().toISOString();
    const safeProfessorDate = /^\d{4}-\d{2}-\d{2}$/.test(String(professorDate ?? "").trim())
      ? String(professorDate!).trim()
      : null;
    const safeProfessorStartAt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(String(professorStartAt ?? "").trim())
      ? String(professorStartAt!).trim()
      : null;

    const patchFull: Record<string, unknown> = {
      recurring_class_status: "confirmado",
      recurring_class_weekday: weekday,
      recurring_class_weekday_label: safeWeekdayLabel,
      recurring_class_professor_time: String(professorTime ?? "").trim(),
      recurring_class_lead_time: String(leadTime ?? String(professorTime ?? "")).trim(),
      recurring_class_created_at: nowIso,
      recurring_registration_step: 4,
      funnel_stage: "contrato_coletando_dados",
      status: "contrato_coletando_dados",
      contract_status: "coletando_dados",
      updated_at: nowIso,
      ...(safeNome ? { full_name: safeNome } : {}),
      ...(String(senha ?? "").trim() ? { signup_password_raw_temp: String(senha ?? "").trim() } : {}),
      ...(String(senha ?? "").trim() ? { recurring_registration_password: String(senha ?? "").trim() } : {}),
      ...(safeProfessorDate ? { recurring_class_professor_date: safeProfessorDate } : {}),
      ...(safeProfessorStartAt ? { recurring_class_first_class_at: safeProfessorStartAt } : {}),
    };

    const patchMinimalGuaranteed: Record<string, unknown> = {
      recurring_class_status: "confirmado",
      recurring_class_weekday: weekday,
      funnel_stage: "contrato_coletando_dados",
      status: "contrato_coletando_dados",
      contract_status: "coletando_dados",
      updated_at: nowIso,
      ...(safeNome ? { full_name: safeNome } : {}),
      ...(String(senha ?? "").trim() ? { signup_password_raw_temp: String(senha ?? "").trim() } : {}),
    };

    function extractCol(msg: unknown): string | null {
      if (!msg) return null;
      const s = String(msg).toLowerCase();
      const m1 = /column "([^"]+)" does not exist/.exec(s);
      if (m1 && m1[1]) return m1[1];
      const m2 = /could not find the '([^']+)' column/.exec(s);
      if (m2 && m2[1]) return m2[1];
      return null;
    }
    const BLACKLIST = new Set([
      "payment_confirmed_at","payment_rejected_at","contract_signed_at","contract_pdf_url",
      "recurring_registration_step","contract_status","payment_status","enrollment_number",
      "recurring_class_professor_date","recurring_class_first_class_at",
      "recurring_class_weekday_label","recurring_class_professor_time","recurring_class_lead_time",
      "recurring_class_created_at","recurring_registration_password",
    ]);
    function stripPatch(p: Record<string, unknown>, err: unknown): Record<string, unknown> | null {
      const c = extractCol((err as any)?.message || String(err ?? ""));
      if (c && p[c] !== undefined) {
        const n = { ...p }; delete n[c]; return n;
      }
      for (const s of BLACKLIST) if (p[s] !== undefined) { const n = { ...p }; delete n[s]; return n; }
      return null;
    }

    let appliedPatch: "full" | "minimal" = "minimal";
    let fullPatchError: string | null = null;
    {
      let p: Record<string, unknown> | null = { ...patchFull };
      let ok = false;
      while (p !== null) {
        try {
          const { error: errFull } = await admin
            .from("atendimento_leads")
            .update(p as any)
            .eq("id", String(lead.id));
          if (errFull) throw errFull;
          appliedPatch = "full";
          ok = true;
          break;
        } catch (e1) {
          const msg = toErrorMessage(e1, "");
          const code = String((e1 as any)?.code ?? "");
          if (code === "42703" || extractCol(msg) !== null) {
            const next = stripPatch(p, e1);
            if (next === null) { p = null; break; }
            p = next;
            continue;
          }
          fullPatchError = msg;
          break;
        }
      }
      if (!ok) {
        appliedPatch = "minimal";
        let q: Record<string, unknown> | null = { ...patchMinimalGuaranteed };
        let okMin = false;
        while (q !== null) {
          try {
            const { error: errMin } = await admin
              .from("atendimento_leads")
              .update(q as any)
              .eq("id", String(lead.id));
            if (errMin) throw errMin;
            okMin = true; break;
          } catch (e2) {
            const msg = toErrorMessage(e2, "");
            const code = String((e2 as any)?.code ?? "");
            if (code === "42703" || extractCol(msg) !== null) {
              const next = stripPatch(q, e2);
              if (next === null) { q = null; break; }
              q = next; continue;
            }
            return NextResponse.json(
              { ok: false, error: toErrorMessage(e2, "Erro ao atualizar lead.") },
              { status: 500 },
            );
          }
        }
        if (!okMin) {
          return NextResponse.json(
            { ok: false, error: "Erro ao atualizar lead." },
            { status: 500 },
          );
        }
      }
    }

    try {
      const { data: convRow } = await admin
        .from("atendimento_conversations")
        .select("id")
        .eq("lead_id", String(lead.id))
        .eq("channel", "whatsapp")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if ((convRow as any)?.id) {
        const { appendHistoryEvent } = await import("@/lib/atendimento/server");
        await appendHistoryEvent({
          leadId: String(lead.id),
          conversationId: String((convRow as any).id),
          eventType: "recurring_class_scheduled",
          title: "Aula recorrente cadastrada pela plataforma",
          details: {
            weekday,
            weekday_label: safeWeekdayLabel,
            professor_time: String(professorTime ?? ""),
            lead_time: String(leadTime ?? String(professorTime ?? "")),
            professor_date: safeProfessorDate,
            professor_start_at: safeProfessorStartAt,
            applied_patch: appliedPatch,
            full_patch_error: fullPatchError,
            source: "cadastro_recorrente_plataforma",
          },
          actorType: "lead",
        }).catch(() => {});
      }
    } catch {}

    return NextResponse.json({
      ok: true,
      leadId: String(lead.id),
      appliedPatch,
      fullPatchError,
      scheduled: {
        weekday,
        weekdayLabel: safeWeekdayLabel,
        professorTime: String(professorTime ?? "").trim(),
        leadTime: String(leadTime ?? String(professorTime ?? "")).trim(),
      },
      redirect_to: "/atendimento?slug=lucas-brum-online-music-usa",
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
