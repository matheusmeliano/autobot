import { notFound } from "next/navigation";
import { PixCopyClient } from "@/components/pix/PixCopyClient";
import { parsePixLinkToken } from "@/lib/pix-links";

export const dynamic = "force-dynamic";

type PixPageProps = {
  params: Promise<{ token: string }>;
};

export default async function PixPage({ params }: PixPageProps) {
  const resolvedParams = await params;
  const payload = parsePixLinkToken(resolvedParams.token);

  if (!payload) {
    notFound();
  }

  return (
    <PixCopyClient
      pixKey={payload.pixKey}
      debtorName={payload.debtorName}
      amount={payload.amount}
    />
  );
}
