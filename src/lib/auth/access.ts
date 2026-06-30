import { ATENDIMENTO_PUBLIC_LINK_SLUG } from "@/lib/atendimento/constants";

export const DEFAULT_ACCESS_SCOPE = "app";
export const ATENDIMENTO_ONLY_ACCESS_SCOPE = "atendimento";

export type AccessScope =
  | typeof DEFAULT_ACCESS_SCOPE
  | typeof ATENDIMENTO_ONLY_ACCESS_SCOPE;

export function normalizeAccessScope(value: unknown): AccessScope {
  return value === ATENDIMENTO_ONLY_ACCESS_SCOPE
    ? ATENDIMENTO_ONLY_ACCESS_SCOPE
    : DEFAULT_ACCESS_SCOPE;
}

export function isAtendimentoOnlyAccessScope(value: unknown) {
  return normalizeAccessScope(value) === ATENDIMENTO_ONLY_ACCESS_SCOPE;
}

export function getAtendimentoPortalPath(slug = ATENDIMENTO_PUBLIC_LINK_SLUG) {
  const safeSlug = String(slug || ATENDIMENTO_PUBLIC_LINK_SLUG).trim() || ATENDIMENTO_PUBLIC_LINK_SLUG;
  return `/atendimento?slug=${encodeURIComponent(safeSlug)}&tab=bot`;
}

export function getDefaultAuthenticatedPath(accessScope: unknown) {
  return isAtendimentoOnlyAccessScope(accessScope) ? getAtendimentoPortalPath() : "/app";
}
