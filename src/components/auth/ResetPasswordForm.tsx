"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { supabaseErrorToPt } from "@/lib/supabase/errors";
import { AuthCard } from "@/components/auth/AuthCard";

type FormValues = {
  password: string;
  confirm: string;
};

export function ResetPasswordForm() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
    watch,
  } = useForm<FormValues>({
    defaultValues: { password: "", confirm: "" },
  });

  useEffect(() => {
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    if (hash && hash.includes("error=")) {
      const params = new URLSearchParams(hash.replace(/^#/, ""));
      const description =
        params.get("error_description") ??
        params.get("error_code") ??
        params.get("error") ??
        "Link inválido ou expirado.";
      setUrlError(
        supabaseErrorToPt(decodeURIComponent(description.split("+").join(" ")))
      );
    }

    const supabase = createSupabaseBrowserClient();
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(Boolean(data.session));
    });
  }, []);

  if (urlError) {
    return (
      <AuthCard
        title="Não foi possível redefinir"
        subtitle={urlError}
        footer={
          <Link className="font-semibold text-white hover:underline" href="/login">
            Voltar para entrar
          </Link>
        }
      >
        <Link
          href="/esqueci-senha"
          className="mt-2 inline-flex w-full items-center justify-center rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black hover:bg-white/90"
        >
          Solicitar novo link
        </Link>
      </AuthCard>
    );
  }

  const onSubmit = handleSubmit(
    async (values) => {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({ password: values.password });
      if (error) {
        toast.error(supabaseErrorToPt(error.message));
        return;
      }

      toast.success("Senha atualizada com sucesso.");
      router.push("/app");
      router.refresh();
    },
    (errors) => {
      if (errors.password?.message) {
        toast.error(String(errors.password.message));
        return;
      }
      if (errors.confirm?.message) {
        toast.error(String(errors.confirm.message));
        return;
      }
      toast.error("Confira os campos.");
    },
  );

  if (hasSession === false) {
    return (
      <AuthCard
        title="Link inválido"
        subtitle="Seu link expirou ou já foi usado. Solicite um novo link."
        footer={
          <Link className="font-semibold text-white hover:underline" href="/login">
            Voltar para entrar
          </Link>
        }
      >
        <Link
          href="/esqueci-senha"
          className="mt-2 inline-flex w-full items-center justify-center rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black hover:bg-white/90"
        >
          Solicitar novo link
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Redefinir senha"
      subtitle="Crie uma nova senha para sua conta."
      footer={
        <Link className="font-semibold text-white hover:underline" href="/login">
          Voltar para entrar
        </Link>
      }
    >
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <label className="text-xs font-semibold text-white/60">Nova senha</label>
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
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-white/60">Confirmar senha</label>
          <input
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white outline-none ring-0 placeholder:text-white/30 focus:border-white/20"
            placeholder="Repita a nova senha"
            {...register("confirm", {
              required: true,
              validate: (v) =>
                v === watch("password") || "As senhas precisam ser iguais.",
            })}
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-2 inline-flex w-full items-center justify-center rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black hover:bg-white/90 disabled:opacity-60"
        >
          {isSubmitting ? "Salvando..." : "Salvar nova senha"}
        </button>
      </form>
    </AuthCard>
  );
}
