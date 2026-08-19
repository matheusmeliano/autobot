import type { Viewport } from "next";
import { AtendimentoClient } from "@/components/app/atendimento/AtendimentoClient";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAtendimentoEmail } from "@/lib/atendimento/utils";
import { notFound } from "next/navigation";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default async function AtendimentoPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isAtendimentoEmail(user?.email)) {
    notFound();
  }

  return (
    <>
      <style>{`
        html,
        body {
          -webkit-text-size-adjust: 100%;
          text-size-adjust: 100%;
        }

        @supports (-webkit-touch-callout: none) {
          input,
          textarea,
          select {
            font-size: 16px !important;
          }
        }
      `}</style>
      <div className="mx-auto w-full max-w-[1600px] px-4 py-4 sm:px-5 sm:py-5 lg:px-7 lg:py-6 xl:px-9 2xl:px-12">
        <AtendimentoClient />
      </div>
    </>
  );
}
