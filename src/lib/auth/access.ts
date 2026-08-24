import { ATENDIMENTO_PUBLIC_LINK_SLUG } from "@/lib/atendimento/constants";

export const DEFAULT_ACCESS_SCOPE = "app";
export const ATENDIMENTO_ONLY_ACCESS_SCOPE = "atendimento";
export const ALUNO_ONLY_ACCESS_SCOPE = "aluno";

export type AccessScope =
  | typeof DEFAULT_ACCESS_SCOPE
  | typeof ATENDIMENTO_ONLY_ACCESS_SCOPE
  | typeof ALUNO_ONLY_ACCESS_SCOPE;

export function normalizeAccessScope(value: unknown): AccessScope {
  if (value === ATENDIMENTO_ONLY_ACCESS_SCOPE) return ATENDIMENTO_ONLY_ACCESS_SCOPE;
  if (value === ALUNO_ONLY_ACCESS_SCOPE) return ALUNO_ONLY_ACCESS_SCOPE;
  return DEFAULT_ACCESS_SCOPE;
}

export function isAtendimentoOnlyAccessScope(value: unknown) {
  return normalizeAccessScope(value) === ATENDIMENTO_ONLY_ACCESS_SCOPE;
}

export function isAlunoOnlyAccessScope(value: unknown) {
  return normalizeAccessScope(value) === ALUNO_ONLY_ACCESS_SCOPE;
}

export function getAtendimentoPortalPath(slug = ATENDIMENTO_PUBLIC_LINK_SLUG) {
  const safeSlug = String(slug || ATENDIMENTO_PUBLIC_LINK_SLUG).trim() || ATENDIMENTO_PUBLIC_LINK_SLUG;
  return `/atendimento?slug=${encodeURIComponent(safeSlug)}`;
}

export function getAtendimentoAccountPath(slug = ATENDIMENTO_PUBLIC_LINK_SLUG) {
  const safeSlug = String(slug || ATENDIMENTO_PUBLIC_LINK_SLUG).trim() || ATENDIMENTO_PUBLIC_LINK_SLUG;
  return `/atendimento/conta?slug=${encodeURIComponent(safeSlug)}`;
}

export function getAtendimentoFilesPath(slug = ATENDIMENTO_PUBLIC_LINK_SLUG) {
  const safeSlug = String(slug || ATENDIMENTO_PUBLIC_LINK_SLUG).trim() || ATENDIMENTO_PUBLIC_LINK_SLUG;
  return `/atendimento/arquivos?slug=${encodeURIComponent(safeSlug)}`;
}

export function getAlunoPortalPath() {
  return "/aluno";
}

export function isAtendimentoPath(pathname: string) {
  return pathname === "/atendimento" || pathname.startsWith("/atendimento/");
}

export function isAlunoPath(pathname: string) {
  return pathname === "/aluno" || pathname.startsWith("/aluno/");
}

export function getDefaultAuthenticatedPath(accessScope: unknown) {
  if (isAlunoOnlyAccessScope(accessScope)) return getAlunoPortalPath();
  if (isAtendimentoOnlyAccessScope(accessScope)) return getAtendimentoPortalPath();
  return "/app";
}

export function getSafeAuthenticatedPath(accessScope: unknown, requestedPath: unknown) {
  const normalizedPath = String(requestedPath ?? "").trim();
  const defaultPath = getDefaultAuthenticatedPath(accessScope);
  if (!/^\/(?!\/)/.test(normalizedPath)) {
    return defaultPath;
  }

  if (isAlunoOnlyAccessScope(accessScope)) {
    if (
      normalizedPath === "/app" ||
      normalizedPath.startsWith("/app/") ||
      normalizedPath === "/admin" ||
      normalizedPath.startsWith("/admin/") ||
      isAtendimentoPath(normalizedPath)
    ) {
      return defaultPath;
    }
  }

  if (
    isAtendimentoOnlyAccessScope(accessScope) &&
    (normalizedPath === "/app" ||
      normalizedPath.startsWith("/app/") ||
      normalizedPath === "/admin" ||
      normalizedPath.startsWith("/admin/") ||
      isAlunoPath(normalizedPath))
  ) {
    return defaultPath;
  }

  if (!isAtendimentoOnlyAccessScope(accessScope) && !isAlunoOnlyAccessScope(accessScope) && isAtendimentoPath(normalizedPath)) {
    return defaultPath;
  }

  if (!isAtendimentoOnlyAccessScope(accessScope) && !isAlunoOnlyAccessScope(accessScope) && isAlunoPath(normalizedPath)) {
    return defaultPath;
  }

  return normalizedPath;
}
