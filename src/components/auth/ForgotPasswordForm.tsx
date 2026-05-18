"use client";

import Link from "next/link";
import { useForm } from "react-hook-form";
import { AuthCard } from "@/components/auth/AuthCard";
import { forgotPasswordAction } from "@/app/esqueci-senha/actions";
import { modalToast } from "@/lib/modalToast";

type FormValues = {
  email: string;
};

export function ForgotPasswordForm() {
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<FormValues>({
    defaultValues: { email: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    const formData = new FormData();
    formData.append("email", values.email);

    const res = await forgotPasswordAction(formData);
    if (!res.ok) {
      modalToast.error(res.error ?? "Falha ao enviar link.");
      return;
    }

    modalToast.success("Link enviado para seu email.");
  });

  return (
    <AuthCard
      title="Recuperar senha"
      subtitle="Enviaremos um link para redefinir sua senha."
      footer={
        <Link className="font-semibold text-white hover:underline" href="/login">
          Voltar para entrar
        </Link>
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

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-2 inline-flex w-full items-center justify-center rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black hover:bg-white/90 disabled:opacity-60"
        >
          {isSubmitting ? "Enviando..." : "Enviar link"}
        </button>
      </form>
    </AuthCard>
  );
}
