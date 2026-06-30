import Link from "next/link";
import { redirect } from "next/navigation";
import Script from "next/script";
import { getDefaultAuthenticatedPath, isAtendimentoOnlyAccessScope } from "@/lib/auth/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isGlobalAdminEmail } from "@/lib/auth/admin";
import { AdminLogoutForm } from "@/components/admin/AdminLogoutForm";
import { Logo } from "@/components/ui/Logo";
import { ScopedAppTheme } from "@/components/app/ScopedAppTheme";
import { getThemeStorageKey, normalizeStoredTheme } from "@/lib/theme";

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

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("theme, access_scope")
    .eq("user_id", user.id)
    .maybeSingle();

  if (isAtendimentoOnlyAccessScope((profile as any)?.access_scope)) {
    redirect(getDefaultAuthenticatedPath((profile as any)?.access_scope));
  }

  if (!isGlobalAdminEmail(user.email)) {
    redirect("/app");
  }

  const savedTheme = normalizeStoredTheme(profile?.theme);
  const initialTheme = savedTheme ?? "dark";
  const themeStorageKey = getThemeStorageKey(user.id);
  const initialBackground = initialTheme === "light" ? "#f8fafc" : "#070A10";

  return (
    <>
      <style>{`
        html,
        body {
          background: ${initialBackground};
          overscroll-behavior-y: none;
        }
      `}</style>
      <Script id="autobot-admin-theme-init" strategy="beforeInteractive">
        {`
          (function() {
            var fallbackTheme = ${JSON.stringify(initialTheme)};
            try {
              var storageKey = ${JSON.stringify(themeStorageKey)};
              var theme = ${JSON.stringify(savedTheme)};
              if (theme !== "light" && theme !== "dark") {
                var storedTheme = localStorage.getItem(storageKey);
                theme = storedTheme === "light" || storedTheme === "dark" ? storedTheme : fallbackTheme;
              } else {
                localStorage.setItem(storageKey, theme);
              }
              var el = document.documentElement;
              el.classList.add("app-theme");
              el.setAttribute("data-app-theme-scope", "admin");
              el.setAttribute("data-theme", theme);
            } catch (e) {
              var el = document.documentElement;
              el.classList.add("app-theme");
              el.setAttribute("data-app-theme-scope", "admin");
              el.setAttribute("data-theme", fallbackTheme);
            }
          })();
        `}
      </Script>
      <ScopedAppTheme
        scopeId="admin"
        userId={user.id}
        initialTheme={initialTheme}
      />
      <div className="min-h-screen bg-[var(--app-bg)] text-[var(--app-fg)]">
      <div className="relative flex w-full gap-6 px-4 py-6 min-[1201px]:px-6">
        <aside className="hidden w-72 shrink-0 min-[1201px]:sticky min-[1201px]:top-6 min-[1201px]:block min-[1201px]:h-[calc(100vh-3rem)]">
          <div className="flex h-full flex-col rounded-2xl border border-white/10 bg-white/[0.04] p-4">
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

            <AdminLogoutForm className="mt-4" />
          </div>
        </aside>

        <div className="w-full pb-24 min-[1201px]:pb-6">
          <div className="mb-6 min-[1201px]:hidden">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
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

              <AdminLogoutForm className="mt-4" />
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4 min-[1201px]:mt-0 min-[1201px]:p-6">
            {children}
          </div>
        </div>
      </div>
      </div>
    </>
  );
}
