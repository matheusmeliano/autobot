import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAtendimentoUser } from "@/lib/atendimento/server";
import {
  buildExperimentalGroupClassSlotsForLead,
  loadExperimentalGroupClassSettings,
} from "@/lib/atendimento/experimentalGroupClassServer";
import {
  isLeadPhoneEligibleForExperimentalGroup,
  resolveExperimentalGroupProfessorFromLead,
} from "@/lib/atendimento/experimentalGroupClass";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function hasIndividualExperimentalScheduled(lead: Record<string, unknown> | null): boolean {
  if (!lead) return false;
  const statusRaw = String((lead as any)?.experimental_class_status ?? "").trim().toLowerCase();
  const flatStartAt = String((lead as any)?.experimental_class_professor_start_at ?? "").trim();
  if (statusRaw && statusRaw !== "cancelled" && flatStartAt) return true;
  return false;
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
    const hasPhone = isLeadPhoneEligibleForExperimentalGroup((lead as any)?.phone ?? null);
    const assignedProfessor = resolveExperimentalGroupProfessorFromLead(lead as any);

    const { data: activeIndividualBookings, error: activeIndividualBookingsError } = await admin
      .from("atendimento_experimental_class_bookings")
      .select("id")
      .eq("lead_id", leadId)
      .in("status", ["scheduled", "confirmed", "in_progress"])
      .limit(1);

    if (activeIndividualBookingsError && String((activeIndividualBookingsError as any)?.code ?? "") !== "42P01") {
      return Response.json({ ok: false, error: activeIndividualBookingsError.message }, { status: 500 });
    }

    const hasScheduledIndividual =
      Boolean((activeIndividualBookings ?? []).length) || hasIndividualExperimentalScheduled(lead as any);

    const slots = await buildExperimentalGroupClassSlotsForLead({
      admin,
      lead: lead as Record<string, unknown>,
      settings,
      now: new Date(),
      lookAheadDays: 42,
      excludeLeadIdFromIndividualBookings: false,
    });

    const currentAssignedSlot =
      slots.find((slot) => slot.is_current_lead_assigned) ?? null;

    const reasons: string[] = [];
    if (!settings.enabled) reasons.push("feature_disabled");
    if (!hasPhone) reasons.push("missing_valid_phone");
    if (!assignedProfessor) reasons.push("missing_assigned_professor");
    if (hasScheduledIndividual) reasons.push("individual_experimental_already_scheduled");

    return Response.json({
      ok: true,
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
