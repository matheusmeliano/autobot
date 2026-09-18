"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  formatCurrencyForEmail,
  formatCurrencyDigitsForEmail,
  isUSDCurrencyEmail,
  parseCurrencyToNumberForEmail,
} from "./currency";

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
  return isUSDCurrencyEmail(useCurrentUserEmail());
}

export function useCurrencySymbolValue(): string {
  return useIsUSDCurrency() ? "$" : "R$";
}

export function useFormatCurrency(): (
  v: number | string | null | undefined,
) => string {
  const email = useCurrentUserEmail();
  return (v) => formatCurrencyForEmail(v, email);
}

export function useFormatCurrencyDigits(): (digits: string) => string {
  const email = useCurrentUserEmail();
  return (digits) => formatCurrencyDigitsForEmail(digits, email);
}

export function useParseCurrencyToNumber(): (v: string) => number | null {
  const email = useCurrentUserEmail();
  return (v) => parseCurrencyToNumberForEmail(v, email);
}
