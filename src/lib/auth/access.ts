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

export function getAtendimentoPortalPath() {
  return "/app/atendimento";
}

export function getAtendimentoAccountPath() {
  return "/app/atendimento";
}

export function getAtendimentoFilesPath() {
  return "/app/atendimento";
}

export function isAtendimentoPath(pathname: string) {
  return pathname === "/atendimento" || pathname.startsWith("/atendimento/") || pathname === "/app/atendimento" || pathname.startsWith("/app/atendimento/");
}

export function getDefaultAuthenticatedPath(accessScope: unknown) {
  return isAtendimentoOnlyAccessScope(accessScope) ? getAtendimentoPortalPath() : "/app";
}

export function getSafeAuthenticatedPath(accessScope: unknown, requestedPath: unknown) {
  const normalizedPath = String(requestedPath ?? "").trim();
  const defaultPath = getDefaultAuthenticatedPath(accessScope);
  if (!/^\/(?!\/)/.test(normalizedPath)) {
    return defaultPath;
  }

  if (
    isAtendimentoOnlyAccessScope(accessScope) &&
    (normalizedPath === "/app" ||
      normalizedPath.startsWith("/app/") ||
      normalizedPath === "/admin" ||
      normalizedPath.startsWith("/admin/"))
  ) {
    return defaultPath;
  }

  if (!isAtendimentoOnlyAccessScope(accessScope) && isAtendimentoPath(normalizedPath)) {
    return defaultPath;
  }

  return normalizedPath;
}
