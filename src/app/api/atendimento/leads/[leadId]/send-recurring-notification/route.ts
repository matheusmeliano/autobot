import { appendHistoryEvent, requireAtendimentoUser, sendAtendimentoWhatsAppText } from "@/lib/atendimento/server";
import { buildRecurringClassAttendantStartReminderWhatsAppMessage, buildRecurringClassRegisteredAttendantStartReminderWhatsAppMessage, buildRecurringClassStudentLessonReadyWhatsAppMessage, EXPERIMENTAL_CLASS_ATTENDANT_NOTIFICATION_PHONE, EXPERIMENTAL_CLASS_REGISTERED_ATTENDANT_NOTIFICATION_PHONE, RECURRING_WEEKDAY_LABELS_PT_BR, resolveRecurringClassAssignedProfessorPhone } from "@/lib/atendimento/experimentalClass";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function fn(name: string | null | undefined) { const p = String(name ?? "").trim().split(/\s+/).filter(Boolean); return p[0] ?? "Aluno"; }
function fl(name: string | null | undefined) { const c = String(name ?? "").trim(); return c || "Aluno sem identificacao"; }

export async function POST(req: Request, { params }: { params: Promise<{ leadId: string }> }) {
  const auth = await requireAtendimentoUser();
  if (!auth.ok) return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  const { leadId } = await params;
  const lid = String(leadId ?? "").trim();
  if (!lid) return Response.json({ ok: false, error: "missing_lead_id" }, { status: 400 });
  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();
  const cols = ["id","full_name","phone","recurring_class_link","recurring_class_professor_name","recurring_class_professor_phone","recurring_class_weekday","recurring_class_weekday_label"].join(",");
  const { data: lead, error: le } = await admin.from("atendimento_leads").select(cols).eq("id", lid).maybeSingle();
  if (le) return Response.json({ ok: false, error: le.message }, { status: 500 });
  if (!lead) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  const leadName = String((lead as any)?.full_name ?? "").trim();
  const leadPhone = String((lead as any)?.phone ?? "").trim();
  const lessonLink = String((lead as any)?.recurring_class_link ?? "").trim();
  if (!lessonLink) return Response.json({ ok: false, error: "missing_lesson_link" }, { status: 409 });
  const rp = resolveRecurringClassAssignedProfessorPhone({
    flatAssignedPhone: String((lead as any)?.recurring_class_professor_phone ?? "").trim(),
    flatAssignedName: String((lead as any)?.recurring_class_professor_name ?? "").trim(),
  });
  if (!rp || !String(rp?.phone ?? "").trim()) return Response.json({ ok: false, error: "missing_recurring_professor" }, { status: 409 });
  if (!leadPhone) return Response.json({ ok: false, error: "missing_lead_phone" }, { status: 409 });
  const wr = String((lead as any)?.recurring_class_weekday ?? "").trim().toLowerCase();
  const wl = String((lead as any)?.recurring_class_weekday_label ?? "").trim();
  const weekdayLabel = wl || (RECURRING_WEEKDAY_LABELS_PT_BR as Record<string,string>)[wr] || "horario fixo";
  const profPhone = rp?.phone || EXPERIMENTAL_CLASS_ATTENDANT_NOTIFICATION_PHONE;
  let resolvedConversationId: string | null = null;
  try {
    const { data: convs } = await admin
      .from("atendimento_conversations")
      .select("id")
      .eq("lead_id", lid)
      .order("created_at", { ascending: false })
      .limit(1);
    if (convs?.[0]?.id) resolvedConversationId = String(convs[0].id).trim();
  } catch {}
  let sok = false, aok = false, rok = false;
  let serr: string|null = null, aerr: string|null = null, rerr: string|null = null;

  try {
    await sendAtendimentoWhatsAppText({ phone: leadPhone, message: buildRecurringClassStudentLessonReadyWhatsAppMessage(fn(leadName), lessonLink), admin, conversationId: resolvedConversationId, allowNoInbound: true });
    sok = true;
    await appendHistoryEvent({ leadId: lid, conversationId: null, eventType: "recurring_class_student_start_notification_sent_manual", title: "Link aula recorrente disparado manualmente ao aluno", details: { phone: leadPhone, lesson_link: lessonLink, weekday: wr, weekday_label: weekdayLabel, manually_triggered: true, source: "manual_trigger_button", sent_at: nowIso }, actorType: "attendant", actorEmail: auth.user.email });
  } catch (e) { serr = e instanceof Error ? e.message : String(e); await appendHistoryEvent({ leadId: lid, conversationId: null, eventType: "recurring_class_student_start_notification_failed_manual", title: "Falha disparo manual aula recorrente ao aluno", details: { phone: leadPhone, lesson_link: lessonLink, manually_triggered: true, error: serr }, actorType: "attendant", actorEmail: auth.user.email }); }

  try {
    await sendAtendimentoWhatsAppText({ phone: profPhone, message: buildRecurringClassAttendantStartReminderWhatsAppMessage(fl(leadName), weekdayLabel, lessonLink) });
    aok = true;
    await appendHistoryEvent({ leadId: lid, conversationId: null, eventType: "recurring_class_attendant_start_notification_sent_manual", title: "Lembrete aula recorrente disparado manualmente ao professor", details: { phone: profPhone, lesson_link: lessonLink, weekday: wr, weekday_label: weekdayLabel, manually_triggered: true, resolved_professor: rp ? `${rp.name} (${rp.phone})` : null, sent_at: nowIso }, actorType: "attendant", actorEmail: auth.user.email });
  } catch (e) { aerr = e instanceof Error ? e.message : String(e); await appendHistoryEvent({ leadId: lid, conversationId: null, eventType: "recurring_class_attendant_start_notification_failed_manual", title: "Falha disparo manual lembrete aula recorrente professor", details: { phone: profPhone, lesson_link: lessonLink, manually_triggered: true, error: aerr }, actorType: "attendant", actorEmail: auth.user.email }); }

  try {
    await sendAtendimentoWhatsAppText({ phone: EXPERIMENTAL_CLASS_REGISTERED_ATTENDANT_NOTIFICATION_PHONE, message: buildRecurringClassRegisteredAttendantStartReminderWhatsAppMessage(fl(leadName), weekdayLabel, lessonLink) });
    rok = true;
    await appendHistoryEvent({ leadId: lid, conversationId: null, eventType: "recurring_class_registered_attendant_start_notification_sent_manual", title: "Lembrete aula recorrente disparado manualmente atendente cadastrado", details: { phone: EXPERIMENTAL_CLASS_REGISTERED_ATTENDANT_NOTIFICATION_PHONE, lesson_link: lessonLink, weekday: wr, weekday_label: weekdayLabel, manually_triggered: true, sent_at: nowIso }, actorType: "attendant", actorEmail: auth.user.email });
  } catch (e) { rerr = e instanceof Error ? e.message : String(e); await appendHistoryEvent({ leadId: lid, conversationId: null, eventType: "recurring_class_registered_attendant_start_notification_failed_manual", title: "Falha disparo manual lembrete aula recorrente atendente cadastrado", details: { phone: EXPERIMENTAL_CLASS_REGISTERED_ATTENDANT_NOTIFICATION_PHONE, lesson_link: lessonLink, manually_triggered: true, error: rerr }, actorType: "attendant", actorEmail: auth.user.email }); }

  try { await admin.from("atendimento_leads").update({ updated_at: nowIso } as any).eq("id", lid); } catch(_){}
  const allOk = sok && aok;
  const errMsg = allOk ? null : [serr?`aluno: ${serr}`:null, aerr?`atendente: ${aerr}`:null, rerr?`atendente cadastrado: ${rerr}`:null].filter(Boolean).join(" | ") || "Algum destinatário obrigatório não recebeu.";
  return Response.json({ ok: allOk, all_mandatory_sent: allOk, student_notification_sent: sok, student_notification_error: serr, attendant_notification_sent: aok, attendant_notification_error: aerr, registered_attendant_notification_sent: rok, registered_attendant_notification_error: rerr, error: errMsg }, { status: allOk ? 200 : 502 });
}
