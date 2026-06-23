export type ChargeTemplateChoice = {
  id: string;
  nome?: string | null;
  created_at?: string | null;
};

const OVERDUE_KEYWORDS = ["atras", "vencid", "overdue"];
const PENDING_KEYWORDS = ["pendente", "inicial", "primeira"];
const TEMPLATE_STOP_WORDS = new Set(["de", "da", "do", "das", "dos", "e", "em", "para", "com"]);

export function normalizeTemplateMatchValue(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeTemplateToken(token: string) {
  const trimmed = token.trim();
  if (!trimmed) return "";
  if (trimmed.length > 4) return trimmed.replace(/s$/g, "");
  return trimmed;
}

function tokenizeTemplateMatchValue(value: string | null | undefined) {
  return normalizeTemplateMatchValue(value)
    .split(" ")
    .map(normalizeTemplateToken)
    .filter((token) => token.length >= 3 && !TEMPLATE_STOP_WORDS.has(token));
}

function countSharedTemplateTokens(templateName: string | null | undefined, debtorHint: string | null | undefined) {
  const templateTokens = new Set(tokenizeTemplateMatchValue(templateName));
  if (!templateTokens.size) return 0;

  let shared = 0;
  for (const token of tokenizeTemplateMatchValue(debtorHint)) {
    if (templateTokens.has(token)) shared += 1;
  }
  return shared;
}

function isOverdueTemplateName(value: string | null | undefined) {
  const normalized = normalizeTemplateMatchValue(value);
  return OVERDUE_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function scorePendingTemplateMatch(templateName: string | null | undefined, debtorHint: string | null | undefined) {
  const normalizedTemplateName = normalizeTemplateMatchValue(templateName);
  const normalizedDebtorHint = normalizeTemplateMatchValue(debtorHint);
  if (!normalizedTemplateName || !normalizedDebtorHint) return -1;
  if (isOverdueTemplateName(normalizedTemplateName)) return -1;

  let score = 0;
  if (normalizedDebtorHint === normalizedTemplateName) {
    score += 1000;
  } else if (
    normalizedDebtorHint.includes(normalizedTemplateName) ||
    normalizedTemplateName.includes(normalizedDebtorHint)
  ) {
    score += 700;
  }

  const sharedTokens = countSharedTemplateTokens(normalizedTemplateName, normalizedDebtorHint);
  if (!score && sharedTokens === 0) return -1;

  return score + sharedTokens * 100 + normalizedTemplateName.length;
}

function findTemplateByKeywords(
  templates: ChargeTemplateChoice[],
  keywords: string[],
  excludeIds = new Set<string>(),
) {
  return (
    templates.find((template) => {
      const id = String(template.id ?? "");
      if (!id || excludeIds.has(id)) return false;
      const normalizedName = normalizeTemplateMatchValue(template.nome);
      return keywords.some((keyword) => normalizedName.includes(keyword));
    }) ?? null
  );
}

export function resolveAutoChargeTemplates(
  templates: ChargeTemplateChoice[],
  debtorHint?: string | null,
) {
  if (!templates.length) {
    return {
      pendingId: null,
      pendingNome: null,
      overdueId: null,
      overdueNome: null,
    };
  }

  const sorted = [...templates].sort((a, b) =>
    String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")),
  );

  const pendingByDebtorHint = sorted.reduce<ChargeTemplateChoice | null>((best, template) => {
    const id = String(template.id ?? "");
    if (!id) return best;

    const currentScore = scorePendingTemplateMatch(template.nome, debtorHint);
    if (currentScore < 0) return best;

    const bestScore = best ? scorePendingTemplateMatch(best.nome, debtorHint) : -1;
    if (currentScore > bestScore) return template;
    return best;
  }, null);

  const pending =
    pendingByDebtorHint ??
    findTemplateByKeywords(sorted, PENDING_KEYWORDS) ??
    sorted[0] ??
    null;
  const overdue =
    findTemplateByKeywords(sorted, OVERDUE_KEYWORDS, new Set([String(pending?.id ?? "")])) ??
    sorted.find((template) => String(template.id ?? "") !== String(pending?.id ?? "")) ??
    pending;

  return {
    pendingId: pending?.id ? String(pending.id) : null,
    pendingNome: pending?.nome ? String(pending.nome) : null,
    overdueId: overdue?.id ? String(overdue.id) : pending?.id ? String(pending.id) : null,
    overdueNome: overdue?.nome ? String(overdue.nome) : pending?.nome ? String(pending.nome) : null,
  };
}
