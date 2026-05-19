import { redirect } from "next/navigation";
import { Landing } from "@/components/landing/Landing";

function getParam(
  v: string | string[] | undefined,
): string | null {
  if (!v) return null;
  if (Array.isArray(v)) return v[0] ?? null;
  return v;
}

export default function HomePage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const code = getParam(searchParams?.code);
  const tokenHash = getParam(searchParams?.token_hash);
  const type = getParam(searchParams?.type);
  const next = getParam(searchParams?.next);

  if (code || tokenHash) {
    const qp = new URLSearchParams();
    if (code) qp.set("code", code);
    if (tokenHash) qp.set("token_hash", tokenHash);
    if (type) qp.set("type", type);
    qp.set("next", next ?? (type === "recovery" ? "/redefinir-senha" : "/login?confirmed=1"));
    redirect(`/auth/callback?${qp.toString()}`);
  }

  return <Landing />;
}
