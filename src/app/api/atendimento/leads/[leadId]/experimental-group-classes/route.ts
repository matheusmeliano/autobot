import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAtendimentoUser } from "@/lib/atendimento/server";
import {
  buildExperimentalGroupClassSlotsForLead,
  buildRecurringGroupClassSlotsForLead,
  loadExperimentalGroupClassSettings,
} from "@/lib/atendimento/experimentalGroupClassServer";
import {
  isLeadPhoneEligibleForExperimentalGroup,
  resolveConfiguredProfessorFromExperimentalGroupSettings,
  resolveExperimentalGroupProfessorFromLead,
  resolveRecurringGroupProfessorFromLead,
} from "@/lib/atendimento/experimentalGroupClass";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isLeadRecurringStudent(lead: Record<string, unknown> | null): boolean {
  if (!lead) return false;
  const payStatusRaw = String((lead as any)?.payment_status ?? "").trim().toLowerCase();
  const payConfirmedAtRaw = String((lead as any)?.payment_confirmed_at ?? "").trim();
  const leadStatusRaw = String((lead as any)?.status ?? "").trim().toLowerCase();
  const funnelRaw = String((lead as any)?.funnel_stage ?? "").trim().toLowerCase();
  return (
    payStatusRaw === "confirmado" ||
    payStatusRaw === "matriculado" ||
    Boolean(payConfirmedAtRaw && payConfirmedAtRaw !== "null") ||
    leadStatusRaw === "matriculado" ||
    leadStatusRaw === "matricula_confirmada" ||
    funnelRaw === "matriculado" ||
    funnelRaw === "matricula_confirmada" ||
    Boolean(String((lead as any)?.enrollment_number ?? "").trim())
  );
}

function leadHasStateAndCity(lead: Record<string, unknown> | null): boolean {
  if (!lead) return false;
  const stateRaw = String((lead as any)?.state ?? "").trim();
  const cityRaw = String((lead as any)?.city ?? "").trim();
  return Boolean(stateRaw && cityRaw);
}

export async function GET(_req: Request, { params }: { params: Promise<{ leadId: string }> }) {
  try {
    const auth = await requireAtendimentoUser();
    if (!auth.ok) {
      return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const leadId = String((await params).leadId ?? "").trim();
    if (!leadId) {
      return Response.json({ ok: false, error: "lead_missing" }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();
    const { data: lead, error: leadError } = await admin
      .from("atendimento_leads")
      .select("*")
      .eq("id", leadId)
      .eq("assigned_user_email", "atendimento.usa.music@gmail.com")
      .maybeSingle();

    if (leadError) {
      return Response.json({ ok: false, error: leadError.message }, { status: 500 });
    }
    if (!lead?.id) {
      return Response.json({ ok: false, error: "lead_not_found" }, { status: 404 });
    }

    const { settings, updatedAt } = await loadExperimentalGroupClassSettings({ admin });
    const isStudentLead = isLeadRecurringStudent(lead as any);
    const hasPhone = isLeadPhoneEligibleForExperimentalGroup((lead as any)?.phone ?? null);
    const hasStateAndCity = leadHasStateAndCity(lead as any);
    const assignedProfessor =
      (isStudentLead
        ? resolveRecurringGroupProfessorFromLead(lead as any)
        : resolveExperimentalGroupProfessorFromLead(lead as any)) ??
      resolveConfiguredProfessorFromExperimentalGroupSettings(
        settings,
        isStudentLead ? "recorrente" : "experimental",
      );

    const slots = isStudentLead
      ? await buildRecurringGroupClassSlotsForLead({
          admin,
          lead: lead as Record<string, unknown>,
          settings,
          now: new Date(),
          lookAheadDays: 56,
        })
      : await buildExperimentalGroupClassSlotsForLead({
          admin,
          lead: lead as Record<string, unknown>,
          settings,
          now: new Date(),
          lookAheadDays: 42,
          excludeLeadIdFromIndividualBookings: true,
        });

    const currentAssignedSlot =
      slots.find((slot) => slot.is_current_lead_assigned) ?? null;

    const reasons: string[] = [];
    if (!settings.enabled) reasons.push("feature_disabled");
    if (!hasPhone) reasons.push("missing_valid_phone");
    if (!hasStateAndCity) reasons.push("missing_state_city");
    if (!assignedProfessor) {
      reasons.push(isStudentLead ? "missing_assigned_recurring_professor" : "missing_assigned_professor");
    }
    return Response.json({
      ok: true,
      lead_slot_type: isStudentLead ? "recorrente" : "experimental",
      settings,
      settings_updated_at: updatedAt,
      assigned_professor: assignedProfessor,
      lead: {
        id: String((lead as any)?.id ?? ""),
        experimental_class_mode_preference:
          String((lead as any)?.experimental_class_mode_preference ?? "").trim() || null,
        experimental_class_group_interest: Boolean(
          (lead as any)?.experimental_class_group_interest,
        ),
        experimental_class_group_interest_at:
          String((lead as any)?.experimental_class_group_interest_at ?? "").trim() || null,
        experimental_class_group_class_id:
          String((lead as any)?.experimental_class_group_class_id ?? "").trim() || null,
        experimental_class_group_status:
          String((lead as any)?.experimental_class_group_status ?? "").trim() || null,
      },
      can_open_modal: reasons.length === 0 || Boolean(currentAssignedSlot),
      reasons,
      current_group_class_id:
        currentAssignedSlot?.group_class_id ??
        (String((lead as any)?.experimental_class_group_class_id ?? "").trim() || null),
      slots,
    });
  } catch (error: any) {
    return Response.json(
      { ok: false, error: String(error?.message ?? error ?? "erro interno") },
      { status: 500 },
    );
  }
}
