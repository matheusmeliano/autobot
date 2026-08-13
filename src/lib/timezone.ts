type ZonedDateTimeInput = {
  date: string;
  time: string;
  timeZone: string;
};

type CityTimeZoneRule = {
  timeZone: string;
  country: "BR" | "US";
  keywords: string[];
  stateKeywords?: string[];
};

export type CityTimeZoneResolution = {
  city: string;
  state: string | null;
  normalizedCity: string;
  normalizedState: string | null;
  timeZone: string;
  teacherTimeZone: string;
  country: "BR" | "US" | null;
  source: "city_match" | "state_match" | "phone_country_fallback";
};

export type StateTimeZoneResolution = {
  state: string;
  normalizedState: string;
  timeZone: string;
  country: "BR" | "US";
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
      "campo novo do parecis",
      "barra do garcas",
      "lucas do rio verde",
      "primavera do leste",
      "alta floresta",
      "tangara da serra",
      "campo verde",
      "sorriso",
      "mato grosso",
    ],
    stateKeywords: ["mato grosso", "mt"],
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
    stateKeywords: ["mato grosso do sul", "ms"],
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
    stateKeywords: [
      "sao paulo",
      "sp",
      "rio de janeiro",
      "rj",
      "minas gerais",
      "mg",
      "distrito federal",
      "df",
      "goias",
      "go",
      "parana",
      "pr",
      "rio grande do sul",
      "rs",
      "santa catarina",
      "sc",
      "espirito santo",
      "es",
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
    stateKeywords: [
      "ceara",
      "ce",
      "pernambuco",
      "pe",
      "bahia",
      "ba",
      "alagoas",
      "al",
      "paraiba",
      "pb",
      "rio grande do norte",
      "rn",
      "piaui",
      "pi",
      "maranhao",
      "ma",
      "sergipe",
      "se",
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
    stateKeywords: ["para", "pa", "amapa", "ap", "tocantins", "to"],
  },
  {
    timeZone: "America/Manaus",
    country: "BR",
    keywords: [
      "manaus",
      "boa vista",
    ],
    stateKeywords: ["amazonas", "am", "roraima", "rr"],
  },
  {
    timeZone: "America/Porto_Velho",
    country: "BR",
    keywords: ["porto velho"],
    stateKeywords: ["rondonia", "ro"],
  },
  {
    timeZone: "America/Rio_Branco",
    country: "BR",
    keywords: ["rio branco", "cruzeiro do sul"],
    stateKeywords: ["acre", "ac"],
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
      "newark",
      "buffalo",
      "albany",
      "rochester",
      "hartford",
      "providence",
      "portland me",
      "portland maine",
      "manchester nh",
      "burlington vt",
      "dover de",
      "wilmington de",
      "baltimore",
      "annapolis",
      "richmond",
      "virginia beach",
      "charleston sc",
      "columbia sc",
      "savannah",
      "augusta ga",
      "raleigh nc",
      "greensboro",
      "winston salem",
      "durham",
      "asheville",
      "worcester",
      "springfield ma",
      "cambridge",
      "lowell",
      "quincy",
      "lynn",
      "somerville",
      "pittsburgh",
      "allentown",
      "erie",
      "lancaster pa",
      "scranton",
      "lehigh acres",
      "fort lauderdale",
      "west palm beach",
      "daytona beach",
      "tallahassee",
      "gainesville",
      "augusta me",
      "bangor",
      "portsmouth nh",
      "concord nh",
      "montpelier",
      "rutland vt",
      "stamford",
      "bridgeport",
      "waterbury ct",
      "new haven",
      "westerly",
      "newport ri",
      "dover delaware",
      "new castle de",
      "frederick md",
      "gaithersburg",
      "rockville md",
      "bethesda",
      "silver spring",
      "norfolk va",
      "chesapeake",
      "newport news",
      "alexandria va",
      "macon",
      "savannah ga",
      "athens ga",
      "columbus ga",
      "greenville sc",
      "myrtle beach",
      "spartanburg sc",
      "charleston wv",
      "huntington wv",
      "parkersburg wv",
      "louisville ky",
      "lexington",
      "bowling green",
      "knoxville",
      "chattanooga",
      "indianapolis in",
      "fort wayne in",
      "south bend in",
      "detroit mi",
      "grand rapids mi",
      "warren mi",
      "ann arbor",
      "lansing",
      "flint",
      "columbus ohio",
      "cleveland oh",
      "cincinnati oh",
      "toledo oh",
      "akron oh",
      "dayton oh",
      "youngstown",
      "canton oh",
      "parma",
      "greenville nc",
      "winston salem nc",
      "fayetteville nc",
      "burlington nc",
      "wilmington nc",
      "high point nc",
      "concord nc",
      "gastonia",
      "saint petersburg",
      "st petersburg",
      "hialeah",
      "fort myers",
      "brevard",
      "pensacola",
      "lakeland",
      "cape coral",
      "naples fl",
      "ocala",
      "sarasota",
      "melbourne fl",
      "kissimmee",
    ],
    stateKeywords: [
      "florida",
      "fl",
      "new york",
      "ny",
      "massachusetts",
      "ma",
      "pennsylvania",
      "pa",
      "district of columbia",
      "dc",
      "georgia",
      "ga",
      "north carolina",
      "nc",
      "connecticut",
      "ct",
      "rhode island",
      "ri",
      "maine",
      "me",
      "new hampshire",
      "nh",
      "vermont",
      "vt",
      "delaware",
      "de",
      "maryland",
      "md",
      "virginia",
      "va",
      "west virginia",
      "wv",
      "south carolina",
      "sc",
      "new jersey",
      "nj",
      "ohio",
      "oh",
      "michigan",
      "mi",
      "indiana",
      "in",
      "kentucky",
      "ky",
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
      "nashville tn",
      "memphis",
      "memphis tn",
      "clarksville tn",
      "knoxville tn",
      "chattanooga tn",
      "new orleans",
      "minneapolis",
      "st louis",
      "kansas city",
      "oklahoma city",
      "tulsa",
      "milwaukee",
      "madison",
      "green bay",
      "evansville",
      "birmingham",
      "birmingham al",
      "montgomery",
      "montgomery al",
      "mobile",
      "mobile al",
      "huntsville",
      "tuscaloosa",
      "jackson ms",
      "des moines",
      "omaha",
      "lincoln ne",
      "sioux falls",
      "rapid city",
      "bismarck",
      "fargo",
      "wichita",
      "topeka",
      "little rock",
      "fayetteville ar",
    ],
    stateKeywords: [
      "texas",
      "tx",
      "louisiana",
      "la",
      "minnesota",
      "mn",
      "illinois",
      "il",
      "missouri",
      "mo",
      "kansas",
      "ks",
      "oklahoma",
      "ok",
      "wisconsin",
      "wi",
      "iowa",
      "ia",
      "nebraska",
      "ne",
      "south dakota",
      "sd",
      "north dakota",
      "nd",
      "arkansas",
      "ar",
      "tennessee",
      "tn",
      "alabama",
      "al",
      "mississippi",
      "ms",
    ],
  },
  {
    timeZone: "America/Denver",
    country: "US",
    keywords: [
      "denver",
      "salt lake city",
      "albuquerque",
      "colorado springs",
      "aurora co",
      "fort collins",
      "boulder",
      "provo",
      "ogden",
      "santa fe",
      "las cruces",
      "cheyenne",
      "casper",
      "billings",
      "bozeman",
      "helena",
      "boise",
      "idaho falls",
      "nampa",
      "pocatello",
      "twin falls",
    ],
    stateKeywords: [
      "colorado",
      "co",
      "utah",
      "ut",
      "new mexico",
      "nm",
      "wyoming",
      "wy",
      "montana",
      "mt",
      "idaho",
      "id",
    ],
  },
  {
    timeZone: "America/Phoenix",
    country: "US",
    keywords: ["phoenix", "scottsdale", "mesa", "tucson", "chandler", "tempe", "gilbert"],
    stateKeywords: ["arizona", "az"],
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
      "san jose",
      "oakland",
      "fresno",
      "long beach",
      "anaheim",
      "riverside",
      "stockton",
      "bakersfield",
      "tacoma",
      "spokane",
      "reno",
      "henderson",
      "eugene",
      "salem or",
    ],
    stateKeywords: ["california", "ca", "washington", "wa", "nevada", "nv", "oregon", "or"],
  },
  {
    timeZone: "America/Anchorage",
    country: "US",
    keywords: ["anchorage", "fairbanks", "juneau", "sitka"],
    stateKeywords: ["alaska", "ak"],
  },
  {
    timeZone: "Pacific/Honolulu",
    country: "US",
    keywords: ["honolulu", "hilo", "kailua", "waianae", "pearl city"],
    stateKeywords: ["hawaii", "hi"],
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

const LOCATION_PREPROCESS_PATTERNS: Array<RegExp> = [
  /\bmoro\s+em\b/gi,
  /\bmoro\s+no\s+estado\s+de\b/gi,
  /\bmoro\s+na\s+cidade\s+de\b/gi,
  /\bmoro\s+na\b/gi,
  /\bmoro\s+no\b/gi,
  /\bsou\s+de\b/gi,
  /\bsou\s+do\s+estado\s+de\b/gi,
  /\bsou\s+da\s+cidade\s+de\b/gi,
  /\bsou\s+do\b/gi,
  /\bsou\s+da\b/gi,
  /\bvenho\s+de\b/gi,
  /\bvenho\s+do\s+estado\s+de\b/gi,
  /\bvenho\s+do\b/gi,
  /\bvenho\s+da\s+cidade\s+de\b/gi,
  /\bvenho\s+da\b/gi,
  /\bresido\s+em\b/gi,
  /\bresido\s+no\s+estado\s+de\b/gi,
  /\bresido\s+na\s+cidade\s+de\b/gi,
  /\bresido\s+no\b/gi,
  /\bresido\s+na\b/gi,
  /\bvivo\s+em\b/gi,
  /\bvivo\s+no\s+estado\s+de\b/gi,
  /\bvivo\s+na\s+cidade\s+de\b/gi,
  /\bvivo\s+no\b/gi,
  /\bvivo\s+na\b/gi,
  /\bno\s+estado\s+de\b/gi,
  /\bna\s+cidade\s+de\b/gi,
  /\bestado\s+de\b/gi,
  /\bcidade\s+de\b/gi,
  /\bo\s+estado\b/gi,
  /\ba\s+cidade\b/gi,
];

function extractLocationCandidates(raw: string): string[] {
  const normalized = normalizeLocationText(raw);
  if (!normalized) return [];

  const candidates = new Set<string>();
  candidates.add(normalized);

  let stripped = normalized;
  for (const pattern of LOCATION_PREPROCESS_PATTERNS) {
    stripped = stripped.replace(pattern, " ");
  }
  stripped = stripped.replace(/\s+/g, " ").trim();
  if (stripped && stripped !== normalized) {
    candidates.add(stripped);
  }

  for (const separator of [/\s*,\s*/g, /\s+e\s+/g, /\s+-\s+/g]) {
    const parts = stripped.split(separator).map((part) => part.trim()).filter(Boolean);
    for (const part of parts) {
      if (part) candidates.add(part);
    }
  }

  for (const separator of [/\s*,\s*/g, /\s+e\s+/g, /\s+-\s+/g]) {
    const parts = normalized.split(separator).map((part) => part.trim()).filter(Boolean);
    for (const part of parts) {
      if (part) candidates.add(part);
    }
  }

  return Array.from(candidates);
}

function candidateMatchesKeyword(candidates: string[], keyword: string): boolean {
  return candidates.some((candidate) => locationMatchesKeyword(candidate, keyword));
}

function normalizePhoneDigits(phone: string | null | undefined) {
  return String(phone ?? "").replace(/\D/g, "");
}

const BRAZIL_DDD_TO_STATE_AND_TIMEZONE: Record<string, { state: string; normalizedState: string; uf: string; timeZone: BrazilTimeZone }> = {
  "11": { state: "São Paulo", normalizedState: "sao paulo", uf: "SP", timeZone: "America/Sao_Paulo" },
  "12": { state: "São Paulo", normalizedState: "sao paulo", uf: "SP", timeZone: "America/Sao_Paulo" },
  "13": { state: "São Paulo", normalizedState: "sao paulo", uf: "SP", timeZone: "America/Sao_Paulo" },
  "14": { state: "São Paulo", normalizedState: "sao paulo", uf: "SP", timeZone: "America/Sao_Paulo" },
  "15": { state: "São Paulo", normalizedState: "sao paulo", uf: "SP", timeZone: "America/Sao_Paulo" },
  "16": { state: "São Paulo", normalizedState: "sao paulo", uf: "SP", timeZone: "America/Sao_Paulo" },
  "17": { state: "São Paulo", normalizedState: "sao paulo", uf: "SP", timeZone: "America/Sao_Paulo" },
  "18": { state: "São Paulo", normalizedState: "sao paulo", uf: "SP", timeZone: "America/Sao_Paulo" },
  "19": { state: "São Paulo", normalizedState: "sao paulo", uf: "SP", timeZone: "America/Sao_Paulo" },
  "21": { state: "Rio de Janeiro", normalizedState: "rio de janeiro", uf: "RJ", timeZone: "America/Sao_Paulo" },
  "22": { state: "Rio de Janeiro", normalizedState: "rio de janeiro", uf: "RJ", timeZone: "America/Sao_Paulo" },
  "24": { state: "Rio de Janeiro", normalizedState: "rio de janeiro", uf: "RJ", timeZone: "America/Sao_Paulo" },
  "27": { state: "Espírito Santo", normalizedState: "espirito santo", uf: "ES", timeZone: "America/Sao_Paulo" },
  "28": { state: "Espírito Santo", normalizedState: "espirito santo", uf: "ES", timeZone: "America/Sao_Paulo" },
  "31": { state: "Minas Gerais", normalizedState: "minas gerais", uf: "MG", timeZone: "America/Sao_Paulo" },
  "32": { state: "Minas Gerais", normalizedState: "minas gerais", uf: "MG", timeZone: "America/Sao_Paulo" },
  "33": { state: "Minas Gerais", normalizedState: "minas gerais", uf: "MG", timeZone: "America/Sao_Paulo" },
  "34": { state: "Minas Gerais", normalizedState: "minas gerais", uf: "MG", timeZone: "America/Sao_Paulo" },
  "35": { state: "Minas Gerais", normalizedState: "minas gerais", uf: "MG", timeZone: "America/Sao_Paulo" },
  "37": { state: "Minas Gerais", normalizedState: "minas gerais", uf: "MG", timeZone: "America/Sao_Paulo" },
  "38": { state: "Minas Gerais", normalizedState: "minas gerais", uf: "MG", timeZone: "America/Sao_Paulo" },
  "41": { state: "Paraná", normalizedState: "parana", uf: "PR", timeZone: "America/Sao_Paulo" },
  "42": { state: "Paraná", normalizedState: "parana", uf: "PR", timeZone: "America/Sao_Paulo" },
  "43": { state: "Paraná", normalizedState: "parana", uf: "PR", timeZone: "America/Sao_Paulo" },
  "44": { state: "Paraná", normalizedState: "parana", uf: "PR", timeZone: "America/Sao_Paulo" },
  "45": { state: "Paraná", normalizedState: "parana", uf: "PR", timeZone: "America/Sao_Paulo" },
  "46": { state: "Paraná", normalizedState: "parana", uf: "PR", timeZone: "America/Sao_Paulo" },
  "47": { state: "Santa Catarina", normalizedState: "santa catarina", uf: "SC", timeZone: "America/Sao_Paulo" },
  "48": { state: "Santa Catarina", normalizedState: "santa catarina", uf: "SC", timeZone: "America/Sao_Paulo" },
  "49": { state: "Santa Catarina", normalizedState: "santa catarina", uf: "SC", timeZone: "America/Sao_Paulo" },
  "51": { state: "Rio Grande do Sul", normalizedState: "rio grande do sul", uf: "RS", timeZone: "America/Sao_Paulo" },
  "53": { state: "Rio Grande do Sul", normalizedState: "rio grande do sul", uf: "RS", timeZone: "America/Sao_Paulo" },
  "54": { state: "Rio Grande do Sul", normalizedState: "rio grande do sul", uf: "RS", timeZone: "America/Sao_Paulo" },
  "55": { state: "Rio Grande do Sul", normalizedState: "rio grande do sul", uf: "RS", timeZone: "America/Sao_Paulo" },
  "61": { state: "Distrito Federal", normalizedState: "distrito federal", uf: "DF", timeZone: "America/Sao_Paulo" },
  "62": { state: "Goiás", normalizedState: "goias", uf: "GO", timeZone: "America/Sao_Paulo" },
  "63": { state: "Tocantins", normalizedState: "tocantins", uf: "TO", timeZone: "America/Belem" },
  "64": { state: "Goiás", normalizedState: "goias", uf: "GO", timeZone: "America/Sao_Paulo" },
  "65": { state: "Mato Grosso", normalizedState: "mato grosso", uf: "MT", timeZone: "America/Cuiaba" },
  "66": { state: "Mato Grosso", normalizedState: "mato grosso", uf: "MT", timeZone: "America/Cuiaba" },
  "67": { state: "Mato Grosso do Sul", normalizedState: "mato grosso do sul", uf: "MS", timeZone: "America/Campo_Grande" },
  "68": { state: "Acre", normalizedState: "acre", uf: "AC", timeZone: "America/Rio_Branco" },
  "69": { state: "Rondônia", normalizedState: "rondonia", uf: "RO", timeZone: "America/Porto_Velho" },
  "71": { state: "Bahia", normalizedState: "bahia", uf: "BA", timeZone: "America/Bahia" },
  "73": { state: "Bahia", normalizedState: "bahia", uf: "BA", timeZone: "America/Bahia" },
  "74": { state: "Bahia", normalizedState: "bahia", uf: "BA", timeZone: "America/Bahia" },
  "75": { state: "Bahia", normalizedState: "bahia", uf: "BA", timeZone: "America/Bahia" },
  "77": { state: "Bahia", normalizedState: "bahia", uf: "BA", timeZone: "America/Bahia" },
  "79": { state: "Sergipe", normalizedState: "sergipe", uf: "SE", timeZone: "America/Recife" },
  "81": { state: "Pernambuco", normalizedState: "pernambuco", uf: "PE", timeZone: "America/Recife" },
  "82": { state: "Alagoas", normalizedState: "alagoas", uf: "AL", timeZone: "America/Maceio" },
  "83": { state: "Paraíba", normalizedState: "paraiba", uf: "PB", timeZone: "America/Recife" },
  "84": { state: "Rio Grande do Norte", normalizedState: "rio grande do norte", uf: "RN", timeZone: "America/Recife" },
  "85": { state: "Ceará", normalizedState: "ceara", uf: "CE", timeZone: "America/Fortaleza" },
  "86": { state: "Piauí", normalizedState: "piaui", uf: "PI", timeZone: "America/Fortaleza" },
  "87": { state: "Pernambuco", normalizedState: "pernambuco", uf: "PE", timeZone: "America/Recife" },
  "88": { state: "Ceará", normalizedState: "ceara", uf: "CE", timeZone: "America/Fortaleza" },
  "89": { state: "Piauí", normalizedState: "piaui", uf: "PI", timeZone: "America/Fortaleza" },
  "91": { state: "Pará", normalizedState: "para", uf: "PA", timeZone: "America/Belem" },
  "92": { state: "Amazonas", normalizedState: "amazonas", uf: "AM", timeZone: "America/Manaus" },
  "93": { state: "Pará", normalizedState: "para", uf: "PA", timeZone: "America/Belem" },
  "94": { state: "Pará", normalizedState: "para", uf: "PA", timeZone: "America/Belem" },
  "95": { state: "Roraima", normalizedState: "roraima", uf: "RR", timeZone: "America/Manaus" },
  "96": { state: "Amapá", normalizedState: "amapa", uf: "AP", timeZone: "America/Belem" },
  "97": { state: "Amazonas", normalizedState: "amazonas", uf: "AM", timeZone: "America/Manaus" },
  "98": { state: "Maranhão", normalizedState: "maranhao", uf: "MA", timeZone: "America/Fortaleza" },
  "99": { state: "Maranhão", normalizedState: "maranhao", uf: "MA", timeZone: "America/Fortaleza" },
};

export function extractBrazilianDdd(phone: string | null | undefined): string | null {
  const digits = normalizePhoneDigits(phone);
  if (!digits.startsWith("55")) return null;
  const afterCountryCode = digits.slice(2);
  if (afterCountryCode.length < 10) return null;
  const ddd = afterCountryCode.slice(0, 2);
  return ddd || null;
}

export function inferBrazilianLocationFromDdd(phone: string | null | undefined) {
  const ddd = extractBrazilianDdd(phone);
  if (!ddd) return null;
  const mapping = BRAZIL_DDD_TO_STATE_AND_TIMEZONE[ddd];
  if (!mapping) return null;
  return {
    ...mapping,
    country: "BR" as const,
    source: "ddd_mapping" as const,
  };
}

export function inferTimeZoneFromPhoneCountryCode(phone: string | null | undefined) {
  const digits = normalizePhoneDigits(phone);
  if (digits.startsWith("55")) {
    const fromDdd = inferBrazilianLocationFromDdd(phone);
    if (fromDdd) {
      return {
        timeZone: fromDdd.timeZone,
        country: "BR" as const,
      };
    }
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

const US_STATE_CANONICAL_MAP: Record<string, { fullName: string; abbreviation: string; timeZone: string }> = {
  alabama: { fullName: "Alabama", abbreviation: "AL", timeZone: "America/Chicago" },
  alaska: { fullName: "Alaska", abbreviation: "AK", timeZone: "America/Anchorage" },
  arizona: { fullName: "Arizona", abbreviation: "AZ", timeZone: "America/Phoenix" },
  arkansas: { fullName: "Arkansas", abbreviation: "AR", timeZone: "America/Chicago" },
  california: { fullName: "California", abbreviation: "CA", timeZone: "America/Los_Angeles" },
  colorado: { fullName: "Colorado", abbreviation: "CO", timeZone: "America/Denver" },
  connecticut: { fullName: "Connecticut", abbreviation: "CT", timeZone: "America/New_York" },
  delaware: { fullName: "Delaware", abbreviation: "DE", timeZone: "America/New_York" },
  florida: { fullName: "Florida", abbreviation: "FL", timeZone: "America/New_York" },
  georgia: { fullName: "Georgia", abbreviation: "GA", timeZone: "America/New_York" },
  hawaii: { fullName: "Hawaii", abbreviation: "HI", timeZone: "Pacific/Honolulu" },
  idaho: { fullName: "Idaho", abbreviation: "ID", timeZone: "America/Denver" },
  illinois: { fullName: "Illinois", abbreviation: "IL", timeZone: "America/Chicago" },
  indiana: { fullName: "Indiana", abbreviation: "IN", timeZone: "America/New_York" },
  iowa: { fullName: "Iowa", abbreviation: "IA", timeZone: "America/Chicago" },
  kansas: { fullName: "Kansas", abbreviation: "KS", timeZone: "America/Chicago" },
  kentucky: { fullName: "Kentucky", abbreviation: "KY", timeZone: "America/New_York" },
  louisiana: { fullName: "Louisiana", abbreviation: "LA", timeZone: "America/Chicago" },
  maine: { fullName: "Maine", abbreviation: "ME", timeZone: "America/New_York" },
  maryland: { fullName: "Maryland", abbreviation: "MD", timeZone: "America/New_York" },
  massachusetts: { fullName: "Massachusetts", abbreviation: "MA", timeZone: "America/New_York" },
  michigan: { fullName: "Michigan", abbreviation: "MI", timeZone: "America/New_York" },
  minnesota: { fullName: "Minnesota", abbreviation: "MN", timeZone: "America/Chicago" },
  mississippi: { fullName: "Mississippi", abbreviation: "MS", timeZone: "America/Chicago" },
  missouri: { fullName: "Missouri", abbreviation: "MO", timeZone: "America/Chicago" },
  montana: { fullName: "Montana", abbreviation: "MT", timeZone: "America/Denver" },
  nebraska: { fullName: "Nebraska", abbreviation: "NE", timeZone: "America/Chicago" },
  nevada: { fullName: "Nevada", abbreviation: "NV", timeZone: "America/Los_Angeles" },
  "new hampshire": { fullName: "New Hampshire", abbreviation: "NH", timeZone: "America/New_York" },
  "new jersey": { fullName: "New Jersey", abbreviation: "NJ", timeZone: "America/New_York" },
  "new mexico": { fullName: "New Mexico", abbreviation: "NM", timeZone: "America/Denver" },
  "new york": { fullName: "New York", abbreviation: "NY", timeZone: "America/New_York" },
  "north carolina": { fullName: "North Carolina", abbreviation: "NC", timeZone: "America/New_York" },
  "north dakota": { fullName: "North Dakota", abbreviation: "ND", timeZone: "America/Chicago" },
  ohio: { fullName: "Ohio", abbreviation: "OH", timeZone: "America/New_York" },
  oklahoma: { fullName: "Oklahoma", abbreviation: "OK", timeZone: "America/Chicago" },
  oregon: { fullName: "Oregon", abbreviation: "OR", timeZone: "America/Los_Angeles" },
  pennsylvania: { fullName: "Pennsylvania", abbreviation: "PA", timeZone: "America/New_York" },
  "rhode island": { fullName: "Rhode Island", abbreviation: "RI", timeZone: "America/New_York" },
  "south carolina": { fullName: "South Carolina", abbreviation: "SC", timeZone: "America/New_York" },
  "south dakota": { fullName: "South Dakota", abbreviation: "SD", timeZone: "America/Chicago" },
  tennessee: { fullName: "Tennessee", abbreviation: "TN", timeZone: "America/Chicago" },
  texas: { fullName: "Texas", abbreviation: "TX", timeZone: "America/Chicago" },
  utah: { fullName: "Utah", abbreviation: "UT", timeZone: "America/Denver" },
  vermont: { fullName: "Vermont", abbreviation: "VT", timeZone: "America/New_York" },
  virginia: { fullName: "Virginia", abbreviation: "VA", timeZone: "America/New_York" },
  washington: { fullName: "Washington", abbreviation: "WA", timeZone: "America/Los_Angeles" },
  "west virginia": { fullName: "West Virginia", abbreviation: "WV", timeZone: "America/New_York" },
  wisconsin: { fullName: "Wisconsin", abbreviation: "WI", timeZone: "America/Chicago" },
  wyoming: { fullName: "Wyoming", abbreviation: "WY", timeZone: "America/Denver" },
  "district of columbia": { fullName: "District of Columbia", abbreviation: "DC", timeZone: "America/New_York" },
};

const US_STATE_ABBR_LOWER_TO_KEY: Record<string, string> = (() => {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(US_STATE_CANONICAL_MAP)) {
    result[value.abbreviation.toLowerCase()] = key;
  }
  return result;
})();

function lookupUsStateByCandidate(candidate: string): { fullName: string; abbreviation: string; timeZone: string } | null {
  const trimmed = String(candidate ?? "").trim();
  if (!trimmed) return null;
  const abbrOnly = trimmed.replace(/\s+/g, "").toLowerCase();
  if (abbrOnly.length === 2) {
    const key = US_STATE_ABBR_LOWER_TO_KEY[abbrOnly];
    if (key && US_STATE_CANONICAL_MAP[key]) return US_STATE_CANONICAL_MAP[key];
  }
  const normalized = normalizeLocationText(trimmed);
  if (!normalized) return null;
  if (US_STATE_CANONICAL_MAP[normalized]) return US_STATE_CANONICAL_MAP[normalized];
  for (const [key, value] of Object.entries(US_STATE_CANONICAL_MAP)) {
    if (key === normalized) return value;
    if (value.abbreviation.toLowerCase() === abbrOnly) return value;
  }
  return null;
}

export function resolveTimeZoneFromStateInput(params: {
  state: string;
  phone?: string | null;
}) {
  const rawState = String(params.state ?? "").trim();
  if (!rawState) return null;

  const tokens = rawState.split(/\s+/).filter(Boolean);
  if (tokens.length > 6) return null;

  const candidates = extractLocationCandidates(rawState);
  if (!candidates.length) return null;

  const phoneCountry = inferTimeZoneFromPhoneCountryCode(params.phone)?.country ?? null;

  for (const candidate of candidates) {
    const usLookup = lookupUsStateByCandidate(candidate);
    if (usLookup) {
      if (phoneCountry && phoneCountry !== "US") continue;
      return {
        state: usLookup.fullName,
        normalizedState: normalizeLocationText(usLookup.fullName),
        timeZone: usLookup.timeZone,
        country: "US" as const,
      } satisfies StateTimeZoneResolution;
    }
  }

  const matchingRules = CITY_TIME_ZONE_RULES.filter((rule) =>
    rule.stateKeywords?.some((keyword) => candidateMatchesKeyword(candidates, keyword)),
  );

  if (!matchingRules.length) return null;

  const preferredRules = phoneCountry
    ? matchingRules.filter((rule) => rule.country === phoneCountry)
    : matchingRules;
  const selectedRule = preferredRules[0] ?? matchingRules[0] ?? null;
  if (!selectedRule) return null;

  let matchedKeywordLabel = "";
  for (const rule of matchingRules) {
    for (const keyword of rule.stateKeywords ?? []) {
      if (candidateMatchesKeyword(candidates, keyword)) {
        matchedKeywordLabel = keyword;
        break;
      }
    }
    if (matchedKeywordLabel) break;
  }

  if (selectedRule.country === "US" && matchedKeywordLabel) {
    const usCanonical = lookupUsStateByCandidate(matchedKeywordLabel);
    if (usCanonical) {
      return {
        state: usCanonical.fullName,
        normalizedState: normalizeLocationText(usCanonical.fullName),
        timeZone: selectedRule.timeZone,
        country: "US" as const,
      } satisfies StateTimeZoneResolution;
    }
  }

  return {
    state: (matchedKeywordLabel || rawState).replace(/\s+/g, " ").trim(),
    normalizedState: matchedKeywordLabel ? normalizeLocationText(matchedKeywordLabel) : candidates[0] ?? "",
    timeZone: selectedRule.timeZone,
    country: selectedRule.country,
  } satisfies StateTimeZoneResolution;
}

export function resolveTimeZoneFromCityInput(params: {
  city: string;
  state?: string | null;
  phone?: string | null;
  allowPhoneCountryFallback?: boolean;
}) {
  const rawCity = String(params.city ?? "").trim();
  const rawState = String(params.state ?? "").trim();
  if (!rawCity) return null;

  const rawCityTokens = rawCity.split(/\s+/).filter(Boolean);
  if (rawCityTokens.length > 8) return null;

  const cityCandidates = extractLocationCandidates(rawCity);
  const stateCandidates = rawState ? extractLocationCandidates(rawState) : [];
  if (!cityCandidates.length) return null;

  const usStateFromRaw = rawState ? lookupUsStateByCandidate(rawState) : null;

  for (const rule of CITY_TIME_ZONE_RULES) {
    const matchesCity = rule.keywords.some((keyword) => candidateMatchesKeyword(cityCandidates, keyword));
    const matchesState =
      !stateCandidates.length || !rule.stateKeywords?.length
        ? true
        : rule.stateKeywords.some((keyword) => candidateMatchesKeyword(stateCandidates, keyword));
    const matchesStateUsCanonical = usStateFromRaw && rule.country === "US" && rule.timeZone === usStateFromRaw.timeZone ? true : false;

    if (matchesCity && (matchesState || matchesStateUsCanonical)) {
      let matchedCityLabel = "";
      for (const keyword of rule.keywords) {
        if (candidateMatchesKeyword(cityCandidates, keyword)) {
          matchedCityLabel = keyword;
          break;
        }
      }
      let matchedStateLabel = "";
      if (stateCandidates.length) {
        for (const keyword of rule.stateKeywords ?? []) {
          if (candidateMatchesKeyword(stateCandidates, keyword)) {
            matchedStateLabel = keyword;
            break;
          }
        }
      }
      const finalStateUs = usStateFromRaw ?? (matchedStateLabel ? lookupUsStateByCandidate(matchedStateLabel) : null);
      const finalState = finalStateUs
        ? finalStateUs.fullName
        : (matchedStateLabel || rawState).replace(/\s+/g, " ").trim() || null;
      const finalNormalizedState = finalStateUs
        ? normalizeLocationText(finalStateUs.fullName)
        : matchedStateLabel
          ? normalizeLocationText(matchedStateLabel)
          : stateCandidates[0] ?? null;
      return {
        city: (matchedCityLabel || rawCity).replace(/\s+/g, " ").trim(),
        state: finalState,
        normalizedCity: matchedCityLabel ? normalizeLocationText(matchedCityLabel) : cityCandidates[0] ?? "",
        normalizedState: finalNormalizedState,
        timeZone: rule.timeZone,
        teacherTimeZone: PROFESSOR_TIME_ZONE,
        country: rule.country,
        source: "city_match" as const,
      };
    }
  }

  if (params.allowPhoneCountryFallback === false) {
    return null;
  }

  const phoneFallback = inferTimeZoneFromPhoneCountryCode(params.phone);
  const stateCandidatesForFallback = stateCandidates.length ? stateCandidates : cityCandidates;
  const stateResolutionInput = stateCandidates.length
    ? rawState
    : rawCity;
  const stateResolution = stateCandidatesForFallback.length
    ? resolveTimeZoneFromStateInput({
        state: stateResolutionInput,
        phone: params.phone,
      })
    : null;
  if (stateResolution) {
    const resolvedStateUs = stateResolution.country === "US" ? lookupUsStateByCandidate(stateResolution.state) : null;
    return {
      city: rawCity?.replace(/\s+/g, " ").trim() || null,
      state: resolvedStateUs ? resolvedStateUs.fullName : stateResolution.state,
      normalizedCity: cityCandidates[0] ?? null,
      normalizedState: resolvedStateUs
        ? normalizeLocationText(resolvedStateUs.fullName)
        : stateResolution.normalizedState,
      timeZone: stateResolution.timeZone,
      teacherTimeZone: PROFESSOR_TIME_ZONE,
      country: stateResolution.country,
      source: "state_match" as const,
    };
  }
  if (!phoneFallback) return null;

  const finalStateFromRawUs = rawState ? lookupUsStateByCandidate(rawState) : null;
  const finalPhoneFallbackState = finalStateFromRawUs
    ? finalStateFromRawUs.fullName
    : rawState?.replace(/\s+/g, " ").trim() || null;
  const finalPhoneFallbackNormalizedState = finalStateFromRawUs
    ? normalizeLocationText(finalStateFromRawUs.fullName)
    : stateCandidates[0] ?? null;

  return {
    city: null,
    state: finalPhoneFallbackState,
    normalizedCity: null,
    normalizedState: finalPhoneFallbackNormalizedState,
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
