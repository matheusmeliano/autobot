type ZonedDateTimeInput = {
  date: string;
  time: string;
  timeZone: string;
};

type CityTimeZoneRule = {
  timeZone: string;
  country: "BR" | "US";
  keywords: string[];
};

export type CityTimeZoneResolution = {
  city: string;
  normalizedCity: string;
  timeZone: string;
  teacherTimeZone: string;
  country: "BR" | "US" | null;
  source: "city_match" | "phone_country_fallback";
};

export const PROFESSOR_TIME_ZONE = "America/Cuiaba";

function partsToMap(parts: Intl.DateTimeFormatPart[]) {
  const m: Record<string, string> = {};
  for (const p of parts) {
    if (p.type === "literal") continue;
    m[p.type] = p.value;
  }
  return m;
}

export function zonedDateTimeToUtcIso({ date, time, timeZone }: ZonedDateTimeInput) {
  const [y, mo, da] = date.split("-").map((n) => Number(n));
  const [hh, mm] = time.split(":").map((n) => Number(n));
  if (!y || !mo || !da || Number.isNaN(hh) || Number.isNaN(mm)) {
    throw new Error("Data/hora inválida");
  }

  const wantUtc = Date.UTC(y, mo - 1, da, hh, mm, 0);
  let guess = wantUtc;
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  for (let i = 0; i < 3; i++) {
    const p = partsToMap(fmt.formatToParts(new Date(guess)));
    const gotUtc = Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour),
      Number(p.minute),
      Number(p.second),
    );
    const diff = wantUtc - gotUtc;
    if (diff === 0) break;
    guess += diff;
  }

  return new Date(guess).toISOString();
}

export const BRAZIL_TIMEZONES = [
  "America/Noronha",
  "America/Sao_Paulo",
  "America/Araguaina",
  "America/Bahia",
  "America/Belem",
  "America/Fortaleza",
  "America/Maceio",
  "America/Recife",
  "America/Santarem",
  "America/Boa_Vista",
  "America/Campo_Grande",
  "America/Cuiaba",
  "America/Porto_Velho",
  "America/Manaus",
  "America/Eirunepe",
  "America/Rio_Branco",
] as const;

export type BrazilTimeZone = (typeof BRAZIL_TIMEZONES)[number];

const CITY_TIME_ZONE_RULES: CityTimeZoneRule[] = [
  {
    timeZone: "America/Cuiaba",
    country: "BR",
    keywords: [
      "cuiaba",
      "varzea grande",
      "rondonopolis",
      "sinop",
      "caceres",
      "mato grosso",
    ],
  },
  {
    timeZone: "America/Campo_Grande",
    country: "BR",
    keywords: [
      "campo grande",
      "dourados",
      "tres lagoas",
      "ponta pora",
      "mato grosso do sul",
    ],
  },
  {
    timeZone: "America/Sao_Paulo",
    country: "BR",
    keywords: [
      "sao paulo",
      "campinas",
      "sao jose dos campos",
      "sorocaba",
      "santos",
      "ribeirao preto",
      "rio de janeiro",
      "niteroi",
      "petropolis",
      "belo horizonte",
      "uberlandia",
      "juiz de fora",
      "brasilia",
      "goiania",
      "anapolis",
      "curitiba",
      "londrina",
      "maringa",
      "porto alegre",
      "caxias do sul",
      "florianopolis",
      "joinville",
      "blumenau",
      "vitoria",
      "vila velha",
    ],
  },
  {
    timeZone: "America/Fortaleza",
    country: "BR",
    keywords: [
      "fortaleza",
      "recife",
      "salvador",
      "maceio",
      "joao pessoa",
      "natal",
      "teresina",
      "sao luis",
      "aracaju",
    ],
  },
  {
    timeZone: "America/Belem",
    country: "BR",
    keywords: [
      "belem",
      "macapa",
      "palmas",
      "santarem",
    ],
  },
  {
    timeZone: "America/Manaus",
    country: "BR",
    keywords: [
      "manaus",
      "boa vista",
    ],
  },
  {
    timeZone: "America/Porto_Velho",
    country: "BR",
    keywords: ["porto velho"],
  },
  {
    timeZone: "America/Rio_Branco",
    country: "BR",
    keywords: ["rio branco", "cruzeiro do sul"],
  },
  {
    timeZone: "America/New_York",
    country: "US",
    keywords: [
      "new york",
      "nyc",
      "orlando",
      "miami",
      "tampa",
      "jacksonville",
      "boston",
      "philadelphia",
      "washington",
      "atlanta",
      "charlotte",
      "raleigh",
    ],
  },
  {
    timeZone: "America/Chicago",
    country: "US",
    keywords: [
      "chicago",
      "houston",
      "dallas",
      "austin",
      "san antonio",
      "nashville",
      "new orleans",
      "minneapolis",
    ],
  },
  {
    timeZone: "America/Denver",
    country: "US",
    keywords: ["denver", "salt lake city", "albuquerque"],
  },
  {
    timeZone: "America/Phoenix",
    country: "US",
    keywords: ["phoenix", "scottsdale", "mesa"],
  },
  {
    timeZone: "America/Los_Angeles",
    country: "US",
    keywords: [
      "los angeles",
      "san diego",
      "san francisco",
      "seattle",
      "las vegas",
      "sacramento",
      "portland",
    ],
  },
  {
    timeZone: "America/Anchorage",
    country: "US",
    keywords: ["anchorage"],
  },
  {
    timeZone: "Pacific/Honolulu",
    country: "US",
    keywords: ["honolulu"],
  },
];

