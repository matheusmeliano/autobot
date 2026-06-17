function statusPriority(status: string) {
  switch (status) {
    case "atrasado":
      return 5;
    case "suspeita_de_pagamento":
      return 4;
    case "pendente":
      return 3;
    case "agendado":
      return 2;
    case "pago":
      return 1;
    case "executado":
      return 1;
    default:
      return 0;
  }
}

function normalizeDebtorChargeStatus(status: string) {
  switch (status) {
    case "agendado":
    case "pendente":
    case "pago":
    case "atrasado":
      return status;
    case "suspeita_de_pagamento":
      return "pendente";
    default:
      return "ativo";
  }
}

export async function syncDebtorChargeStatus(admin: any, userId: string, debtorId: string) {
  const { data: schedules } = await admin
    .from("schedules")
    .select("status, data_envio")
    .eq("user_id", userId)
    .eq("debtor_id", debtorId)
    .order("data_envio", { ascending: false })
    .limit(100);

  const nextStatus = (schedules ?? []).reduce(
    (best: string, row: any) => {
      const current = String(row?.status ?? "").toLowerCase();
      return statusPriority(current) > statusPriority(best) ? current : best;
    },
    "",
  );

  await admin
    .from("debtors")
    .update({ status: normalizeDebtorChargeStatus(nextStatus) })
    .eq("user_id", userId)
    .eq("id", debtorId);
}
