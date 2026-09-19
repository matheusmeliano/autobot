import { AdminUsersClient } from "@/components/admin/AdminUsersClient";
import { getAdminUsersPageData } from "@/lib/adminUsersPage";
import { SectionShell } from "@/components/app/SectionShell";

export default async function AdminUsuariosPage() {
  const { initial, errorState } = await getAdminUsersPageData();

  if (errorState?.type === "config") {
    return (
      <SectionShell
        title="Administração"
        subtitle="Gerencie os usuários do painel"
        backHref="/app/dashboard"
        backLabel="Painel"
      >
        <div className="mt-6 space-y-3 rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-5 shadow-none">
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
      </SectionShell>
    );
  }

  if (errorState?.type === "load") {
    return (
      <SectionShell
        title="Administração"
        subtitle="Gerencie os usuários do painel"
        backHref="/app/dashboard"
        backLabel="Painel"
      >
        <div className="mt-6 space-y-3 rounded-2xl border border-[var(--app-border)] bg-[var(--app-solid-surface)] p-5 shadow-none">
          <div className="text-lg font-semibold text-[var(--app-text-85)]">
            Não foi possível carregar usuários
          </div>
          <div className="text-sm text-[var(--app-text-60)]">{errorState.message}</div>
        </div>
      </SectionShell>
    );
  }

  return <AdminUsersClient initial={initial} />;
}
