import { PublicAtendimentoClient } from "@/components/atendimento/PublicAtendimentoClient";

export default async function AtendimentoPublicPage({
  searchParams,
}: {
  searchParams: Promise<{ slug?: string }>;
}) {
  const params = await searchParams;
  return <PublicAtendimentoClient initialSlug={String(params.slug ?? "")} />;
}
