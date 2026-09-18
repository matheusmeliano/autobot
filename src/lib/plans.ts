export type PlanKey = "teste" | "basico" | "pro" | "vitalicio";

export function normalizePlan(value?: string | null): PlanKey {
  const v = (value ?? "").trim().toLowerCase();

  if (v === "teste" || v === "test") return "teste";
  if (v === "pro") return "pro";
  if (v === "vitalicio" || v === "vitalício") return "vitalicio";
  if (v === "basico" || v === "básico") return "basico";

  if (v === "starter" || v === "basic") return "basico";
  if (v === "business") return "vitalicio";
  if (v === "trial") return "teste";

  return "basico";
}

export function planLabel(plan: PlanKey) {
  if (plan === "teste") return "Teste";
  if (plan === "basico") return "Básico";
  if (plan === "pro") return "Pro";
  return "Vitalício";
}
