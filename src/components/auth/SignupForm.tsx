"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { signupAction } from "@/app/signup/actions";
import { AuthCard } from "@/components/auth/AuthCard";

type FormValues = {
  name: string;
  email: string;
  password: string;
};

export function SignupForm() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<FormValues>({
    defaultValues: { name: "", email: "", password: "" },
  });

  const onSubmit = handleSubmit(
    async (values) => {
      const formData = new FormData();
      formData.append("name", values.name);
      formData.append("email", values.email);
      formData.append("password", values.password);

      const res = await signupAction(formData);
      if (!res.ok) {
        toast.error(res.error ?? "Falha ao criar conta.");
        return;
      }

      if (res.needsEmailConfirmation) {
      toast.success("Confirme seu email para entrar.");
        router.push("/login");
        return;
      }

      router.push("/app");
      router.refresh();
    },
    (errors) => {
      if (errors.password?.message) {
        toast.error(String(errors.password.message));
        return;
      }
      toast.error("Confira os campos.");
    },
  );

  return (
    <AuthCard
      title="Criar conta"
      subtitle="Automatize cobranças no WhatsApp e muito mais."
      footer={
        <>
          Já tem conta?{" "}
          <Link className="font-semibold text-white hover:underline" href="/login">
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
            className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white outline-none ring-0 placeholder:text-white/30 focus:border-white/20"
            placeholder="Seu nome"
            {...register("name", { required: true })}
          />
        </div>

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
              autoComplete="new-password"
              className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 pr-11 text-sm text-white outline-none ring-0 placeholder:text-white/30 focus:border-white/20"
              placeholder="Mínimo 8 caracteres"
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
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-white/50 hover:text-white/80 focus:outline-none focus:ring-2 focus:ring-white/20"
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
          className="mt-2 inline-flex w-full items-center justify-center rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black hover:bg-white/90 disabled:opacity-60"
        >
          {isSubmitting ? "Criando..." : "Criar conta"}
        </button>
      </form>
    </AuthCard>
  );
}
