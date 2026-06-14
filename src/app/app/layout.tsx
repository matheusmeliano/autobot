import { AppShell } from "@/components/app/AppShell";
import { getThemeStorageKey, normalizeStoredTheme } from "@/lib/theme";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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
    redirect("/login");
  }

  const { data: profile } = await supabase.from("profiles").select("theme").maybeSingle();
  const savedTheme = normalizeStoredTheme(profile?.theme);
  const initialTheme = savedTheme ?? "dark";
  const themeStorageKey = getThemeStorageKey(session.user.id);

  return (
    <>
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
