import { ATENDIMENTO_EMAIL, ATENDIMENTO_PUBLIC_LINK_SLUG, STATUS_LABELS, STAGE_LABELS } from "@/lib/atendimento/constants";

export function isAtendimentoEmail(email: unknown) {
  return String(email ?? "").trim().toLowerCase() === ATENDIMENTO_EMAIL;
}

export function atendimentoStageLabel(stage: unknown) {
  return STAGE_LABELS[String(stage ?? "")] ?? "Sem etapa";
}

export function atendimentoStatusLabel(status: unknown) {
  return STATUS_LABELS[String(status ?? "")] ?? "Sem status";
}

export function formatAtendimentoDateTime(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "-";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

export function formatAtendimentoDate(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "-";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00`) : new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(date);
}

export function buildAtendimentoPublicUrl(origin: string) {
  const safeOrigin = origin.replace(/\/$/, "");
  return `${safeOrigin}/atendimento?slug=${encodeURIComponent(ATENDIMENTO_PUBLIC_LINK_SLUG)}`;
}

export function makeConversationSessionSlug() {
  return `lead-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function summarizePreview(text: unknown) {
  const raw = String(text ?? "").trim();
  if (!raw) return "";
  return raw.length > 96 ? `${raw.slice(0, 93)}...` : raw;
}

const LOCATION_LOWERCASE_WORDS = new Set([
  "de",
  "do",
  "da",
  "dos",
  "das",
  "no",
  "na",
  "nos",
  "nas",
  "e",
  "ou",
  "a",
  "o",
  "as",
  "os",
  "ao",
  "à",
  "às",
]);

export function formatAtendimentoLocationName(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "-";
  const words = raw
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => {
      const lower = word.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      if (index > 0 && LOCATION_LOWERCASE_WORDS.has(lower)) {
        return word.toLowerCase();
      }
      const chars = [...word];
      if (chars.length === 0) return word;
      chars[0] = chars[0].toUpperCase();
      return chars.join("");
    });
  return words.join(" ");
}
