import crypto from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const AUTOBOT_FALLBACK_BASE_URL = "https://www.autobot.business";

function normalizeBaseUrl(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withProtocol.replace(/\/$/, "");
}

function getPixLinkBaseUrl() {
  return (
    normalizeBaseUrl(process.env.NEXT_PUBLIC_SITE_URL) ??
    normalizeBaseUrl(process.env.SITE_URL) ??
    normalizeBaseUrl(process.env.NEXT_PUBLIC_APP_URL) ??
    AUTOBOT_FALLBACK_BASE_URL
  );
}

function buildShortPixToken() {
  return crypto.randomBytes(6).toString("base64url");
}

export async function buildPixCopyLink(params: {
  pixKey?: string | null;
  debtorName?: string | null;
  amount?: string | null;
  userId?: string | null;
  debtorId?: string | null;
  scheduleId?: string | null;
}) {
  const pixKey = String(params.pixKey ?? "").trim();
  if (!pixKey) return "";

  const admin = createSupabaseAdminClient();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = buildShortPixToken();
    const { error } = await admin.from("pix_copy_links").insert({
      token,
      pix_key: pixKey,
      debtor_name: String(params.debtorName ?? "").trim() || null,
      amount: String(params.amount ?? "").trim() || null,
      user_id: String(params.userId ?? "").trim() || null,
      debtor_id: String(params.debtorId ?? "").trim() || null,
      schedule_id: String(params.scheduleId ?? "").trim() || null,
    });

    if (!error) {
      return `${getPixLinkBaseUrl()}/pix/${token}`;
    }

    const code = String((error as any)?.code ?? "").trim();
    if (code !== "23505") {
      throw new Error(error.message || "Falha ao gerar link curto do PIX.");
    }
  }

  throw new Error("Falha ao gerar link curto do PIX.");
}

export async function resolvePixCopyLink(token: string) {
  const admin = createSupabaseAdminClient();
  const rawToken = String(token ?? "").trim();
  if (!rawToken) return null;

  const { data, error } = await admin
    .from("pix_copy_links")
    .select("pix_key, debtor_name, amount, created_at")
    .eq("token", rawToken)
    .maybeSingle();

  if (error || !data?.pix_key) return null;

  return {
    pixKey: String(data.pix_key ?? "").trim(),
    debtorName: String(data.debtor_name ?? "").trim() || null,
    amount: String(data.amount ?? "").trim() || null,
    createdAt: String(data.created_at ?? "").trim() || null,
  };
}
