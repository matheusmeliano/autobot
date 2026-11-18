import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  appendHistoryEvent,
  requireAtendimentoUser,
  sendAtendimentoWhatsAppText,
} from "@/lib/atendimento/server";
import {
  buildExperimentalClassStudentLessonReadyWhatsAppMessage,
  buildExperimentalGroupClassAttendantStartReminderWhatsAppMessage,
  buildExperimentalGroupClassRegisteredAttendantStartReminderWhatsAppMessage,
  EXPERIMENTAL_CLASS_ATTENDANT_NOTIFICATION_PHONE,
  EXPERIMENTAL_CLASS_PROFESSOR_ASSIGNMENT_ALLOWLIST,
  EXPERIMENTAL_CLASS_REGISTERED_ATTENDANT_NOTIFICATION_PHONE,
  normalizarExperimentalProfessorParaAllowlist,
  resolveExperimentalClassAssignedProfessorPhone,
} from "@/lib/atendimento/experimentalClass";

export const runtime = "nodejs";

const schema = z.object({
  group_class_id: z.string().trim().uuid(),
  lesson_link: z.string().trim().max(500).nullable().optional(),
});

function getLeadFirstName(name: string | null | undefined) {
  const parts = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts[0] ?? "Aluno";
}

function isMissingExperimentalGroupRelation(error: unknown): boolean {
  const code = String((error as any)?.code ?? "").trim();
  const message = String((error as any)?.message ?? "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    /relation .*atendimento_experimental_group_(classes|class_members).*does not exist/i.test(
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
    const nowIso = new Date().toISOString();
    const groupClassId = parsed.data.group_class_id;

    const { data: groupClass, error: groupClassError } = await admin
      .from("atendimento_experimental_group_classes")
      .select("id, professor_name, professor_phone, professor_start_at, professor_date, professor_time, lesson_link")
      .eq("id", groupClassId)
      .maybeSingle();

    if (groupClassError) {
      if (isMissingExperimentalGroupRelation(groupClassError)) {
        return groupSchemaUnavailableResponse();
      }
      return Response.json({ ok: false, error: groupClassError.message }, { status: 500 });
    }
    if (!groupClass?.id) {
      return Response.json({ ok: false, error: "group_class_not_found" }, { status: 404 });
    }

    const lessonLink = String((groupClass as any)?.lesson_link ?? "").trim();
    if (!lessonLink) {
      return Response.json({ ok: false, error: "missing_lesson_link" }, { status: 409 });
    }

    const { data: members, error: membersError } = await admin
      .from("atendimento_experimental_group_class_members")
      .select("id, lead_id, conversation_id, status")
      .eq("group_class_id", groupClassId)
      .eq("status", "assigned")
      .order("created_at", { ascending: true });

    if (membersError) {
      if (isMissingExperimentalGroupRelation(membersError)) {
        return groupSchemaUnavailableResponse();
      }
      return Response.json({ ok: false, error: membersError.message }, { status: 500 });
    }

    const memberRows = Array.isArray(members) ? (members as any[]) : [];
    if (!memberRows.length) {
      return Response.json(
        { ok: false, error: "A turma precisa ter pelo menos um aluno atribuído." },
        { status: 409 },
      );
    }

    const leadIds = memberRows
      .map((member) => String(member?.lead_id ?? "").trim())
      .filter(Boolean);
    const { data: leads, error: leadsError } = await admin
      .from("atendimento_leads")
      .select("id, full_name, phone, experimental_class_professor_name, experimental_class_professor_phone")
      .in("id", leadIds);

    if (leadsError) {
      return Response.json({ ok: false, error: leadsError.message }, { status: 500 });
    }

    const leadsById = new Map<string, any>();
    for (const lead of leads ?? []) {
      const leadId = String((lead as any)?.id ?? "").trim();
      if (!leadId) continue;
      leadsById.set(leadId, lead);
    }

    const firstLeadWithProfessor =
      (Array.isArray(leads) ? (leads as any[]).find((lead) => {
        return (
          String((lead as any)?.experimental_class_professor_phone ?? "").trim() ||
          String((lead as any)?.experimental_class_professor_name ?? "").trim()
        );
      }) : null) ?? null;

    let resolvedProfessor = resolveExperimentalClassAssignedProfessorPhone({
      bookingAssignedPhone: String((groupClass as any)?.professor_phone ?? "").trim(),
      bookingAssignedName: String((groupClass as any)?.professor_name ?? "").trim(),
      flatAssignedPhone: String((firstLeadWithProfessor as any)?.experimental_class_professor_phone ?? "").trim(),
      flatAssignedName: String((firstLeadWithProfessor as any)?.experimental_class_professor_name ?? "").trim(),
    });
    if (!resolvedProfessor) {
      resolvedProfessor = normalizarExperimentalProfessorParaAllowlist({
        name: String((groupClass as any)?.professor_name ?? "").trim() || null,
        phone: String((groupClass as any)?.professor_phone ?? "").trim() || null,
      });
    }
    if (!resolvedProfessor && EXPERIMENTAL_CLASS_PROFESSOR_ASSIGNMENT_ALLOWLIST.length > 0) {
      resolvedProfessor = {
        name: String(EXPERIMENTAL_CLASS_PROFESSOR_ASSIGNMENT_ALLOWLIST[0].name),
        phone: String(EXPERIMENTAL_CLASS_PROFESSOR_ASSIGNMENT_ALLOWLIST[0].phone),
      };
    }
    if (!resolvedProfessor) {
      resolvedProfessor = {
        name: "Equipe USA Music",
        phone: EXPERIMENTAL_CLASS_ATTENDANT_NOTIFICATION_PHONE,
      };
    }

    const studentNames = memberRows
      .map((member) => {
        const lead = leadsById.get(String(member?.lead_id ?? "").trim());
        return String((lead as any)?.full_name ?? "").trim();
      })
      .filter(Boolean);

    let studentSentCount = 0;
    let studentFailedCount = 0;
    let attendantNotificationSent = false;
    let attendantNotificationError: string | null = null;
    let registeredAttendantNotificationSent = false;
    let registeredAttendantNotificationError: string | null = null;

    for (const member of memberRows) {
      const leadId = String(member?.lead_id ?? "").trim();
      if (!leadId) continue;
      const lead = leadsById.get(leadId);
      const conversationId = String(member?.conversation_id ?? "").trim() || null;
      const leadName = String((lead as any)?.full_name ?? "").trim();
      const leadPhone = String((lead as any)?.phone ?? "").trim();

      if (!leadPhone) {
        studentFailedCount += 1;
        await appendHistoryEvent({
          leadId,
          conversationId,
          eventType: "experimental_group_class_student_start_notification_failed",
          title: "Falha ao disparar manualmente o link da aula experimental em grupo ao aluno",
          details: {
            group_class_id: groupClassId,
            lesson_link: lessonLink,
            error: "missing_lead_phone",
            manually_triggered: true,
          },
          actorType: "attendant",
          actorEmail: auth.user.email,
        });
        continue;
      }

      try {
        await sendAtendimentoWhatsAppText({
          phone: leadPhone,
          message: buildExperimentalClassStudentLessonReadyWhatsAppMessage(
            getLeadFirstName(leadName),
            lessonLink,
          ),
          admin,
          conversationId,
          allowNoInbound: true,
        });
        studentSentCount += 1;
        await admin
          .from("atendimento_experimental_group_class_members")
          .update({
            student_notification_sent_at: nowIso,
          })
          .eq("id", String(member?.id ?? "").trim());
        await admin
          .from("atendimento_leads")
          .update({
            experimental_class_student_notification_sent_at: nowIso,
            updated_at: nowIso,
          })
          .eq("id", leadId);
        await appendHistoryEvent({
          leadId,
          conversationId,
          eventType: "experimental_group_class_student_start_notification_sent",
          title: "Link da aula experimental em grupo disparado manualmente ao aluno",
          details: {
            group_class_id: groupClassId,
            phone: leadPhone,
            lesson_link: lessonLink,
            start_at: String((groupClass as any)?.professor_start_at ?? "").trim() || null,
            manually_triggered: true,
          },
          actorType: "attendant",
          actorEmail: auth.user.email,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        studentFailedCount += 1;
        await appendHistoryEvent({
          leadId,
          conversationId,
          eventType: "experimental_group_class_student_start_notification_failed",
          title: "Falha ao disparar manualmente o link da aula experimental em grupo ao aluno",
          details: {
            group_class_id: groupClassId,
            phone: leadPhone,
            lesson_link: lessonLink,
            start_at: String((groupClass as any)?.professor_start_at ?? "").trim() || null,
            manually_triggered: true,
            error: message,
          },
          actorType: "attendant",
          actorEmail: auth.user.email,
        });
      }
    }

    try {
      await sendAtendimentoWhatsAppText({
        phone: String(resolvedProfessor.phone ?? "").trim() || EXPERIMENTAL_CLASS_ATTENDANT_NOTIFICATION_PHONE,
        message: buildExperimentalGroupClassAttendantStartReminderWhatsAppMessage(studentNames, lessonLink),
      });
      attendantNotificationSent = true;
    } catch (error) {
      attendantNotificationError = error instanceof Error ? error.message : String(error);
    }

    try {
      await sendAtendimentoWhatsAppText({
        phone: EXPERIMENTAL_CLASS_REGISTERED_ATTENDANT_NOTIFICATION_PHONE,
        message: buildExperimentalGroupClassRegisteredAttendantStartReminderWhatsAppMessage(
          studentNames,
          lessonLink,
        ),
      });
      registeredAttendantNotificationSent = true;
    } catch (error) {
      registeredAttendantNotificationError =
        error instanceof Error ? error.message : String(error);
    }

    for (const member of memberRows) {
      const leadId = String(member?.lead_id ?? "").trim();
      const conversationId = String(member?.conversation_id ?? "").trim() || null;
      if (!leadId) continue;

      if (attendantNotificationSent) {
        await admin
          .from("atendimento_leads")
          .update({
            experimental_class_attendant_notification_sent_at: nowIso,
            updated_at: nowIso,
          })
          .eq("id", leadId);
        await appendHistoryEvent({
          leadId,
          conversationId,
          eventType: "experimental_group_class_attendant_start_notification_sent",
          title: "Lembrete de início da aula experimental em grupo disparado manualmente ao professor",
          details: {
            group_class_id: groupClassId,
            phone: String(resolvedProfessor.phone ?? "").trim() || EXPERIMENTAL_CLASS_ATTENDANT_NOTIFICATION_PHONE,
            lesson_link: lessonLink,
            start_at: String((groupClass as any)?.professor_start_at ?? "").trim() || null,
            manually_triggered: true,
            student_names: studentNames,
          },
          actorType: "attendant",
          actorEmail: auth.user.email,
        });
      } else {
        await appendHistoryEvent({
          leadId,
          conversationId,
          eventType: "experimental_group_class_attendant_start_notification_failed",
          title: "Falha ao disparar manualmente o lembrete da aula experimental em grupo ao professor",
          details: {
            group_class_id: groupClassId,
            phone: String(resolvedProfessor.phone ?? "").trim() || EXPERIMENTAL_CLASS_ATTENDANT_NOTIFICATION_PHONE,
            lesson_link: lessonLink,
            start_at: String((groupClass as any)?.professor_start_at ?? "").trim() || null,
            manually_triggered: true,
            student_names: studentNames,
            error: attendantNotificationError,
          },
          actorType: "attendant",
          actorEmail: auth.user.email,
        });
      }

      if (registeredAttendantNotificationSent) {
        await admin
          .from("atendimento_leads")
          .update({
            experimental_class_registered_attendant_notification_sent_at: nowIso,
            updated_at: nowIso,
          })
          .eq("id", leadId);
        await appendHistoryEvent({
          leadId,
          conversationId,
          eventType: "experimental_group_class_registered_attendant_start_notification_sent",
          title: "Lembrete de início da aula experimental em grupo disparado manualmente ao atendente cadastrado",
          details: {
            group_class_id: groupClassId,
            phone: EXPERIMENTAL_CLASS_REGISTERED_ATTENDANT_NOTIFICATION_PHONE,
            lesson_link: lessonLink,
            start_at: String((groupClass as any)?.professor_start_at ?? "").trim() || null,
            manually_triggered: true,
            student_names: studentNames,
          },
          actorType: "attendant",
          actorEmail: auth.user.email,
        });
      } else {
        await appendHistoryEvent({
          leadId,
          conversationId,
          eventType: "experimental_group_class_registered_attendant_start_notification_failed",
          title: "Falha ao disparar manualmente o lembrete da aula experimental em grupo ao atendente cadastrado",
          details: {
            group_class_id: groupClassId,
            phone: EXPERIMENTAL_CLASS_REGISTERED_ATTENDANT_NOTIFICATION_PHONE,
            lesson_link: lessonLink,
            start_at: String((groupClass as any)?.professor_start_at ?? "").trim() || null,
            manually_triggered: true,
            student_names: studentNames,
            error: registeredAttendantNotificationError,
          },
          actorType: "attendant",
          actorEmail: auth.user.email,
        });
      }
    }

    const ok = studentFailedCount === 0 && attendantNotificationSent;
    return Response.json(
      {
        ok,
        student_sent_count: studentSentCount,
        student_failed_count: studentFailedCount,
        attendant_notification_sent: attendantNotificationSent,
        attendant_notification_error: attendantNotificationError,
        registered_attendant_notification_sent: registeredAttendantNotificationSent,
        registered_attendant_notification_error: registeredAttendantNotificationError,
        error: ok
          ? null
          : [
              studentFailedCount > 0 ? `${studentFailedCount} aluno(s) com falha` : null,
              attendantNotificationSent ? null : `professor: ${attendantNotificationError ?? "falha no envio"}`,
            ]
              .filter(Boolean)
              .join(" | "),
      },
      { status: ok ? 200 : 502 },
    );
  } catch (error: any) {
    return Response.json(
      { ok: false, error: String(error?.message ?? error ?? "erro interno") },
      { status: 500 },
    );
  }
}
