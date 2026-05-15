"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { AppNav } from "@/components/app/AppNav";
import { logoutAction } from "@/app/app/actions";
import { Logo } from "@/components/ui/Logo";
import { isGlobalAdminEmail } from "@/lib/auth/admin";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useSessionStore } from "@/lib/app/sessionStore";

export function AppShell({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [email, setEmail] = useState<string>("");
  const setStoreEmail = useSessionStore((s) => s.setEmail);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      const next = data.user?.email ?? "";
      setEmail(next);
      setStoreEmail(next);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = session?.user?.email ?? "";
      setEmail(next);
      setStoreEmail(next);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [supabase, setStoreEmail]);

  useEffect(() => {
    router.prefetch("/app/dashboard");
    router.prefetch("/app/clientes");
    router.prefetch("/app/cobrancas");
    router.prefetch("/app/agenda");
  }, [router]);

  const showAdmin = isGlobalAdminEmail(email);

  return (
    <div className="min-h-screen bg-[#070A10] text-white">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-[-260px] h-[680px] w-[680px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.18),rgba(99,102,241,0)_55%)]" />
        <div className="absolute right-[-220px] top-[140px] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.12),rgba(16,185,129,0)_55%)]" />
      </div>

      <div className="relative mx-auto flex w-full max-w-7xl gap-6 px-4 py-6 min-[1201px]:px-6">
        <aside className="hidden w-72 shrink-0 min-[1201px]:block">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-[0_20px_80px_-30px_rgba(0,0,0,0.8)] backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Logo />
                <div className="text-sm font-semibold tracking-tight">AutoBot</div>
              </div>
              {showAdmin ? (
                <Link
                  href="/admin"
                  className="rounded-xl px-3 py-2 text-xs font-semibold text-white/60 hover:bg-white/[0.06] hover:text-white/85"
                >
                  Admin
                </Link>
              ) : null}
            </div>

            <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
              <div className="text-[11px] font-semibold text-white/45">
                Logado como
              </div>
              <div className="mt-1 truncate text-sm font-semibold">
                {email || "—"}
              </div>
            </div>

            <div className="mt-4">
              <AppNav variant="sidebar" />
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
        </aside>

        <div className="w-full pb-16 min-[1201px]:pb-6">
          {showAdmin ? (
            <div className="mb-4 flex justify-end min-[1201px]:hidden">
              <Link
                href="/admin"
                className="rounded-xl px-3 py-2 text-xs font-semibold text-white/60 hover:bg-white/[0.06] hover:text-white/85"
              >
                Admin
              </Link>
            </div>
          ) : null}
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-[0_20px_80px_-30px_rgba(0,0,0,0.8)] backdrop-blur-xl min-[1201px]:p-6"
          >
            {children}
          </motion.div>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-white/10 bg-[#070A10]/80 backdrop-blur-xl min-[1201px]:hidden">
        <AppNav variant="bottom" />
      </div>
    </div>
  );
}
