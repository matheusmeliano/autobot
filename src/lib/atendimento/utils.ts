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

export function normalizePhoneDigits(value: unknown): string {
  return String(value ?? "").replace(/\D+/g, "");
}

export function normalizeNameForSearch(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = new Array(b.length + 1).fill(0);
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    prev.splice(0, prev.length, ...curr);
  }
  return prev[b.length];
}

export function suggestClosestName(
  searchQuery: string,
  candidates: Array<{ id: string; full_name: string | null | undefined }>,
  options?: { minSimilarity?: number; maxSuggestions?: number },
): Array<{ id: string; name: string }> {
  const safeQuery = normalizeNameForSearch(searchQuery);
  if (safeQuery.length < 3) return [];
  const minSimilarity = options?.minSimilarity ?? 0.7;
  const maxSuggestions = options?.maxSuggestions ?? 2;
  const scored: Array<{ id: string; name: string; score: number }> = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const name = String(candidate.full_name ?? "").trim();
    if (!name) continue;
    const key = `${candidate.id}::${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const normName = normalizeNameForSearch(name);
    if (!normName) continue;
    let best = 0;
    const queryTokens = safeQuery.split(/\s+/).filter(Boolean);
    const nameTokens = normName.split(/\s+/).filter(Boolean);
    const queryLen = safeQuery.length;
    const nameLen = normName.length;
    const maxLen = Math.max(queryLen, nameLen);
    const wholeDistance = levenshteinDistance(safeQuery, normName);
    const wholeSim = maxLen === 0 ? 0 : 1 - wholeDistance / maxLen;
    best = Math.max(best, wholeSim);
    if (safeQuery.length >= 4 && normName.includes(safeQuery)) best = Math.max(best, 0.95);
    if (nameLen >= 4 && safeQuery.startsWith(normName)) best = Math.max(best, 0.95);
    if (queryTokens.length && nameTokens.length) {
      let tokenMatches = 0;
      for (const qt of queryTokens) {
        if (qt.length < 3) continue;
        for (const nt of nameTokens) {
          const tokMax = Math.max(qt.length, nt.length);
          const tokDist = levenshteinDistance(qt, nt);
          const tokSim = tokMax === 0 ? 0 : 1 - tokDist / tokMax;
          if (tokSim >= 0.78) {
            tokenMatches++;
            best = Math.max(best, tokSim);
            break;
          }
        }
      }
      if (tokenMatches === queryTokens.filter((t) => t.length >= 3).length && queryTokens.length) {
        best = Math.max(best, 0.93);
      }
    }
    if (best >= minSimilarity) {
      scored.push({ id: candidate.id, name, score: best });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxSuggestions).map(({ id, name }) => ({ id, name }));
}

export function leadMatchesSearchQuery(
  lead: { full_name?: string | null; phone?: string | null },
  rawQuery: string,
): boolean {
  const q = String(rawQuery ?? "").trim();
  if (!q) return true;
  const phoneQ = normalizePhoneDigits(q);
  const nameQ = normalizeNameForSearch(q);

  if (phoneQ.length >= 2) {
    const leadPhone = normalizePhoneDigits(lead.phone);
    if (leadPhone && (leadPhone.includes(phoneQ) || phoneQ.includes(leadPhone))) {
      return true;
    }
  }

  const name = normalizeNameForSearch(lead.full_name);
  if (nameQ) {
    if (name && name.includes(nameQ)) return true;
    const qTokens = nameQ.split(/\s+/).filter(Boolean);
    const nameTokens = name.split(/\s+/).filter(Boolean);
    if (qTokens.length && nameTokens.length) {
      const every = qTokens.every((qt) => nameTokens.some((nt) => nt.includes(qt) || qt.includes(nt)));
      if (every) return true;
    }
  }

  return false;
}
