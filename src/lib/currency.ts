import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

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
  const n = typeof value === "number" ? value : Number(String(value).replace(/[^\d.,-]/g, "").replace(",", "."));
  if (!Number.isFinite(n)) return "-";
  if (isUSDCurrencyEmail(email)) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
  }
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
}

export function useCurrentUserEmail(): string {
  const [email, setEmail] = useState<string>("");
  useEffect(() => {
    let active = true;
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data }) => {
      if (active) setEmail(data.user?.email ?? "");
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_ev, session) => {
      if (active) setEmail(session?.user?.email ?? "");
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);
  return email;
}

export function useIsUSDCurrency(): boolean {
  const email = useCurrentUserEmail();
  return isUSDCurrencyEmail(email);
}

export function useCurrencyMode(): CurrencyMode {
  const isUSD = useIsUSDCurrency();
  return isUSD ? "USD" : "BRL";
}

export function useCurrencySymbolValue(): string {
  const isUSD = useIsUSDCurrency();
  return isUSD ? "$" : "R$";
}

export function useFormatCurrency(): (v: number | string | null | undefined) => string {
  const isUSD = useIsUSDCurrency();
  return (v) => {
    if (v === null || v === undefined) return "-";
    const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.,-]/g, "").replace(",", "."));
    if (!Number.isFinite(n)) return "-";
    if (isUSD) {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
    }
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
  };
}

export function formatCurrencyDigitsForEmail(digits: string, email?: string | null): string {
  const cleaned = digits.replace(/\D/g, "");
  if (!cleaned) return "";
  if (isUSDCurrencyEmail(email)) {
    const intPart = cleaned.slice(0, -2) || "0";
    const cents = cleaned.slice(-2).padStart(2, "0");
    const withCommas = Number(intPart).toLocaleString("en-US");
    return `$${withCommas}.${cents}`;
  }
  const intPart = cleaned.slice(0, -2) || "0";
  const cents = cleaned.slice(-2).padStart(2, "0");
  const withDots = Number(intPart).toLocaleString("pt-BR");
  return `R$${withDots},${cents}`;
}

export function parseCurrencyToNumberForEmail(v: string, email?: string | null): number | null {
  if (!v) return null;
  if (isUSDCurrencyEmail(email)) {
    const cleaned = v.replace(/[^0-9.-]/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  const cleaned = v.replace(/[^0-9,-]/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
