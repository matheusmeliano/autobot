import { AdminUsersClient } from "@/components/admin/AdminUsersClient";
import { getAdminUsersPageData } from "@/lib/adminUsersPage";

export default async function AdminPage() {
  const { initial, errorState } = await getAdminUsersPageData();

  if (errorState?.type === "config") {
    return (
      <div>
        <h1 className="mt-0 text-xl font-bold tracking-tight whitespace-nowrap max-[420px]:whitespace-normal sm:text-2xl min-[1201px]:text-[1.6rem] leading-[1.15] text-[var(--app-text-85)]">
          Administração
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--app-text-60)]">
          Gerencie os usuários do painel
        </p>

        <div className="hidden min-[1201px]:block mt-6 rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-5 shadow-none">
          <div className="space-y-3">
            <div className="text-lg font-semibold text-[var(--app-text-85)]">
              Configuração necessária
            </div>
            <div className="text-sm text-[var(--app-text-60)]">
              Para abrir o painel de usuários, configure na Vercel a variável{" "}
              <span className="font-semibold text-[var(--app-text-85)]">
                SUPABASE_SERVICE_ROLE_KEY
              </span>
              .
            </div>
            <div className="text-sm text-[var(--app-text-55)]">
              Vercel → Project → Settings → Environment Variables → adicione{" "}
              <span className="font-semibold text-[var(--app-text-85)]">
                SUPABASE_SERVICE_ROLE_KEY
              </span>{" "}
              (Production/Preview/Development) e redeploy.
            </div>
          </div>
        </div>

        <div className="grid w-full gap-4 py-3 min-[1201px]:hidden">
          <div className="overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-4 shadow-none">
            <div className="min-w-0">
              <div className="space-y-3">
                <div className="text-lg font-semibold text-[var(--app-text-85)]">
                  Configuração necessária
                </div>
                <div className="text-sm text-[var(--app-text-60)]">
                  Para abrir o painel de usuários, configure na Vercel a variável{" "}
                  <span className="font-semibold text-[var(--app-text-85)]">
                    SUPABASE_SERVICE_ROLE_KEY
                  </span>
                  .
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (errorState?.type === "load") {
    return (
      <div>
        <h1 className="mt-0 text-xl font-bold tracking-tight whitespace-nowrap max-[420px]:whitespace-normal sm:text-2xl min-[1201px]:text-[1.6rem] leading-[1.15] text-[var(--app-text-85)]">
          Administração
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--app-text-60)]">
          Gerencie os usuários do painel
        </p>

        <div className="hidden min-[1201px]:block mt-6 rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-5 shadow-none">
          <div className="space-y-3">
            <div className="text-lg font-semibold text-[var(--app-text-85)]">
              Não foi possível carregar usuários
            </div>
            <div className="text-sm text-[var(--app-text-60)]">{errorState.message}</div>
          </div>
        </div>

        <div className="grid w-full gap-4 py-3 min-[1201px]:hidden">
          <div className="overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-4 shadow-none">
            <div className="min-w-0">
              <div className="space-y-3">
                <div className="text-lg font-semibold text-[var(--app-text-85)]">
                  Não foi possível carregar usuários
                </div>
                <div className="text-sm text-[var(--app-text-60)]">{errorState.message}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <AdminUsersClient initial={initial} />;
}
