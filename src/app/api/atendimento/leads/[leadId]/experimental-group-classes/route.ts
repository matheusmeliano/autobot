import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAtendimentoUser } from "@/lib/atendimento/server";
import { normalizePhoneDigits } from "@/lib/phone";
import {
  experimentalGroupWeekdayLabel,
  resolveExperimentalGroupPairIdForClass,
} from "@/lib/atendimento/experimentalGroupClass";
import {
  buildExperimentalGroupClassSlotsForLead,
  buildRecurringGroupClassSlotsForLead,
  loadExperimentalGroupClassSettings,
} from "@/lib/atendimento/experimentalGroupClassServer";
import { isLeadPhoneEligibleForExperimentalGroup } from "@/lib/atendimento/experimentalGroupClass";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isLeadRecurringStudent(lead: Record<string, unknown> | null): boolean {
  if (!lead) return false;
  const payStatusRaw = String((lead as any)?.payment_status ?? "").trim().toLowerCase();
  const payConfirmedAtRaw = String((lead as any)?.payment_confirmed_at ?? "").trim();
  const leadStatusRaw = String((lead as any)?.status ?? "").trim().toLowerCase();
  const funnelRaw = String((lead as any)?.funnel_stage ?? "").trim().toLowerCase();
  const recurringGroupPairId = String((lead as any)?.recurring_class_group_pair_id ?? "").trim();
  const recurringGroupStatus = String((lead as any)?.recurring_class_group_status ?? "")
    .trim()
    .toLowerCase();
  const autoConvertedByRecurringGroup =
    Boolean(recurringGroupPairId) &&
    recurringGroupStatus === "assigned" &&
    (leadStatusRaw === "aluno" || funnelRaw === "aluno_recorrente_cadastrado");
  return (
    payStatusRaw === "confirmado" ||
    payStatusRaw === "matriculado" ||
    Boolean(payConfirmedAtRaw && payConfirmedAtRaw !== "null") ||
    leadStatusRaw === "matriculado" ||
    leadStatusRaw === "matricula_confirmada" ||
    funnelRaw === "matriculado" ||
    funnelRaw === "matricula_confirmada" ||
    autoConvertedByRecurringGroup ||
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
    const leadAssignedExperimentalGroupId =
      String((lead as any)?.experimental_class_group_class_id ?? "").trim() || null;
    const leadAssignedExperimentalStatus = String(
      (lead as any)?.experimental_class_group_status ?? "",
    )
      .trim()
      .toLowerCase();
    const leadAssignedProfessorStartAt =
      String((lead as any)?.experimental_class_professor_start_at ?? "").trim() || null;
    const leadAssignedProfessorDate =
      String((lead as any)?.experimental_class_professor_date ?? "").trim() || null;
    const leadAssignedProfessorTime =
      String((lead as any)?.experimental_class_professor_time ?? "").trim() || null;
    const leadAssignedProfessorPhoneDigits = normalizePhoneDigits(
      (lead as any)?.experimental_class_professor_phone ?? null,
    );
    const leadHasExperimentalAssignment = Boolean(
      leadAssignedExperimentalStatus &&
        leadAssignedExperimentalStatus !== "removed" &&
        (leadAssignedExperimentalGroupId ||
          leadAssignedProfessorStartAt ||
          (leadAssignedProfessorDate && leadAssignedProfessorTime)),
    );
    const matchesLeadExperimentalAssignment = (slot: {
      slot_type: string;
      group_class_id: string | null;
      professor_start_at: string;
      professor_date: string;
      professor_time: string;
      professor_phone: string | null;
    }) => {
      if (slot.slot_type !== "experimental") return false;
      const slotGroupClassId = String(slot.group_class_id ?? "").trim() || null;
      if (leadAssignedExperimentalGroupId && slotGroupClassId === leadAssignedExperimentalGroupId) {
        return true;
      }
      const slotProfessorStartAt = String(slot.professor_start_at ?? "").trim() || null;
      if (leadAssignedProfessorStartAt && slotProfessorStartAt === leadAssignedProfessorStartAt) {
        return true;
      }
      const slotProfessorDate = String(slot.professor_date ?? "").trim() || null;
      const slotProfessorTime = String(slot.professor_time ?? "").trim() || null;
      if (
        leadAssignedProfessorDate &&
        leadAssignedProfessorTime &&
        slotProfessorDate === leadAssignedProfessorDate &&
        slotProfessorTime === leadAssignedProfessorTime
      ) {
        const slotProfessorPhoneDigits = normalizePhoneDigits(slot.professor_phone);
        if (
          !leadAssignedProfessorPhoneDigits ||
          !slotProfessorPhoneDigits ||
          slotProfessorPhoneDigits === leadAssignedProfessorPhoneDigits
        ) {
          return true;
        }
      }
      return false;
    };

    const recurringSlots = await buildRecurringGroupClassSlotsForLead({
      admin,
      lead: lead as Record<string, unknown>,
      settings,
      now: new Date(),
      lookAheadDays: 56,
    });
    const experimentalSlots = await buildExperimentalGroupClassSlotsForLead({
      admin,
      lead: lead as Record<string, unknown>,
      settings,
      now: new Date(),
      lookAheadDays: 56,
      excludeLeadIdFromIndividualBookings: true,
    });
    const rawSlots = [...experimentalSlots, ...recurringSlots];
    let slots =
      leadHasExperimentalAssignment
        ? rawSlots.map((slot) => {
            if (!matchesLeadExperimentalAssignment(slot)) return slot;
            const capacity = Math.max(1, Number(slot.capacity ?? 1));
            const occupiedSeats = Math.max(1, Number(slot.occupied_seats ?? 0));
            return {
              ...slot,
              occupied_seats: occupiedSeats,
              available_seats: Math.max(capacity - occupiedSeats, 0),
              is_current_lead_assigned: true,
              is_full: false,
              status: slot.status === "draft" ? leadAssignedExperimentalStatus : slot.status,
            };
          })
        : rawSlots;

    let currentAssignedSlot =
      slots.find((slot) => slot.is_current_lead_assigned) ??
      (leadHasExperimentalAssignment
        ? slots.find((slot) => matchesLeadExperimentalAssignment(slot)) ?? null
        : null);

    if (!currentAssignedSlot && leadHasExperimentalAssignment && leadAssignedExperimentalGroupId) {
      const { data: assignedGroupClass, error: assignedGroupClassError } = await admin
        .from("atendimento_experimental_group_classes")
        .select(
          "id, professor_name, professor_phone, professor_timezone, professor_weekday, professor_date, professor_time, professor_start_at, capacity, status, confirmed_at, attendance_status, attendance_checked_at, lesson_link",
        )
        .eq("id", leadAssignedExperimentalGroupId)
        .maybeSingle();

      if (!assignedGroupClassError && assignedGroupClass?.id) {
        const { count: assignedMembersCount } = await admin
          .from("atendimento_experimental_group_class_members")
          .select("id", { count: "exact", head: true })
          .eq("group_class_id", leadAssignedExperimentalGroupId)
          .eq("status", "assigned");

        const capacity = Math.max(1, Math.min(4, Number((assignedGroupClass as any)?.capacity ?? 4)));
        const occupiedSeats = Math.max(1, Number(assignedMembersCount ?? 0));
        const professorTimeZone =
          String((assignedGroupClass as any)?.professor_timezone ?? "").trim() || "America/Cuiaba";
        const professorWeekday =
          String((assignedGroupClass as any)?.professor_weekday ?? "").trim().toLowerCase() || "mon";
        const professorDate = String((assignedGroupClass as any)?.professor_date ?? "").trim();
        const professorTime = String((assignedGroupClass as any)?.professor_time ?? "").trim();
        const pairId =
          resolveExperimentalGroupPairIdForClass({
            settings,
            groupClass: assignedGroupClass as any,
          }) || `assigned-${leadAssignedExperimentalGroupId}`;
        const pairName =
          settings.slots.find(
            (slot) =>
              String(slot.pair_id ?? "").trim() === pairId &&
              String(slot.slot_type ?? "").trim().toLowerCase() === "experimental",
          )?.pair_name ??
          settings.slots.find((slot) => String(slot.pair_id ?? "").trim() === pairId)?.pair_name ??
          null;
        const pairCategory: "experimental" | "recorrente" =
          String(
            settings.slots.find((slot) => String(slot.pair_id ?? "").trim() === pairId)
              ?.pair_category ?? "",
          )
            .trim()
            .toLowerCase() === "recorrente"
            ? "recorrente"
            : "experimental";
        const assignedSlot = {
          id: String((assignedGroupClass as any)?.id ?? "").trim() || leadAssignedExperimentalGroupId,
          group_class_id: leadAssignedExperimentalGroupId,
          pair_id: pairId,
          pair_name: String(pairName ?? "").trim() || null,
          pair_category: pairCategory,
          slot_type: "experimental" as const,
          professor_name: String((assignedGroupClass as any)?.professor_name ?? "").trim() || null,
          professor_phone: String((assignedGroupClass as any)?.professor_phone ?? "").trim() || null,
          professor_timezone: professorTimeZone,
          professor_weekday: professorWeekday as any,
          professor_weekday_label: experimentalGroupWeekdayLabel(professorWeekday as any),
          professor_date: professorDate,
          professor_time: professorTime,
          professor_start_at: String((assignedGroupClass as any)?.professor_start_at ?? "").trim(),
          lead_timezone: professorTimeZone,
          lead_date:
            String((lead as any)?.experimental_class_lead_date ?? "").trim() ||
            professorDate,
          lead_time:
            String((lead as any)?.experimental_class_lead_time ?? "").trim() ||
            professorTime,
          capacity,
          occupied_seats: occupiedSeats,
          available_seats: Math.max(capacity - occupiedSeats, 0),
          status:
            String((assignedGroupClass as any)?.status ?? "").trim().toLowerCase() ||
            leadAssignedExperimentalStatus ||
            "assigned",
          lesson_link: String((assignedGroupClass as any)?.lesson_link ?? "").trim() || null,
          confirmed_at: String((assignedGroupClass as any)?.confirmed_at ?? "").trim() || null,
          members: [],
          is_full: false,
          is_current_lead_assigned: true,
        };
        slots = [
          assignedSlot,
          ...slots.filter(
            (slot) =>
              !(
                slot.slot_type === "experimental" &&
                String(slot.group_class_id ?? "").trim() === leadAssignedExperimentalGroupId
              ),
          ),
        ];
        currentAssignedSlot = assignedSlot;
      }
    }

    const reasons: string[] = [];
    if (!settings.enabled) reasons.push("feature_disabled");
    if (!hasPhone) reasons.push("missing_valid_phone");
    return Response.json({
      ok: true,
      lead_slot_type: isStudentLead ? "recorrente" : "experimental",
      settings,
      settings_updated_at: updatedAt,
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
