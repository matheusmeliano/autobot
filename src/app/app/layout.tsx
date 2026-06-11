import { AppShell } from "@/components/app/AppShell";
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

  return (
    <>
      <Script id="autobot-app-theme-init" strategy="beforeInteractive">
        {`
          (function() {
            try {
              var theme = localStorage.getItem("app_theme");
              if (theme !== "light" && theme !== "dark") theme = "dark";
              var el = document.documentElement;
              el.classList.add("app-theme");
              el.setAttribute("data-app-theme-scope", "app");
              el.setAttribute("data-theme", theme);
            } catch (e) {}
          })();
        `}
      </Script>
      <AppShell>{children}</AppShell>
    </>
  );
}
