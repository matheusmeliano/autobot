"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { supabaseErrorToPt } from "@/lib/supabase/errors";
import { AuthCard } from "@/components/auth/AuthCard";
import { modalToast } from "@/lib/modalToast";

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
    const supabase = createSupabaseBrowserClient();
    const run = async () => {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      const tokenHash = url.searchParams.get("token_hash");
      const type = url.searchParams.get("type");

      const hash = url.hash ? url.hash.replace(/^#/, "") : "";
      const hashParams = hash ? new URLSearchParams(hash) : null;
      const hashError = hashParams?.get("error") ?? null;

      if (hashError) {
        const description =
          hashParams?.get("error_description") ??
          hashParams?.get("error_code") ??
          hashError ??
          "Link inválido ou expirado.";
        setUrlError(
          supabaseErrorToPt(decodeURIComponent(description.split("+").join(" "))),
        );
        setHasSession(false);
        return;
      }

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          setHasSession(false);
          return;
        }
        url.searchParams.delete("code");
        url.searchParams.delete("next");
        url.searchParams.delete("type");
        window.history.replaceState({}, "", `${url.pathname}${url.search}`);
      } else if (tokenHash && type) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: type as any,
        });
        if (error) {
          setHasSession(false);
          return;
        }
        url.searchParams.delete("token_hash");
        url.searchParams.delete("type");
        window.history.replaceState({}, "", `${url.pathname}${url.search}`);
      } else if (hashParams?.get("access_token") && hashParams?.get("refresh_token")) {
        const accessToken = hashParams.get("access_token")!;
        const refreshToken = hashParams.get("refresh_token")!;
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (error) {
          setHasSession(false);
          return;
        }
        url.hash = "";
        window.history.replaceState({}, "", `${url.pathname}${url.search}`);
      }

      const { data } = await supabase.auth.getSession();
      setHasSession(Boolean(data.session));
    };

    run();
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
        modalToast.error(supabaseErrorToPt(error.message));
        return;
      }

      modalToast.success("Senha atualizada com sucesso.");
      router.push("/app");
      router.refresh();
    },
    (errors) => {
      if (errors.password?.message) {
        modalToast.error(String(errors.password.message));
        return;
      }
      if (errors.confirm?.message) {
        modalToast.error(String(errors.confirm.message));
        return;
      }
      modalToast.warning("Confira os campos.");
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
