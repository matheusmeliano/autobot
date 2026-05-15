"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { loginAction } from "@/app/login/actions";
import { AuthCard } from "@/components/auth/AuthCard";

type FormValues = {
  email: string;
  password: string;
};

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const didShowConfirmed = useRef(false);
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<FormValues>({
    defaultValues: { email: "", password: "" },
  });

  useEffect(() => {
    if (didShowConfirmed.current) return;
    if (searchParams?.get("confirmed") === "1") {
      didShowConfirmed.current = true;
      toast.success("E-mail confirmado!");
      router.replace("/login");
    }
  }, [router, searchParams]);

  const onSubmit = handleSubmit(async (values) => {
    const formData = new FormData();
    formData.append("email", values.email);
    formData.append("password", values.password);

    const res = await loginAction(formData);
    if (!res.ok) {
      toast.error(res.error ?? "Falha ao entrar.");
      return;
    }

    router.push("/app");
    router.refresh();
  });

  return (
    <AuthCard
      title="Entrar"
      subtitle="Acesse seu painel."
      footer={
        <>
          Não tem conta?{" "}
          <Link className="font-semibold text-white hover:underline" href="/signup">
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
            className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white outline-none ring-0 placeholder:text-white/30 focus:border-white/20"
            placeholder="voce@empresa.com"
            {...register("email", { required: true })}
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-white/60">Senha</label>
          <div className="relative mt-2">
            <input
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 pr-11 text-sm text-white outline-none ring-0 placeholder:text-white/30 focus:border-white/20"
              placeholder="••••••••"
              {...register("password", { required: true })}
            />
            <button
              type="button"
              aria-label={showPassword ? "Ocultar senha" : "Ver senha"}
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-white/50 hover:text-white/80 focus:outline-none focus:ring-2 focus:ring-white/20"
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
          <div className="mt-2 flex justify-end">
            <Link
              href="/esqueci-senha"
              className="text-xs font-semibold text-white/55 hover:text-white"
            >
              Esqueceu a senha?
            </Link>
          </div>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-2 inline-flex w-full items-center justify-center rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black hover:bg-white/90 disabled:opacity-60"
        >
          {isSubmitting ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </AuthCard>
  );
}
