import Link from "next/link";
import { redirect } from "next/navigation";
import Script from "next/script";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isGlobalAdminEmail } from "@/lib/auth/admin";
import { Logo } from "@/components/ui/Logo";
import { logoutAction } from "@/app/app/actions";
import { ScopedAppTheme } from "@/components/app/ScopedAppTheme";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isGlobalAdminEmail(user?.email)) {
    redirect(user ? "/app" : "/login");
  }

  return (
    <>
      <Script id="autobot-admin-theme-init" strategy="beforeInteractive">
        {`
          (function() {
            try {
              var theme = localStorage.getItem("app_theme");
              if (theme !== "light" && theme !== "dark") theme = "dark";
              var el = document.documentElement;
              el.classList.add("app-theme");
              el.setAttribute("data-app-theme-scope", "admin");
              el.setAttribute("data-theme", theme);
            } catch (e) {}
          })();
        `}
      </Script>
      <ScopedAppTheme scopeId="admin" />
      <div className="min-h-screen bg-[#070A10] text-white">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-[-260px] h-[680px] w-[680px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.18),rgba(99,102,241,0)_55%)]" />
        <div className="absolute right-[-220px] top-[140px] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.12),rgba(16,185,129,0)_55%)]" />
      </div>

      <div className="relative flex w-full gap-6 px-4 py-6 min-[1201px]:px-6">
        <aside className="hidden w-72 shrink-0 min-[1201px]:sticky min-[1201px]:top-6 min-[1201px]:block min-[1201px]:h-[calc(100vh-3rem)]">
          <div className="flex h-full flex-col rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Logo />
                <div className="text-sm font-semibold tracking-tight">AutoBot</div>
              </div>
              <Link
                href="/app"
                className="rounded-xl px-3 py-2 text-xs font-semibold text-white/60 hover:bg-white/[0.06] hover:text-white/85"
              >
                Painel
              </Link>
            </div>

            <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
              <div className="text-[11px] font-semibold text-white/45">
                Administrador
              </div>
              <div className="mt-1 truncate text-sm font-semibold">{user?.email}</div>
            </div>

            <div className="mt-4 flex-1" />

            <form action={logoutAction} className="mt-4">
              <button
                type="submit"
                className="inline-flex w-full items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/85 hover:bg-white/[0.06]"
              >
                Sair
              </button>
            </form>
          </div>
        </aside>

        <div className="w-full pb-24 min-[1201px]:pb-6">
          <div className="mb-6 min-[1201px]:hidden">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Logo />
                  <div className="text-sm font-semibold tracking-tight">
                    AutoBot
                  </div>
                </div>
                <Link
                  href="/app"
                  className="rounded-xl px-3 py-2 text-xs font-semibold text-white/60 hover:bg-white/[0.06] hover:text-white/85"
                >
                  Painel
                </Link>
              </div>

              <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                <div className="text-[11px] font-semibold text-white/45">
                  Administrador
                </div>
                <div className="mt-1 truncate text-sm font-semibold">
                  {user?.email}
                </div>
              </div>

              <form action={logoutAction} className="mt-4">
                <button
                  type="submit"
                  className="inline-flex w-full items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/85 hover:bg-white/[0.06]"
                >
                  Sair
                </button>
              </form>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-xl min-[1201px]:mt-0 min-[1201px]:p-6">
            {children}
          </div>
        </div>
      </div>
      </div>
    </>
  );
}
