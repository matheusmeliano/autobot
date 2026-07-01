import Link from "next/link";
import { PublicAtendimentoClient } from "@/components/atendimento/PublicAtendimentoClient";
import { getAtendimentoPortalPath, isAtendimentoOnlyAccessScope, normalizeAccessScope } from "@/lib/auth/access";
import { ATENDIMENTO_PUBLIC_LINK_SLUG } from "@/lib/atendimento/constants";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function AtendimentoPublicPage({
  searchParams,
}: {
  searchParams: Promise<{ slug?: string }>;
}) {
  const params = await searchParams;
  const initialSlug = String(params.slug ?? "").trim() || ATENDIMENTO_PUBLIC_LINK_SLUG;
  const nextPath = getAtendimentoPortalPath(initialSlug);

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const rootStyle = (
    <style>{`
      html,
      body {
        background: #09111A;
        overscroll-behavior-y: none;
      }
    `}</style>
  );

  if (!user?.id) {
    return (
      <>
        {rootStyle}
        <div className="min-h-[100dvh] bg-[#09111A] px-4 py-6 text-white md:px-8 md:py-10">
          <div className="mx-auto flex min-h-[calc(100dvh-3rem)] max-w-3xl items-center justify-center">
            <div className="w-full rounded-[2rem] border border-white/10 bg-[#0E1723] p-6 shadow-[0_40px_120px_rgba(0,0,0,0.45)] md:p-8">
              <div className="text-2xl font-semibold tracking-tight">Atendimento</div>
              <p className="mt-3 text-sm text-white/70">
                <strong>Para participar desta conversa com nosso bot, você precisa se cadastrar.</strong>
              </p>
              <p className="mt-3 text-sm text-white/60">
                Use o seu cadastro existente ou crie sua conta para acessar o portal exclusivo de atendimento.
              </p>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <Link
                  href={`/login?next=${encodeURIComponent(nextPath)}`}
                  className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.08]"
                >
                  Entrar
                </Link>
                <Link
                  href={`/signup?next=${encodeURIComponent(nextPath)}&mode=atendimento`}
                  className="inline-flex items-center justify-center rounded-2xl border border-emerald-500/40 bg-emerald-500/15 px-4 py-3 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/20"
                >
                  Criar cadastro
                </Link>
              </div>
              <div className="mt-4 text-center text-sm text-white/55">
                <Link
                  href={`/esqueci-senha?next=${encodeURIComponent(nextPath)}`}
                  className="font-semibold text-white/75 hover:text-white"
                >
                  Esqueci minha senha
                </Link>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("nome, email, created_at, access_scope")
    .eq("user_id", user.id)
    .maybeSingle();

  const accessScope = normalizeAccessScope((profile as any)?.access_scope);
  if (!isAtendimentoOnlyAccessScope(accessScope)) {
    redirect("/app");
  }

  return (
    <>
      {rootStyle}
      <PublicAtendimentoClient
        initialSlug={initialSlug}
        page="bot"
        currentUser={{
          id: user.id,
          email: user.email ?? "",
        }}
        profile={{
          nome: String((profile as any)?.nome ?? "").trim() || "",
          email: String((profile as any)?.email ?? user.email ?? "").trim(),
          created_at: String((profile as any)?.created_at ?? "").trim() || "",
        }}
      />
    </>
  );
}
