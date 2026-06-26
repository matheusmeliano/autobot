import { AtendimentoClient } from "@/components/app/atendimento/AtendimentoClient";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAtendimentoEmail } from "@/lib/atendimento/utils";
import { notFound } from "next/navigation";

export default async function AtendimentoPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isAtendimentoEmail(user?.email)) {
    notFound();
  }

  return <AtendimentoClient />;
}
