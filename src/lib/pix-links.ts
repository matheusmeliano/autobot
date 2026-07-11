import crypto from "node:crypto";

const AUTOBOT_FALLBACK_BASE_URL = "https://www.autobot.business";

type PixLinkPayload = {
  pixKey: string;
  debtorName?: string | null;
  amount?: string | null;
  createdAt: string;
};

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

function getPixLinkSecret() {
  const secret =
    String(process.env.PIX_LINK_SECRET ?? "").trim() ||
    String(process.env.CRON_SECRET ?? "").trim() ||
    String(process.env.ZAPI_WEBHOOK_SECRET ?? "").trim();

  if (secret) return secret;
  if (process.env.NODE_ENV !== "production") return "autobot-dev-pix-link-secret";
  throw new Error("PIX link secret not configured.");
}

function signEncodedPayload(encodedPayload: string) {
  return crypto.createHmac("sha256", getPixLinkSecret()).update(encodedPayload).digest("base64url");
}

export function buildPixCopyLink(params: {
  pixKey?: string | null;
  debtorName?: string | null;
  amount?: string | null;
}) {
  const pixKey = String(params.pixKey ?? "").trim();
  if (!pixKey) return "";

  const payload: PixLinkPayload = {
    pixKey,
    debtorName: String(params.debtorName ?? "").trim() || null,
    amount: String(params.amount ?? "").trim() || null,
    createdAt: new Date().toISOString(),
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = signEncodedPayload(encodedPayload);
  return `${getPixLinkBaseUrl()}/pix/${encodedPayload}.${signature}`;
}

export function parsePixLinkToken(token: string) {
  const raw = String(token ?? "").trim();
  if (!raw) return null;

  const [encodedPayload, signature] = raw.split(".");
  if (!encodedPayload || !signature) return null;

  const expectedSignature = signEncodedPayload(encodedPayload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as PixLinkPayload;
    const pixKey = String(parsed?.pixKey ?? "").trim();
    if (!pixKey) return null;

    return {
      pixKey,
      debtorName: String(parsed?.debtorName ?? "").trim() || null,
      amount: String(parsed?.amount ?? "").trim() || null,
      createdAt: String(parsed?.createdAt ?? "").trim() || null,
    };
  } catch {
    return null;
  }
}
