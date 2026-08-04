"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { AuthCard } from "@/components/auth/AuthCard";
import { forgotPasswordAction } from "@/app/esqueci-senha/actions";
import { modalToast } from "@/lib/modalToast";

type FormValues = {
  email: string;
};

export function ForgotPasswordForm() {
  const searchParams = useSearchParams();
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<FormValues>({
    defaultValues: { email: "" },
  });
  const next = String(searchParams?.get("next") ?? "");
  const safeNext = /^\/(?!\/)/.test(next) ? next : "";
  const loginHref = safeNext ? `/login?next=${encodeURIComponent(safeNext)}` : "/login";

  const onSubmit = handleSubmit(async (values) => {
    const formData = new FormData();
    formData.append("email", values.email);
    if (safeNext) {
      formData.append("next", safeNext);
    }

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
        <Link
          className="font-semibold text-sky-700 hover:text-sky-800 hover:underline transition-colors"
          href={loginHref}
          style={{ color: "#0369a1" }}
        >
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
            className="mt-2 w-full rounded-xl border border-white/10 bg-[#0b1220] px-4 py-3 text-sm text-white outline-none ring-0 placeholder:text-white/30 focus:border-white/20 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] autofill:bg-[#0b1220] autofill:text-white autofill:shadow-[inset_0_0_0px_1000px_#0b1220] autofill:[-webkit-text-fill-color:#ffffff]"
            style={{ backgroundColor: "#0b1220" }}
            placeholder="voce@empresa.com"
            {...register("email", { required: true })}
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-2 inline-flex w-full items-center justify-center rounded-xl border border-sky-700 bg-sky-700 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-800 hover:border-sky-800 disabled:cursor-not-allowed disabled:bg-sky-700/60 disabled:border-sky-700/60 disabled:text-white/70 disabled:hover:bg-sky-700/60 disabled:opacity-100 transition-colors"
          style={{ backgroundColor: "#0369a1", borderColor: "#0369a1" }}
        >
          {isSubmitting ? "Enviando..." : "Enviar link"}
        </button>
      </form>
    </AuthCard>
  );
}
