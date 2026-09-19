import { AppShell } from "@/components/app/AppShell";
import {
  getDefaultAuthenticatedPath,
  isAtendimentoOnlyAccessScope,
} from "@/lib/auth/access";
import { getThemeStorageKey } from "@/lib/theme";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Script from "next/script";
import { isGlobalAdminEmail } from "@/lib/auth/admin";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) {
    const hdrs = await headers();
    const candidates = [
      hdrs.get("x-invoke-path"),
      hdrs.get("x-matched-path"),
      hdrs.get("next-url"),
      hdrs.get("x-next-url"),
      hdrs.get("x-original-uri"),
      hdrs.get("x-forwarded-uri"),
    ];
    let nextPath = candidates.find((value) => typeof value === "string" && value.startsWith("/")) ?? "";
    if (!nextPath) {
      const referer = hdrs.get("referer");
      if (referer) {
        try {
          const refUrl = new URL(referer);
          nextPath = `${refUrl.pathname}${refUrl.search}`;
        } catch {}
      }
    }
    if (nextPath) {
      redirect(`/login?next=${encodeURIComponent(nextPath)}`);
    }
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("theme, access_scope")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (isAtendimentoOnlyAccessScope((profile as any)?.access_scope)) {
    redirect(getDefaultAuthenticatedPath((profile as any)?.access_scope));
  }

  if (!isGlobalAdminEmail(session.user.email)) {
    redirect("/app");
  }

  const initialTheme = "light";
  const themeStorageKey = getThemeStorageKey(session.user.id);
  const initialBackground = "#efeeed";

  return (
    <>
      <style>{`
        html,
        body {
          background: ${initialBackground};
          overscroll-behavior-y: none;
        }
      `}</style>
      <Script id="autobot-admin-appshell-theme-init" strategy="beforeInteractive">
        {`
          (function() {
            var fallbackTheme = "light";
            try {
              var storageKey = ${JSON.stringify(themeStorageKey)};
              var theme = "light";
              try {
                localStorage.setItem(storageKey, theme);
              } catch (localStorageErr) {}
              var el = document.documentElement;
              el.classList.add("app-theme");
              el.setAttribute("data-app-theme-scope", "app");
              el.setAttribute("data-theme", theme);
            } catch (e) {
              var el = document.documentElement;
              el.classList.add("app-theme");
              el.setAttribute("data-app-theme-scope", "app");
              el.setAttribute("data-theme", fallbackTheme);
            }
          })();
        `}
      </Script>
      <AppShell initialUserId={session.user.id} initialTheme={initialTheme}>
        {children}
      </AppShell>
    </>
  );
}
