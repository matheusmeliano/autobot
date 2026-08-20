export const GLOBAL_ADMIN_EMAIL = "heybrotherscolaboradores@gmail.com";

const PROTECTED_EMAILS = new Set<string>([
  GLOBAL_ADMIN_EMAIL.toLowerCase(),
  "atendimento.usa.music@gmail.com".toLowerCase(),
]);

export function isGlobalAdminEmail(email?: string | null) {
  return (email ?? "").toLowerCase() === GLOBAL_ADMIN_EMAIL;
}

export function isProtectedAdminOrUserEmail(email?: string | null) {
  return PROTECTED_EMAILS.has((email ?? "").toLowerCase());
}
