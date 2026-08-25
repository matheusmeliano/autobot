import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAtendimentoUser } from "@/lib/atendimento/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const EXPERIMENTAL_PROFESSOR_ALLOWLIST = [
  { name: "Lucas Brum", phone: "+55 65 9807-9407" },
  { name: "Nathan Camargo", phone: "+55 65 9952-0166" },
];

const STRIP_UNDEFINED_COLUMN__SUSPECT_MISSING_COLS_ALLOWLIST = [
  "experimental_class_status",
  "experimental_class_lead_date",
  "experimental_class_lead_time",
  "experimental_class_professor_date",
  "experimental_class_professor_time",
  "experimental_class_lead_start_at",
  "experimental_class_professor_start_at",
  "recurring_class_professor_name",
  "recurring_class_professor_phone",
] as const;

function extractUndefinedColumnName(raw: unknown): string | null {
  if (!raw) return null;
  const msg = String(raw).toLowerCase();
  const m1 = /column "([^"]+)" does not exist/.exec(msg);
  if (m1 && m1[1]) return m1[1];
  const m2 = /could not find the '([^']+)' column/.exec(msg);
  if (m2 && m2[1]) return m2[1];
  return null;
}

function stripUndefinedColumnFromPatch(
  patchObj: Record<string, unknown>,
  missingColName: string | null,
  suspectAllowlist: ReadonlyArray<string>,
): Record<string, unknown> {
  const next = { ...patchObj };
  if (missingColName && next[missingColName] !== undefined) {
    delete next[missingColName];
    return next;
  }
  for (const sus of suspectAllowlist) {
    if (next[sus] !== undefined) {
      delete next[sus];
      return next;
    }
  }
  return next;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ leadId: string }> }) {
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

    const admin = createSupabaseAdminClient();

    const body = (await req.json().catch(() => null)) as {
      professor_name?: string | null;
      professor_phone?: string | null;
      scope?: "experimental" | "recurring" | "both" | null;
    } | null;
    const professorNameRaw = String(body?.professor_name ?? "").trim();
    const professorPhoneRaw = String(body?.professor_phone ?? "").trim();
    const scope = (() => {
      const raw = String(body?.scope ?? "").trim().toLowerCase();
      if (raw === "experimental" || raw === "recurring") return raw as "experimental" | "recurring";
      return "both";
    })();

    const match = EXPERIMENTAL_PROFESSOR_ALLOWLIST.find(
      (p) => p.phone === professorPhoneRaw && p.name === professorNameRaw,
    );
    if (!match) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Professor inválido. Selecione um dos professores autorizados: Lucas Brum (+55 65 9807-9407) ou Nathan Camargo (+55 65 9952-0166).",
        },
        { status: 400 },
      );
    }

    const { data: leadExists, error: leadErr } = await admin
      .from("atendimento_leads")
      .select("id, experimental_class_booking_id, updated_at")
      .eq("id", safeLeadId)
      .maybeSingle();
    if (leadErr) throw leadErr;
    if (!leadExists) {
      return NextResponse.json({ ok: false, error: "Interessado não encontrado." }, { status: 404 });
    }

    const bookingId = String((leadExists as any)?.experimental_class_booking_id ?? "").trim();
    const updatedAt = new Date().toISOString();

    if (bookingId && (scope === "experimental" || scope === "both")) {
      const { data: existingBooking } = await admin
        .from("atendimento_experimental_class_bookings")
        .select(
          "id, student_start_notification_sent_at, attendant_start_notification_sent_at",
        )
        .eq("id", bookingId)
        .maybeSingle();
      const studentSent =
        Boolean(existingBooking) &&
        Boolean(String((existingBooking as any)?.student_start_notification_sent_at ?? "").trim());
      const attendantSent =
        Boolean(existingBooking) &&
        Boolean(String((existingBooking as any)?.attendant_start_notification_sent_at ?? "").trim());
      if (studentSent || attendantSent) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "Professor não pode ser alterado após o disparo ser realizado.",
          },
          { status: 409 },
        );
      }
    }

    if (bookingId && (scope === "experimental" || scope === "both")) {
      const bookingPatch = {
        assigned_professor_name: match.name,
        assigned_professor_phone: match.phone,
        updated_at: updatedAt,
      };
      const suspectListForBookings = [
        ...STRIP_UNDEFINED_COLUMN__SUSPECT_MISSING_COLS_ALLOWLIST,
        "assigned_professor_name",
        "assigned_professor_phone",
      ];
      try {
        await (async function attemptBooking(currentPatch: Record<string, any>): Promise<{ ok: boolean }> {
          if (!Object.keys(currentPatch).length) return { ok: true };
          const { error } = await admin
            .from("atendimento_experimental_class_bookings")
            .update(currentPatch)
            .eq("id", bookingId);
          if (!error) return { ok: true };
          const missing = extractUndefinedColumnName(error);
          if (!missing) return { ok: true };
          return attemptBooking(stripUndefinedColumnFromPatch(currentPatch, missing, suspectListForBookings));
        })(bookingPatch as Record<string, any>);
      } catch {
      }
    }

    const leadPatch: Record<string, unknown> = {
      updated_at: updatedAt,
    };
    if (scope === "experimental" || scope === "both") {
      leadPatch.experimental_class_professor_name = match.name;
      leadPatch.experimental_class_professor_phone = match.phone;
    }
    if (scope === "recurring" || scope === "both") {
      leadPatch.recurring_class_professor_name = match.name;
      leadPatch.recurring_class_professor_phone = match.phone;
    }
    const suspectListForLeads = [
      ...STRIP_UNDEFINED_COLUMN__SUSPECT_MISSING_COLS_ALLOWLIST,
      "experimental_class_professor_name",
      "experimental_class_professor_phone",
      "recurring_class_professor_name",
      "recurring_class_professor_phone",
    ];
    const selectCols = [
      "id",
      "experimental_class_booking_id",
      "experimental_class_professor_name",
      "experimental_class_professor_phone",
      "recurring_class_professor_name",
      "recurring_class_professor_phone",
      "updated_at",
    ].join(", ");
    const mergedAfterLead = await (async function attemptLead(currentPatch: Record<string, any>): Promise<any> {
      if (!Object.keys(currentPatch).length) return leadExists;
      const { data, error } = await admin
        .from("atendimento_leads")
        .update(currentPatch)
        .eq("id", safeLeadId)
        .select(selectCols)
        .maybeSingle();
      if (!error) return data ?? leadExists;
      const missing = extractUndefinedColumnName(error);
      if (!missing) return leadExists;
      return attemptLead(stripUndefinedColumnFromPatch(currentPatch, missing, suspectListForLeads));
    })(leadPatch as Record<string, any>);

    const persistedName = String(
      scope === "recurring"
        ? (mergedAfterLead as any)?.recurring_class_professor_name ?? match.name
        : (mergedAfterLead as any)?.experimental_class_professor_name ?? match.name,
    ).trim();
    const persistedPhone = String(
      scope === "recurring"
        ? (mergedAfterLead as any)?.recurring_class_professor_phone ?? match.phone
        : (mergedAfterLead as any)?.experimental_class_professor_phone ?? match.phone,
    ).trim();

    return NextResponse.json({
      ok: true,
      assigned_professor: { name: persistedName, phone: persistedPhone },
      lead: mergedAfterLead ?? leadExists,
    });
  } catch (error) {
    console.error("[experimental-booking/assign-professor] error", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Falha ao vincular professor à aula experimental.",
      },
      { status: 500 },
    );
  }
}
