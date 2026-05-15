export const GLOBAL_ADMIN_EMAIL = "heybrotherscolaboradores@gmail.com";

export function isGlobalAdminEmail(email?: string | null) {
  return (email ?? "").toLowerCase() === GLOBAL_ADMIN_EMAIL;
}

