import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { appendHistoryEvent, requireAtendimentoUser } from "@/lib/atendimento/server";
import {
  buildExperimentalGroupClassSlotsForLead,
  buildRecurringGroupClassSlotsForLead,
  loadExperimentalGroupClassSettings,
} from "@/lib/atendimento/experimentalGroupClassServer";
import { resolveLeadTimeZoneFromRecord } from "@/lib/timezone";

export const runtime = "nodejs";

const schema = z.object({
  lead_id: z.string().trim().uuid(),
  group_class_id: z.string().trim().uuid().nullable().optional(),
  professor_start_at: z.string().trim().datetime().optional(),
  pair_id: z.string().trim().min(1).nullable().optional(),
  slot_type: z.enum(["experimental", "recorrente"]).optional(),
});

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

function leadHasName(lead: Record<string, unknown> | null): boolean {
  if (!lead) return false;
  const nameRaw = String((lead as any)?.full_name ?? "").trim();
  return Boolean(nameRaw);
}

function isMissingExperimentalBookingRelation(error: unknown): boolean {
  const code = String((error as any)?.code ?? "").trim();
  const message = String((error as any)?.message ?? "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    /relation .*atendimento_experimental_class_bookings.*does not exist/i.test(message) ||
    /could not find the table .*atendimento_experimental_class_bookings.* in the schema cache/i.test(
      message,
    )
  );
}

function isMissingExperimentalGroupRelation(error: unknown): boolean {
  const code = String((error as any)?.code ?? "").trim();
  const message = String((error as any)?.message ?? "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    code === "42703" ||
    code === "PGRST204" ||
    /relation .*atendimento_experimental_group_(classes|class_members).*does not exist/i.test(
      message,
    ) ||
    /(recurring_class_(group_pair_id|group_status|weekday|weekday_label|professor_name|professor_phone|professor_time|lead_time|professor_timezone|lead_timezone|first_class_at|student_start_notification_sent_at|attendant_start_notification_sent_at))/i.test(
      message,
    ) &&
      /(column .* does not exist|could not find the '.*' column .* in the schema cache|schema cache)/i.test(
        message,
      ) ||
    /could not find the table .*atendimento_experimental_group_(classes|class_members).* in the schema cache/i.test(
      message,
    )
  );
}

function groupSchemaUnavailableResponse() {
  return Response.json(
    {
      ok: false,
      error:
        "As turmas em grupo ainda não estão disponíveis neste ambiente. Atualize a estrutura do banco e recarregue a página.",
    },
    { status: 409 },
  );
}

