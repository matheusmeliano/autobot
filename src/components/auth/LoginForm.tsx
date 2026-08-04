"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { loginAction } from "@/app/login/actions";
import { AuthCard } from "@/components/auth/AuthCard";
import { modalToast } from "@/lib/modalToast";

type FormValues = {
  email: string;
  password: string;
};

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const didShowConfirmed = useRef(false);
  const didShowLinkNotice = useRef(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: { email: "", password: "" },
  });
  const next = String(searchParams?.get("next") ?? "");
  const safeNext = /^\/(?!\/)/.test(next) ? next : "";
  const signupHref = safeNext
    ? `/signup?next=${encodeURIComponent(safeNext)}${safeNext.startsWith("/atendimento") ? "&mode=atendimento" : ""}`
    : "/signup";
  const forgotPasswordHref = safeNext
    ? `/esqueci-senha?next=${encodeURIComponent(safeNext)}`
    : "/esqueci-senha";

  useEffect(() => {
    if (didShowConfirmed.current) return;
    if (searchParams?.get("confirmed") === "1") {
      didShowConfirmed.current = true;
      modalToast.success("E-mail confirmado!");
      router.replace("/login");
    }
  }, [router, searchParams]);

  useEffect(() => {
    if (didShowLinkNotice.current) return;
    if (searchParams?.get("link") === "1") {
      didShowLinkNotice.current = true;
      modalToast.info("Faça login para continuar.");
      const next = searchParams?.get("next");
      if (next) {
        router.replace(`/login?next=${encodeURIComponent(next)}`);
      } else {
        router.replace("/login");
      }
    }
  }, [router, searchParams]);

  const onSubmit = handleSubmit(async (values) => {
    const formData = new FormData();
    formData.append("email", values.email);
    formData.append("password", values.password);
    if (safeNext) {
      formData.append("next", safeNext);
    }

    const res = await loginAction(formData);
    if (!res.ok) {
      modalToast.error(res.error ?? "Falha ao entrar.");
      return;
    }

    const nextUrl = String(res.next ?? safeNext ?? "/app");
    router.push(nextUrl);
    router.refresh();
  });

  return (
    <AuthCard
      title="Entrar"
      subtitle="Acesse seu painel."
      footer={
        <>
          Não tem conta?{" "}
          <Link className="font-semibold text-white hover:underline" href={signupHref}>
            Criar conta
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <label className="text-xs font-semibold text-white/60">Email</label>
          <input
            type="email"
            autoComplete="email"
            className="mt-2 w-full rounded-xl border border-white/10 bg-[#0b1220] px-4 py-3 text-sm text-white outline-none ring-0 placeholder:text-white/30 focus:border-white/20 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] autofill:bg-[#0b1220] autofill:text-white autofill:shadow-[inset_0_0_0px_1000px_#0b1220] autofill:[-webkit-text-fill-color:#ffffff]"
            placeholder="voce@empresa.com"
            style={{ backgroundColor: "#0b1220" }}
            {...register("email", {
              required: "Informe seu e-mail.",
              validate: (value) => {
                const v = String(value ?? "").trim();
                if (!v) return "Informe seu e-mail.";
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "Informe um e-mail válido.";
                return true;
              },
            })}
          />
          {errors.email?.message ? (
            <div className="mt-2 text-xs font-medium text-rose-300">{errors.email.message}</div>
          ) : null}
        </div>

        <div>
          <label className="text-xs font-semibold text-white/60">Senha</label>
          <div className="relative mt-2">
            <input
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              className="w-full rounded-xl border border-white/10 bg-[#0b1220] px-4 py-3 pr-11 text-sm text-white outline-none ring-0 placeholder:text-white/30 focus:border-white/20 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] autofill:bg-[#0b1220] autofill:text-white autofill:shadow-[inset_0_0_0px_1000px_#0b1220] autofill:[-webkit-text-fill-color:#ffffff]"
              placeholder="••••••••"
              style={{ backgroundColor: "#0b1220" }}
              {...register("password", { required: "Informe sua senha." })}
            />
            <button
              type="button"
              aria-label={showPassword ? "Ocultar senha" : "Ver senha"}
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-sky-700 hover:text-sky-800 focus:outline-none focus:ring-2 focus:ring-sky-600/40 transition-colors"
              style={{ color: "#0369a1" }}
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
          {errors.password?.message ? (
            <div className="mt-2 text-xs font-medium text-rose-300">{errors.password.message}</div>
          ) : null}
          <div className="mt-2 flex justify-end">
            <Link href={forgotPasswordHref} className="text-xs font-semibold text-white/55 hover:text-white">
              Esqueceu a senha?
            </Link>
          </div>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-2 inline-flex w-full items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-3 text-sm font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:bg-[var(--app-card-2)] disabled:text-[var(--app-text-60)] disabled:hover:bg-[var(--app-card-2)] disabled:opacity-100"
        >
          {isSubmitting ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </AuthCard>
  );
}