function normalizeLocationText(value: string) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function locationMatchesKeyword(normalizedLocation: string, keyword: string) {
  const normalizedKeyword = normalizeLocationText(keyword);
  if (!normalizedKeyword) return false;
  return new RegExp(`(?:^|\\s)${escapeRegExp(normalizedKeyword)}(?:\\s|$)`, "i").test(normalizedLocation);
}

function normalizePhoneDigits(phone: string | null | undefined) {
  return String(phone ?? "").replace(/\D/g, "");
}

export function inferTimeZoneFromPhoneCountryCode(phone: string | null | undefined) {
  const digits = normalizePhoneDigits(phone);
  if (digits.startsWith("55")) {
    return {
      timeZone: "America/Sao_Paulo",
      country: "BR" as const,
    };
  }
  if (digits.startsWith("1")) {
    return {
      timeZone: "America/New_York",
      country: "US" as const,
    };
  }
  return null;
}

export function resolveTimeZoneFromCityInput(params: {
  city: string;
  phone?: string | null;
}) {
  const rawCity = String(params.city ?? "").trim();
  const normalizedCity = normalizeLocationText(rawCity);
  if (!normalizedCity) return null;

  for (const rule of CITY_TIME_ZONE_RULES) {
    if (rule.keywords.some((keyword) => locationMatchesKeyword(normalizedCity, keyword))) {
      return {
        city: rawCity.replace(/\s+/g, " ").trim(),
        normalizedCity,
        timeZone: rule.timeZone,
        teacherTimeZone: PROFESSOR_TIME_ZONE,
        country: rule.country,
        source: "city_match" as const,
      };
    }
  }

  const phoneFallback = inferTimeZoneFromPhoneCountryCode(params.phone);
  if (!phoneFallback) return null;

  return {
    city: rawCity.replace(/\s+/g, " ").trim(),
    normalizedCity,
    timeZone: phoneFallback.timeZone,
    teacherTimeZone: PROFESSOR_TIME_ZONE,
    country: phoneFallback.country,
    source: "phone_country_fallback" as const,
  };
}

export function formatUtcIsoInTimeZone(params: {
  iso: string;
  timeZone: string;
  locale?: string;
  includeDate?: boolean;
}) {
  const date = new Date(params.iso);
  if (Number.isNaN(date.getTime())) return String(params.iso ?? "");
  return new Intl.DateTimeFormat(params.locale ?? "pt-BR", {
    timeZone: params.timeZone,
    ...(params.includeDate === false ? {} : { dateStyle: "short" }),
    timeStyle: "short",
  }).format(date);
}
