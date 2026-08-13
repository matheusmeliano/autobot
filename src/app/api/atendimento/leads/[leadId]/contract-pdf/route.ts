import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  buildContractData,
  buildContractHtml,
  buildContractPdfBytes,
  buildContractFileName,
  formatLocalizedDateSigned,
} from "@/lib/atendimento/contract";
import { ATENDIMENTO_FILES_BUCKET } from "@/lib/atendimento/files";
import type { AtendimentoLead } from "@/lib/atendimento/types";
import { appendHistoryEvent } from "@/lib/atendimento/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = { leadId: string };

async function parseParams(req: Request): Promise<RouteParams> {
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const leadId = parts[4] ?? "";
  return { leadId: String(leadId ?? "").trim() };
}

export async function GET(req: Request) {
  try {
    const admin = createSupabaseAdminClient();
    const { leadId } = await parseParams(req);
    if (!leadId) {
      return NextResponse.json({ ok: false, error: "leadId obrigatório." }, { status: 400 });
    }

    const { data: lead, error } = await admin
      .from("atendimento_leads")
      .select("*")
      .eq("id", leadId)
      .limit(1)
      .maybeSingle();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    if (!lead) return NextResponse.json({ ok: false, error: "Lead não encontrado." }, { status: 404 });

    const signedAtOverride = (lead as any).contract_signed_at ?? new Date().toISOString();
    const contractData = buildContractData({
      lead: lead as Partial<AtendimentoLead>,
      overrideSignedAtIso: signedAtOverride,
    });

    const urlObj = new URL(req.url);
    const format = String(urlObj.searchParams.get("format") ?? "pdf").toLowerCase();
    if (format === "html") {
      return new NextResponse(buildContractHtml(contractData), {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": `inline; filename="${buildContractFileName(lead as any).replace(/\.pdf$/, ".html")}"`,
        },
      });
    }

    const bytes = await buildContractPdfBytes(contractData);
    const fileName = buildContractFileName(lead as any);
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const admin = createSupabaseAdminClient();
    const { leadId } = await parseParams(req);
    if (!leadId) {
      return NextResponse.json({ ok: false, error: "leadId obrigatório." }, { status: 400 });
    }
    const { data: lead, error: leadErr } = await admin
      .from("atendimento_leads")
      .select("*")
      .eq("id", leadId)
      .limit(1)
      .maybeSingle();
    if (leadErr) return NextResponse.json({ ok: false, error: leadErr.message }, { status: 500 });
    if (!lead) return NextResponse.json({ ok: false, error: "Lead não encontrado." }, { status: 404 });

    const signedAt = new Date().toISOString();
    const contractData = buildContractData({
      lead: lead as Partial<AtendimentoLead>,
      overrideSignedAtIso: signedAt,
    });
    const htmlSnapshot = buildContractHtml(contractData);
    const pdfBytes = await buildContractPdfBytes(contractData);
    const fileName = buildContractFileName(lead as any);
    const storagePath = `atendimento/contratos/${String((lead as any).id ?? leadId).slice(0, 12)}_${fileName}`;

    const { data: uploadData, error: uploadErr } = await admin.storage
      .from(ATENDIMENTO_FILES_BUCKET)
      .upload(storagePath, Buffer.from(pdfBytes), {
        contentType: "application/pdf",
        upsert: true,
      });
    if (uploadErr) return NextResponse.json({ ok: false, error: uploadErr.message }, { status: 500 });

    const { data: publicUrlData } = admin.storage
      .from(ATENDIMENTO_FILES_BUCKET)
      .getPublicUrl(String(uploadData?.path ?? storagePath));
    const publicUrl = String(publicUrlData?.publicUrl ?? "").trim() || null;

    const conversationIdRaw = (lead as any).current_conversation_id ?? null;
    const conversationId = conversationIdRaw
      ? String(conversationIdRaw).trim() || null
      : null;

    const leadPatch: Record<string, unknown> = {
      contract_status: "assinado",
      contract_signed_at: signedAt,
      contract_pdf_url: publicUrl,
      contract_html_snapshot: htmlSnapshot,
      updated_at: signedAt,
    };

    const funnel = String((lead as any).funnel_stage ?? "").trim();
    if (funnel !== "contrato_assinado" && funnel !== "matriculado" && funnel !== "encerrado") {
      leadPatch.funnel_stage = "contrato_assinado";
    }
    const status = String((lead as any).status ?? "").trim();
    if (status !== "contrato_assinado" && status !== "matriculado" && status !== "encerrado") {
      leadPatch.status = "contrato_assinado";
    }

    const { error: updateErr } = await admin
      .from("atendimento_leads")
      .update(leadPatch)
      .eq("id", leadId);
    if (updateErr) return NextResponse.json({ ok: false, error: updateErr.message }, { status: 500 });

    try {
      await appendHistoryEvent({
        leadId,
        conversationId,
        eventType: "contrato_assinado",
        title: "Contrato formalizado e PDF gerado",
        details: {
          contract_pdf_url: publicUrl,
          contract_signed_at: signedAt,
          local_assinatura: formatLocalizedDateSigned(signedAt),
          aluno: contractData.studentFullName,
          aluno_cpf: contractData.studentCPF,
          responsavel: contractData.legalResponsibleName,
          responsavel_cpf: contractData.legalResponsibleCPF,
          assinante: contractData.signedByLabel,
          assinante_cpf: contractData.signedByCPF,
          storage_path: storagePath,
        },
        actorType: "system",
      });
    } catch (_e) {}

    try {
      await admin.from("atendimento_files").insert({
        lead_id: leadId,
        conversation_id: conversationId,
        sender_role: "system",
        content_text: "Contrato de prestação de serviços educacionais – PDF gerado após formalização.",
        media_type: "document",
        media_url: publicUrl,
        mime_type: "application/pdf",
        file_name: fileName,
        file_size_bytes: Number(pdfBytes?.byteLength ?? 0) || null,
      });
    } catch (_e) {}

    return NextResponse.json({
      ok: true,
      signed: true,
      contract_signed_at: signedAt,
      contract_pdf_url: publicUrl,
      contract_html_snapshot: htmlSnapshot,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
