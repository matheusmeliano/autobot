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

function normalizeToNumber(v: string, email?: string | null): number {
  const cleaned = String(v ?? "").replace(/[^\d.,-]/g, "");
  if (!cleaned || cleaned === "-") return NaN;
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  if (lastComma === -1 && lastDot === -1) {
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : NaN;
  }
  const hasBoth = lastComma !== -1 && lastDot !== -1;
  if (hasBoth) {
    const decimalSep = lastComma > lastDot ? "," : ".";
    const thousandSep = decimalSep === "," ? "." : ",";
    const asDotDecimal =
      cleaned.split(thousandSep).join("").replace(decimalSep, ".");
    const n = Number(asDotDecimal);
    return Number.isFinite(n) ? n : NaN;
  }
  const sepIndex = Math.max(lastComma, lastDot);
  const sep = sepIndex === lastComma ? "," : ".";
  const afterSep = cleaned.length - sepIndex - 1;
  if (afterSep === 2) {
    const asDotDecimal = cleaned.replace(sep, ".");
    const n = Number(asDotDecimal);
    return Number.isFinite(n) ? n : NaN;
  }
  if (afterSep === 3 && sep === ",") {
    const n = Number(cleaned.replace(/,/g, ""));
    return Number.isFinite(n) ? n : NaN;
  }
  if (afterSep === 3 && sep === ".") {
    const n = Number(cleaned.replace(/\./g, ""));
    return Number.isFinite(n) ? n : NaN;
  }
  const n = Number(cleaned.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

export function formatCurrencyForEmail(
  value: number | string | null | undefined,
  email?: string | null,
): string {
  if (value === null || value === undefined) return "-";
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else {
    n = normalizeToNumber(String(value), email);
  }
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
  const raw = String(digits ?? "");
  const cleaned = raw.replace(/\D/g, "");
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
  const n = normalizeToNumber(v, email);
  return Number.isFinite(n) ? n : null;
}

export function numericToDigitsString(value: number | string | null): string {
  if (value === null || value === undefined) return "";
  const n =
    typeof value === "number"
      ? value
      : Number(String(value).replace(/[^\d.,-]/g, "").replace(",", "."));
  if (!Number.isFinite(n)) return "";
  const rounded = Math.round(n * 100);
  const abs = String(Math.abs(rounded)).padStart(3, "0");
  return (rounded < 0 ? "-" : "") + abs;
}
