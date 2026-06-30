import { AppShell } from "@/components/app/AppShell";
import { getDefaultAuthenticatedPath, isAtendimentoOnlyAccessScope } from "@/lib/auth/access";
import { getThemeStorageKey, normalizeStoredTheme } from "@/lib/theme";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Script from "next/script";

export const dynamic = "force-dynamic";

export default async function AppLayout({
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
          if (refUrl.pathname.startsWith("/app")) {
            nextPath = `${refUrl.pathname}${refUrl.search}`;
          }
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

  const savedTheme = normalizeStoredTheme(profile?.theme);
  const initialTheme = savedTheme ?? "dark";
  const themeStorageKey = getThemeStorageKey(session.user.id);
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
      <Script id="autobot-app-theme-init" strategy="beforeInteractive">
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
