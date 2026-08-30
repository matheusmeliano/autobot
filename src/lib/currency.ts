export const USA_ATTENDANT_EMAIL = "atendimento.usa.music@gmail.com";

export function isUSDCurrencyEmail(email?: string | null): boolean {
  return (email ?? "").toLowerCase() === USA_ATTENDANT_EMAIL.toLowerCase();
}

export type CurrencyMode = "BRL" | "USD";

export function getCurrencyModeForEmail(email?: string | null): CurrencyMode {
  return isUSDCurrencyEmail(email) ? "USD" : "BRL";
}

export function getCurrencySymbol(email?: string | null): string {
  return isUSDCurrencyEmail(email) ? "$" : "R$";
}

export function formatCurrencyForEmail(
  value: number | string | null | undefined,
  email?: string | null,
): string {
  if (value === null || value === undefined) return "-";
  const n =
    typeof value === "number"
      ? value
      : Number(String(value).replace(/[^\d.,-]/g, "").replace(",", "."));
  if (!Number.isFinite(n)) return "-";
  if (isUSDCurrencyEmail(email)) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(n);
  }
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(n);
}

export function formatCurrencyDigitsForEmail(
  digits: string,
  email?: string | null,
): string {
  const cleaned = String(digits ?? "").replace(/\D/g, "");
  if (!cleaned) return "";
  if (isUSDCurrencyEmail(email)) {
    const intPart = cleaned.slice(0, -2) || "0";
    const cents = cleaned.slice(-2).padStart(2, "0");
    return "$" + Number(intPart).toLocaleString("en-US") + "." + cents;
  }
  const intPart = cleaned.slice(0, -2) || "0";
  const cents = cleaned.slice(-2).padStart(2, "0");
  return "R$" + Number(intPart).toLocaleString("pt-BR") + "," + cents;
}

export function parseCurrencyToNumberForEmail(
  v: string,
  email?: string | null,
): number | null {
  if (!v) return null;
  if (isUSDCurrencyEmail(email)) {
    const cleaned = String(v).replace(/[^0-9.-]/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  const cleaned = String(v).replace(/[^0-9,-]/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
