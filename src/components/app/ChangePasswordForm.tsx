"use client";

import { Eye, EyeOff } from "lucide-react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { supabaseErrorToPt } from "@/lib/supabase/errors";
import { modalToast } from "@/lib/modalToast";

type FormValues = {
  password: string;
  confirm: string;
};

export function ChangePasswordForm() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    watch,
    reset,
  } = useForm<FormValues>({ defaultValues: { password: "", confirm: "" } });

  const onSubmit = handleSubmit(async (values) => {
    const { error } = await supabase.auth.updateUser({ password: values.password });
    if (error) {
      modalToast.error(supabaseErrorToPt(error.message));
      return;
    }
    modalToast.success("Senha atualizada com sucesso.");
    reset({ password: "", confirm: "" });
  });

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <label className="text-xs font-semibold text-[var(--app-text-60)]">Nova senha</label>
        <div className="relative mt-2">
          <input
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            className="w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-card-2)] px-4 py-3 pr-11 text-sm text-[var(--app-text-85)] outline-none ring-0 placeholder:text-[var(--app-text-30)] focus:border-[var(--app-border)] focus:ring-2 focus:ring-[var(--app-ring)]"
            placeholder="Mínimo 8 caracteres"
            {...register("password", {
              required: "Informe a nova senha.",
              minLength: { value: 8, message: "A senha deve ter no mínimo 8 caracteres." },
            })}
          />
          <button
            type="button"
            aria-label={showPassword ? "Ocultar senha" : "Ver senha"}
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-sky-700 hover:text-sky-800 focus:outline-none focus:ring-2 focus:ring-sky-600/40 transition-colors"
            style={{ color: "#0369a1" }}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {errors.password?.message ? (
          <div className="mt-2 text-xs font-medium text-rose-300">{errors.password.message}</div>
        ) : null}
      </div>

      <div>
        <label className="text-xs font-semibold text-[var(--app-text-60)]">Confirmar senha</label>
        <input
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          className="mt-2 w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-card-2)] px-4 py-3 text-sm text-[var(--app-text-85)] outline-none ring-0 placeholder:text-[var(--app-text-30)] focus:border-[var(--app-border)] focus:ring-2 focus:ring-[var(--app-ring)]"
          placeholder="Repita a nova senha"
          {...register("confirm", {
            required: "Confirme a nova senha.",
            validate: (v) => v === watch("password") || "As senhas precisam ser iguais.",
          })}
        />
        {errors.confirm?.message ? (
          <div className="mt-2 text-xs font-medium text-rose-300">{errors.confirm.message}</div>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="mt-1 inline-flex w-full items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-3 text-sm font-semibold text-[var(--app-text-85)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:bg-[var(--app-card-2)] disabled:text-[var(--app-text-60)] disabled:hover:bg-[var(--app-card-2)] disabled:opacity-100"
      >
        {isSubmitting ? "Salvando..." : "Salvar nova senha"}
      </button>
    </form>
  );
}