async function assignLeadToExperimentalGroupDirect(params: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  leadId: string;
  conversationId: string | null;
  targetSlot: {
    professor_name: string | null;
    professor_phone: string | null;
    professor_timezone: string | null;
    professor_weekday: string | null;
    professor_date: string | null;
    professor_time: string | null;
    professor_start_at: string;
    capacity: number;
  };
}) {
  const nowIso = new Date().toISOString();
  const admin = params.admin;
  const slot = params.targetSlot;

  const { data: lead, error: leadError } = await admin
    .from("atendimento_leads")
    .select("id, experimental_class_group_class_id, experimental_class_group_status")
    .eq("id", params.leadId)
    .maybeSingle();

  if (leadError) {
    if (isMissingExperimentalGroupRelation(leadError)) {
      return { ok: false as const, error: "experimental_group_schema_unavailable" };
    }
    return { ok: false as const, error: leadError.message };
  }

  const { data: upsertedGroupClass, error: upsertGroupClassError } = await admin
    .from("atendimento_experimental_group_classes")
    .upsert(
      {
        professor_name: String(slot.professor_name ?? "").trim() || "Professor",
        professor_phone: String(slot.professor_phone ?? "").trim() || "",
        professor_timezone: String(slot.professor_timezone ?? "").trim() || "America/Cuiaba",
        professor_weekday: String(slot.professor_weekday ?? "").trim().toLowerCase() || "mon",
        professor_date: String(slot.professor_date ?? "").trim() || null,
        professor_time: String(slot.professor_time ?? "").trim() || "08:00",
        professor_start_at: slot.professor_start_at,
        capacity: Math.min(4, Math.max(1, Number(slot.capacity ?? 4))),
        status: "draft",
        updated_at: nowIso,
      },
      { onConflict: "professor_start_at" },
    )
    .select("*")
    .single();

  if (upsertGroupClassError) {
    if (isMissingExperimentalGroupRelation(upsertGroupClassError)) {
      return { ok: false as const, error: "experimental_group_schema_unavailable" };
    }
    return { ok: false as const, error: upsertGroupClassError.message };
  }

  const groupClassId = String((upsertedGroupClass as any)?.id ?? "").trim();
  if (!groupClassId) {
    return { ok: false as const, error: "group_class_not_found" };
  }

  const groupStatus = String((upsertedGroupClass as any)?.status ?? "").trim().toLowerCase();
  if (groupStatus === "cancelled" || groupStatus === "completed") {
    const { error: reopenGroupError } = await admin
      .from("atendimento_experimental_group_classes")
      .update({
        status: "draft",
        confirmed_at: null,
        updated_at: nowIso,
      })
      .eq("id", groupClassId);
    if (reopenGroupError) {
      if (isMissingExperimentalGroupRelation(reopenGroupError)) {
        return { ok: false as const, error: "experimental_group_schema_unavailable" };
      }
      return { ok: false as const, error: reopenGroupError.message };
    }
  }

  const currentLeadAssignedGroupClassId =
    String((lead as any)?.experimental_class_group_class_id ?? "").trim() || null;
  const currentLeadAssignedGroupStatus = String(
    (lead as any)?.experimental_class_group_status ?? "",
  )
    .trim()
    .toLowerCase();
  const leadHasCurrentExperimentalGroupAssignment = Boolean(
    currentLeadAssignedGroupClassId && currentLeadAssignedGroupStatus !== "removed",
  );

  const { data: existingOtherGroupMembers, error: existingOtherGroupError } = await admin
    .from("atendimento_experimental_group_class_members")
    .select("id, group_class_id")
    .eq("lead_id", params.leadId)
    .eq("status", "assigned")
    .neq("group_class_id", groupClassId)
    .order("updated_at", { ascending: false });

  if (existingOtherGroupError) {
    if (isMissingExperimentalGroupRelation(existingOtherGroupError)) {
      return { ok: false as const, error: "experimental_group_schema_unavailable" };
    }
    return { ok: false as const, error: existingOtherGroupError.message };
  }

  const assignedOtherMembers = Array.isArray(existingOtherGroupMembers)
    ? existingOtherGroupMembers.filter((row) => String((row as any)?.group_class_id ?? "").trim())
    : [];

  if (assignedOtherMembers.length > 0) {
    if (
      leadHasCurrentExperimentalGroupAssignment &&
      currentLeadAssignedGroupClassId !== groupClassId
    ) {
      return { ok: false as const, error: "lead_already_assigned_to_other_group" };
    }

    const staleMemberIds = assignedOtherMembers
      .map((row) => String((row as any)?.id ?? "").trim())
      .filter(Boolean);
    if (staleMemberIds.length > 0) {
      const { error: clearStaleMembersError } = await admin
        .from("atendimento_experimental_group_class_members")
        .update({
          status: "removed",
          updated_at: nowIso,
        })
        .in("id", staleMemberIds);
      if (clearStaleMembersError) {
        if (isMissingExperimentalGroupRelation(clearStaleMembersError)) {
          return { ok: false as const, error: "experimental_group_schema_unavailable" };
        }
        return { ok: false as const, error: clearStaleMembersError.message };
      }
    }
  }

  const { data: existingMember, error: existingMemberError } = await admin
    .from("atendimento_experimental_group_class_members")
    .select("id")
    .eq("group_class_id", groupClassId)
    .eq("lead_id", params.leadId)
    .eq("status", "assigned")
    .limit(1)
    .maybeSingle();

  if (existingMemberError) {
    if (isMissingExperimentalGroupRelation(existingMemberError)) {
      return { ok: false as const, error: "experimental_group_schema_unavailable" };
    }
    return { ok: false as const, error: existingMemberError.message };
  }

  const { count: occupiedBefore, error: occupiedBeforeError } = await admin
    .from("atendimento_experimental_group_class_members")
    .select("id", { count: "exact", head: true })
    .eq("group_class_id", groupClassId)
    .eq("status", "assigned");

  if (occupiedBeforeError) {
    if (isMissingExperimentalGroupRelation(occupiedBeforeError)) {
      return { ok: false as const, error: "experimental_group_schema_unavailable" };
    }
    return { ok: false as const, error: occupiedBeforeError.message };
  }

  const capacity = Math.min(
    4,
    Math.max(1, Number((upsertedGroupClass as any)?.capacity ?? slot.capacity ?? 4)),
  );
  const alreadyAssigned = Boolean(existingMember?.id);
  if (!alreadyAssigned && Number(occupiedBefore ?? 0) >= capacity) {
    return { ok: false as const, error: "group_class_full" };
  }

  const { data: assignedMember, error: assignMemberError } = await admin
    .from("atendimento_experimental_group_class_members")
    .upsert(
      {
        group_class_id: groupClassId,
        lead_id: params.leadId,
        conversation_id: params.conversationId,
        status: "assigned",
        assigned_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: "group_class_id,lead_id" },
    )
    .select("id")
    .single();

  if (assignMemberError) {
    if (isMissingExperimentalGroupRelation(assignMemberError)) {
      return { ok: false as const, error: "experimental_group_schema_unavailable" };
    }
    const message = String(assignMemberError.message ?? "");
    if (
      /atendimento_experimental_group_class_members_active_lead_key/i.test(message) ||
      /duplicate key value violates unique constraint/i.test(message)
    ) {
      return { ok: false as const, error: "lead_already_assigned_to_other_group" };
    }
    return { ok: false as const, error: assignMemberError.message };
  }

  const { count: occupiedAfter, error: occupiedAfterError } = await admin
    .from("atendimento_experimental_group_class_members")
    .select("id", { count: "exact", head: true })
    .eq("group_class_id", groupClassId)
    .eq("status", "assigned");

  if (occupiedAfterError) {
    if (isMissingExperimentalGroupRelation(occupiedAfterError)) {
      return { ok: false as const, error: "experimental_group_schema_unavailable" };
    }
    return { ok: false as const, error: occupiedAfterError.message };
  }

  const { error: touchGroupError } = await admin
    .from("atendimento_experimental_group_classes")
    .update({ updated_at: nowIso })
    .eq("id", groupClassId);
  if (touchGroupError && isMissingExperimentalGroupRelation(touchGroupError)) {
    return { ok: false as const, error: "experimental_group_schema_unavailable" };
  }

  return {
    ok: true as const,
    group_class_id: groupClassId,
    member_id: String((assignedMember as any)?.id ?? "").trim() || null,
    occupied_seats: Number(occupiedAfter ?? occupiedBefore ?? 0),
    available_seats: Math.max(capacity - Number(occupiedAfter ?? occupiedBefore ?? 0), 0),
  };
}

