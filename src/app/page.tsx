import { redirect } from "next/navigation";
import { Landing } from "@/components/landing/Landing";

function getParam(
  v: string | string[] | undefined,
): string | null {
  if (!v) return null;
  if (Array.isArray(v)) return v[0] ?? null;
  return v;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = searchParams ? await searchParams : undefined;
  const code = getParam(sp?.code);
  const tokenHash = getParam(sp?.token_hash);
  const type = getParam(sp?.type);
  const next = getParam(sp?.next);

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
