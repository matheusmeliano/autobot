export type SupportedPhoneCountry = "BR" | "US" | "PT";

type FormatPhoneNumberOptions = {
  defaultCountry?: SupportedPhoneCountry | null;
  includeCountryCode?: boolean;
};

const COUNTRY_CODE_BY_COUNTRY: Record<SupportedPhoneCountry, string> = {
  BR: "55",
  US: "1",
  PT: "351",
};

const MAX_LOCAL_DIGITS: Record<SupportedPhoneCountry, number> = {
  BR: 11,
  US: 10,
  PT: 9,
};

export function normalizePhoneDigits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "").trim();
}

export function detectPhoneCountry(
  value: unknown,
  fallbackCountry?: SupportedPhoneCountry | null,
): SupportedPhoneCountry | null {
  const raw = String(value ?? "").trim();
  const digits = normalizePhoneDigits(raw);
  if (!digits) return fallbackCountry ?? null;

  const hasExplicitPlus = raw.startsWith("+");

  if (hasExplicitPlus || (digits.startsWith("351") && digits.length > MAX_LOCAL_DIGITS.PT)) {
    if (digits.startsWith("351")) return "PT";
  }

  if (hasExplicitPlus || (digits.startsWith("55") && digits.length > MAX_LOCAL_DIGITS.BR)) {
    if (digits.startsWith("55")) return "BR";
  }

  if (hasExplicitPlus || (digits.startsWith("1") && digits.length > MAX_LOCAL_DIGITS.US)) {
    if (digits.startsWith("1")) return "US";
  }

  return fallbackCountry ?? null;
}

function stripCountryCode(
  digits: string,
  country: SupportedPhoneCountry,
  raw: string,
): string {
  const code = COUNTRY_CODE_BY_COUNTRY[country];
  const maxLocal = MAX_LOCAL_DIGITS[country];
  if (digits.startsWith(code) && (raw.trim().startsWith("+") || digits.length > maxLocal)) {
    return digits.slice(code.length);
  }
  return digits;
}

function formatBrazilPhone(localDigits: string, includeCountryCode: boolean): string {
  const local = localDigits.slice(0, MAX_LOCAL_DIGITS.BR);
  const area = local.slice(0, 2);
  const subscriber = local.slice(2);
  const prefix = includeCountryCode ? "+55 " : "";

  if (!local) return includeCountryCode ? "+55" : "";
  if (local.length <= 2) return `${prefix}(${area}`;

  const base = `${prefix}(${area})`;
  if (!subscriber) return base;
  if (subscriber.length <= 4) return `${base} ${subscriber}`;

  const isMobile = subscriber.length > 8 || subscriber.startsWith("9");
  if (isMobile) {
    if (subscriber.length <= 5) return `${base} ${subscriber}`;
    return `${base} ${subscriber.slice(0, 5)}-${subscriber.slice(5, 9)}`;
  }

  return `${base} ${subscriber.slice(0, 4)}-${subscriber.slice(4, 8)}`;
}

function formatUsPhone(localDigits: string, includeCountryCode: boolean): string {
  const local = localDigits.slice(0, MAX_LOCAL_DIGITS.US);
  const area = local.slice(0, 3);
  const part1 = local.slice(3, 6);
  const part2 = local.slice(6, 10);
  const prefix = includeCountryCode ? "+1 " : "";

  if (!local) return includeCountryCode ? "+1" : "";
  if (local.length <= 3) return `${prefix}(${area}`;
  if (local.length <= 6) return `${prefix}(${area}) ${part1}`;
  return `${prefix}(${area}) ${part1}-${part2}`;
}

function formatPortugalPhone(localDigits: string, includeCountryCode: boolean): string {
  const local = localDigits.slice(0, MAX_LOCAL_DIGITS.PT);
  const part1 = local.slice(0, 3);
  const part2 = local.slice(3, 6);
  const part3 = local.slice(6, 9);
  const prefix = includeCountryCode ? "+351 " : "";

  if (!local) return includeCountryCode ? "+351" : "";
  if (local.length <= 3) return `${prefix}${part1}`;
  if (local.length <= 6) return `${prefix}${part1} ${part2}`;
  return `${prefix}${part1} ${part2} ${part3}`;
}

export function formatPhoneNumber(
  value: unknown,
  options: FormatPhoneNumberOptions = {},
): string {
  const raw = String(value ?? "").trim();
  const digits = normalizePhoneDigits(raw);
  if (!digits) return "";

  const country = detectPhoneCountry(raw, options.defaultCountry ?? null);
  if (!country) {
    return raw || digits;
  }

  const explicitInternational =
    raw.startsWith("+") ||
    (digits.startsWith(COUNTRY_CODE_BY_COUNTRY[country]) &&
      digits.length > MAX_LOCAL_DIGITS[country]);
  const includeCountryCode = options.includeCountryCode ?? explicitInternational;
  const localDigits = stripCountryCode(digits, country, raw);

  if (country === "BR") return formatBrazilPhone(localDigits, includeCountryCode);
  if (country === "US") return formatUsPhone(localDigits, includeCountryCode);
  return formatPortugalPhone(localDigits, includeCountryCode);
}
