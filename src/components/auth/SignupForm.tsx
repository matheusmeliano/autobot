"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { signupAction } from "@/app/signup/actions";
import { AuthCard } from "@/components/auth/AuthCard";
import { modalToast } from "@/lib/modalToast";

type FormValues = {
  name: string;
  email: string;
  password: string;
};

export function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<FormValues>({
    defaultValues: { name: "", email: "", password: "" },
  });
  const next = String(searchParams?.get("next") ?? "");
  const safeNext = /^\/(?!\/)/.test(next) ? next : "/app";
  const accessScope = searchParams?.get("mode") === "atendimento" ? "atendimento" : "app";
  const loginHref = next ? `/login?next=${encodeURIComponent(safeNext)}` : "/login";
  const subtitle =
    accessScope === "atendimento"
      ? "Gerencie conversas, conteúdos e aulas."
      : "Automatize cobranças no WhatsApp e muito mais.";

  const onSubmit = handleSubmit(
    async (values) => {
      const formData = new FormData();
      formData.append("name", values.name);
      formData.append("email", values.email);
      formData.append("password", values.password);
      formData.append("next", safeNext);
      formData.append("access_scope", accessScope);

      const res = await signupAction(formData);
      if (!res.ok) {
        modalToast.error(res.error ?? "Falha ao criar conta.");
        return;
      }

      if (res.needsEmailConfirmation) {
        modalToast.success("Confirme seu email para entrar.");
        router.push(loginHref);
        return;
      }

      router.push(String(res.next ?? safeNext));
      router.refresh();
    },
    (errors) => {
      if (errors.password?.message) {
        modalToast.error(String(errors.password.message));
        return;
      }
      if (errors.email?.message) {
        modalToast.error(String(errors.email.message));
        return;
      }
      modalToast.warning("Confira os campos.");
    },
  );

  return (
    <AuthCard
      title="Criar conta"
      subtitle={subtitle}
      footer={
        <>
          Já tem conta?{" "}
          <Link
            className="font-semibold text-sky-700 hover:text-sky-800 hover:underline transition-colors"
            href={loginHref}
            style={{ color: "#0369a1" }}
          >
            Entrar
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <label className="text-xs font-semibold text-white/60">Nome</label>
          <input
            type="text"
            autoComplete="name"
            className="mt-2 w-full rounded-xl border border-white/10 bg-[#0b1220] px-4 py-3 text-sm text-white outline-none ring-0 placeholder:text-white/30 focus:border-white/20 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] autofill:bg-[#0b1220] autofill:text-white autofill:shadow-[inset_0_0_0px_1000px_#0b1220] autofill:[-webkit-text-fill-color:#ffffff]"
            placeholder="Seu nome"
            style={{ backgroundColor: "#0b1220" }}
            {...register("name", { required: true })}
          />
        </div>

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
              pattern: {
                value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                message: "Informe um e-mail válido.",
              },
            })}
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-white/60">Senha</label>
          <div className="relative mt-2">
            <input
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              className="w-full rounded-xl border border-white/10 bg-[#0b1220] px-4 py-3 pr-11 text-sm text-white outline-none ring-0 placeholder:text-white/30 focus:border-white/20 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] autofill:bg-[#0b1220] autofill:text-white autofill:shadow-[inset_0_0_0px_1000px_#0b1220] autofill:[-webkit-text-fill-color:#ffffff]"
              placeholder="Mínimo 8 caracteres"
              style={{ backgroundColor: "#0b1220" }}
              {...register("password", {
                required: true,
                minLength: {
                  value: 8,
                  message: "A senha deve ter no mínimo 8 caracteres.",
                },
              })}
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
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-2 inline-flex w-full items-center justify-center rounded-xl border border-sky-700 bg-sky-700 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-800 hover:border-sky-800 disabled:cursor-not-allowed disabled:bg-sky-700/60 disabled:border-sky-700/60 disabled:text-white/70 disabled:hover:bg-sky-700/60 disabled:opacity-100 transition-colors"
          style={{ backgroundColor: "#0369a1", borderColor: "#0369a1" }}
        >
          {isSubmitting ? "Criando..." : "Criar conta"}
        </button>
      </form>
    </AuthCard>
  );
}
