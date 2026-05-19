export function resolveBaseUrlFromHeaders(hdrs: Headers) {
  const origin = hdrs.get("origin");
  const forwardedProto = hdrs.get("x-forwarded-proto");
  const host =
    hdrs.get("x-forwarded-host") ??
    hdrs.get("host") ??
    hdrs.get("x-forwarded-server");

  const envUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.SITE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    null;

  const normalize = (value: string | null) => {
    if (!value) return null;
    const v = value.replace("0.0.0.0", "localhost");
    return v.endsWith("/") ? v.slice(0, -1) : v;
  };

  const isLocal = (value: string | null) => {
    if (!value) return false;
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(value);
  };

  const env = normalize(envUrl);
  const org = normalize(origin);
  const byHost = normalize(host ? `${forwardedProto ?? "http"}://${host}` : null);
  const vercelHost = normalize(
    process.env.VERCEL_PROJECT_PRODUCTION_URL ??
      process.env.VERCEL_URL ??
      null
  );

  const ensureProtocol = (value: string | null) => {
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) return value;
    return `https://${value}`;
  };

  if (org && !isLocal(org)) return org;
  if (byHost && !isLocal(byHost)) return byHost;
  if (env && !isLocal(env)) return env;
  if (vercelHost && !isLocal(ensureProtocol(vercelHost))) {
    return ensureProtocol(vercelHost);
  }

  return (
    env ??
    org ??
    byHost ??
    (vercelHost ? ensureProtocol(vercelHost) : null) ??
    (process.env.NODE_ENV !== "production" ? "http://localhost:3000" : null)
  );
}