export async function POST(req: Request) {
  try {
    const auth = await requireAtendimentoUser();
    if (!auth.ok) {
      return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ ok: false, error: "invalid_payload" }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();
    const leadId = parsed.data.lead_id;
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
    if (!leadHasName(lead as any)) {
      return Response.json(
        {
          ok: false,
          error: "Para atribuir uma turma a este registro, informe primeiro o nome.",
        },
        { status: 409 },
      );
    }
    if (!leadHasStateAndCity(lead as any)) {
      return Response.json(
        {
          ok: false,
          error: "Para atribuir uma turma a este registro, informe primeiro o estado e a cidade.",
        },
        { status: 409 },
      );
    }

    const { settings } = await loadExperimentalGroupClassSettings({ admin });
    if (!settings.enabled) {
      return Response.json(
        { ok: false, error: "A funcionalidade de aulas experimentais em grupo está desativada." },
        { status: 409 },
      );
    }

    const isStudentLead = isLeadRecurringStudent(lead as any);
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
          lookAheadDays: 56,
          excludeLeadIdFromIndividualBookings: true,
        });

    const targetSlot =
      slots.find(
        (slot) =>
          (parsed.data.slot_type === "recorrente" &&
            parsed.data.pair_id &&
            String(slot.pair_id ?? "").trim() === parsed.data.pair_id) ||
          (parsed.data.group_class_id &&
            String(slot.group_class_id ?? "").trim() === parsed.data.group_class_id) ||
          (parsed.data.professor_start_at &&
            String(slot.professor_start_at ?? "").trim() === parsed.data.professor_start_at),
      ) ?? null;

    if (!targetSlot) {
      return Response.json(
        { ok: false, error: "A turma selecionada não está mais disponível." },
        { status: 409 },
      );
    }
    const expectedSlotType = isStudentLead ? "recorrente" : "experimental";
    if (targetSlot.slot_type !== expectedSlotType) {
      return Response.json(
        { ok: false, error: "Este registro só pode ser atribuído ao tipo de turma correspondente." },
        { status: 409 },
      );
    }

    if (targetSlot.is_full && !targetSlot.is_current_lead_assigned) {
      return Response.json(
        { ok: false, error: "A turma selecionada já está completa." },
        { status: 409 },
      );
    }

    const { data: latestConversation } = await admin
      .from("atendimento_conversations")
      .select("id")
      .eq("lead_id", leadId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nowIso = new Date().toISOString();
    if (isStudentLead || targetSlot.slot_type === "recorrente") {
      const leadTimeZone = resolveLeadTimeZoneFromRecord({
        lead: lead as Record<string, unknown>,
        fallbackTimeZone:
          String((lead as any)?.recurring_class_lead_timezone ?? (lead as any)?.timezone ?? "").trim() ||
          targetSlot.lead_timezone ||
          targetSlot.professor_timezone,
      });
      const currentRecurringStatus = String((lead as any)?.recurring_class_status ?? "").trim();
      const { data: updatedRecurringLead, error: updateRecurringLeadError } = await admin
        .from("atendimento_leads")
        .update({
          recurring_class_group_pair_id: String(targetSlot.pair_id ?? "").trim() || null,
          recurring_class_group_status: "assigned",
          recurring_class_status: currentRecurringStatus || "confirmado",
          recurring_class_professor_name: targetSlot.professor_name,
          recurring_class_professor_phone: targetSlot.professor_phone,
          recurring_class_weekday: targetSlot.professor_weekday,
          recurring_class_weekday_label: targetSlot.professor_weekday_label,
          recurring_class_professor_time: targetSlot.professor_time,
          recurring_class_lead_time: targetSlot.lead_time || targetSlot.professor_time,
          recurring_class_professor_timezone: targetSlot.professor_timezone,
          recurring_class_lead_timezone: leadTimeZone,
          recurring_class_first_class_at: targetSlot.professor_start_at,
          recurring_class_student_start_notification_sent_at: null,
          recurring_class_attendant_start_notification_sent_at: null,
          updated_at: nowIso,
        })
        .eq("id", leadId)
        .select(
          "id, recurring_class_group_pair_id, recurring_class_group_status, recurring_class_status, recurring_class_weekday, recurring_class_professor_time",
        )
        .maybeSingle();
      if (updateRecurringLeadError) {
        return Response.json(
          {
            ok: false,
            error: updateRecurringLeadError.message,
          },
          { status: 500 },
        );
      }
      if (!updatedRecurringLead?.id) {
        return Response.json(
          {
            ok: false,
            error: "Não foi possível atualizar o aluno para a turma recorrente selecionada.",
          },
          { status: 404 },
        );
      }
      if (
        String((updatedRecurringLead as any)?.recurring_class_group_pair_id ?? "").trim() !==
          String(targetSlot.pair_id ?? "").trim() ||
        String((updatedRecurringLead as any)?.recurring_class_group_status ?? "")
          .trim()
          .toLowerCase() !== "assigned"
      ) {
        return Response.json(
          {
            ok: false,
            error: "A turma recorrente não pôde ser vinculada ao aluno.",
          },
          { status: 409 },
        );
      }

      await appendHistoryEvent({
        leadId,
        conversationId: String((latestConversation as any)?.id ?? "").trim() || null,
        eventType: "recurring_group_class_assigned",
        title: "Aluno atribuído a uma turma recorrente em grupo",
        details: {
          pair_id: String(targetSlot.pair_id ?? "").trim() || null,
          professor_name: targetSlot.professor_name,
          professor_phone: targetSlot.professor_phone,
          professor_weekday: targetSlot.professor_weekday,
          professor_time: targetSlot.professor_time,
          professor_start_at: targetSlot.professor_start_at,
        },
        actorType: "attendant",
        actorEmail: auth.user.email,
      });

      return Response.json({
        ok: true,
        pair_id: String(targetSlot.pair_id ?? "").trim() || null,
      });
    }

    try {
      const { error: cancelBookingError } = await admin
        .from("atendimento_experimental_class_bookings")
        .update({
          status: "cancelled",
          updated_at: nowIso,
        })
        .eq("lead_id", leadId)
        .in("status", ["scheduled", "booked", "confirmed", "in_progress"]);
      if (cancelBookingError && !isMissingExperimentalBookingRelation(cancelBookingError)) {
        return Response.json({ ok: false, error: cancelBookingError.message }, { status: 500 });
      }
    } catch (error) {
      if (!isMissingExperimentalBookingRelation(error)) {
        return Response.json(
          { ok: false, error: String((error as any)?.message ?? error ?? "erro interno") },
          { status: 500 },
        );
      }
    }

    const assignmentResult = await assignLeadToExperimentalGroupDirect({
      admin,
      leadId,
      conversationId: String((latestConversation as any)?.id ?? "").trim() || null,
      targetSlot: {
        professor_name: targetSlot.professor_name,
        professor_phone: targetSlot.professor_phone,
        professor_timezone: targetSlot.professor_timezone,
        professor_weekday: targetSlot.professor_weekday,
        professor_date: targetSlot.professor_date,
        professor_time: targetSlot.professor_time,
        professor_start_at: targetSlot.professor_start_at,
        capacity: targetSlot.capacity,
      },
    });

    if (!assignmentResult.ok) {
      if (assignmentResult.error.includes("experimental_group_schema_unavailable")) {
        return groupSchemaUnavailableResponse();
      }
      if (assignmentResult.error.includes("group_class_full")) {
        return Response.json(
          { ok: false, error: "A turma selecionada acabou de ficar lotada." },
          { status: 409 },
        );
      }
      if (assignmentResult.error.includes("lead_already_assigned_to_other_group")) {
        return Response.json(
          { ok: false, error: "Este registro já está atribuído a outra turma." },
          { status: 409 },
        );
      }
      return Response.json({ ok: false, error: assignmentResult.error }, { status: 500 });
    }

    const groupClassId = String(assignmentResult.group_class_id ?? "").trim();
    const leadUpdatePayload = {
      experimental_class_mode_preference: "group",
      experimental_class_group_interest: true,
      experimental_class_group_interest_at:
        String((lead as any)?.experimental_class_group_interest_at ?? "").trim() || nowIso,
      experimental_class_group_class_id: groupClassId || null,
      experimental_class_group_status: "assigned",
      experimental_class_status: "scheduled",
      experimental_class_professor_date: targetSlot.professor_date || null,
      experimental_class_professor_time: targetSlot.professor_time || null,
      experimental_class_professor_start_at: targetSlot.professor_start_at || null,
      experimental_class_lead_date: targetSlot.lead_date || null,
      experimental_class_lead_time: targetSlot.lead_time || targetSlot.professor_time || null,
      experimental_class_lead_start_at: targetSlot.professor_start_at || null,
      experimental_class_professor_name: targetSlot.professor_name,
      experimental_class_professor_phone: targetSlot.professor_phone,
      experimental_class_booking_id: null,
      experimental_class_link: null,
      updated_at: nowIso,
    };
    const { error: updateLeadError } = await admin
      .from("atendimento_leads")
      .update(leadUpdatePayload)
      .eq("id", leadId);
    if (updateLeadError) {
      await admin
        .from("atendimento_experimental_group_class_members")
        .update({
          status: "removed",
          updated_at: nowIso,
        })
        .eq("lead_id", leadId)
        .eq("group_class_id", groupClassId)
        .eq("status", "assigned");
      return Response.json({ ok: false, error: updateLeadError.message }, { status: 500 });
    }

    await appendHistoryEvent({
      leadId,
      conversationId: String((latestConversation as any)?.id ?? "").trim() || null,
      eventType: "experimental_group_class_assigned",
      title: "Registro atribuído a uma turma de aula experimental em grupo",
      details: {
        group_class_id: groupClassId || null,
        professor_name: targetSlot.professor_name,
        professor_phone: targetSlot.professor_phone,
        professor_date: targetSlot.professor_date,
        professor_time: targetSlot.professor_time,
        professor_start_at: targetSlot.professor_start_at,
      },
      actorType: "attendant",
      actorEmail: auth.user.email,
    });

    return Response.json({
      ok: true,
      group_class_id: groupClassId || null,
    });
  } catch (error: any) {
    return Response.json(
      { ok: false, error: String(error?.message ?? error ?? "erro interno") },
      { status: 500 },
    );
  }
}
