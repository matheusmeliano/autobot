import { createSupabaseServerClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";

const ATENDIMENTO_MENU_EMAIL = "atendimento.usa.music@gmail.com";

export default async function AtendimentoPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const email = String(user?.email ?? "").trim().toLowerCase();
  if (email !== ATENDIMENTO_MENU_EMAIL) {
    notFound();
  }

  return (
    <div>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
        Atendimento
      </h1>
      <div className="mt-2 text-sm text-white/60">
        Estrutura inicial do menu Atendimento criada com acesso exclusivo para o usuário autorizado.
      </div>

      <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="text-xs font-semibold tracking-[0.2em] text-white/45">
          EM BREVE
        </div>
        <div className="mt-2 text-lg font-semibold tracking-tight">
          Conteúdo em definição
        </div>
        <div className="mt-1 text-sm text-white/60">
          As funcionalidades desta página serão adicionadas no próximo comando.
        </div>
      </div>
    </div>
  );
}
