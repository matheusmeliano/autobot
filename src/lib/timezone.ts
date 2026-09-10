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
      "juina",
      "aparecida do taboado",
      "barra do bugres",
      "cuiaba mt",
      "varzea grande mt",
      "rondonopolis mt",
      "sinop mt",
      "primavera do leste mt",
      "lucas do rio verde mt",
      "campo novo do parecis mt",
      "campo verde mt",
      "tangara da serra mt",
      "caceres mt",
      "barra do garcas mt",
      "alta floresta mt",
      "poconé",
      "chapada dos guimaraes",
      "peixoto de azevedo",
      "itaituba",
      "sapezal",
      "tapui",
      "guaranta do norte",
      "juara",
      "nova mutum",
      "santa carmen",
      "pontes e lacerda",
      "comodoro",
      "campos de julio",
      "vila bela da santissima trindade",
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
      "campo grande ms",
      "dourados ms",
      "tres lagoas ms",
      "ponta pora ms",
      "corumba",
      "coxim",
      "maracaju",
      "navirai",
      "jardim ms",
      "sidrolandia",
      "rio brilhante",
      "bonito ms",
      "aquidauana",
      "miranda ms",
      "mundo novo",
      "chapadao do sul",
      "ituacu",
      "costa rica ms",
      "sao gabriel do oeste",
      "ivinhema",
      "paranhos",
      "amambai",
      "tacuru",
      "caarapo",
      "bela vista",
      "figueirao",
      "guia lopes da laguna",
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
      "sao paulo sp",
      "sao paulo capital",
      "campinas sp",
      "guarulhos",
      "sao bernardo do campo",
      "santo andre",
      "sao jose dos campos sp",
      "sao jose do rio preto",
      "ribeirao preto sp",
      "santos sp",
      "sorocaba sp",
      "mogi das cruzes",
      "sao vicente",
      "itajai",
      "itajuba",
      "itu",
      "jundiai",
      "piracicaba",
      "americana sp",
      "sumare",
      "hortolandia",
      "sao carlos",
      "araraquara",
      "franca sp",
      "sao jose do rio preto sp",
      "catanduva",
      "barretos",
      "marilia sp",
      "bauru",
      "botucatu",
      "presidente prudente",
      "santana de parnaiba",
      "campos do jordao",
      "ubatuba",
      "sao sebastiao",
      "ilha bela",
      "rio de janeiro rj",
      "rio de janeiro capital",
      "niteroi rj",
      "petropolis rj",
      "nova iguacu",
      "sao goncalo",
      "duque de caxias",
      "nova friburgo",
      "teresopolis",
      "cabo frio",
      "buzios",
      "paraty",
      "angra dos reis",
      "macaé",
      "vassouras",
      "barra mansa",
      "volta redonda",
      "resende",
      "barra da tijuca",
      "ilha do governador",
      "belford roxo",
      "campos dos goytacazes",
      "belo horizonte mg",
      "belo horizonte minas gerais",
      "uberlandia mg",
      "juiz de fora mg",
      "contagem",
      "betim",
      "nova lima",
      "sabara",
      "ribeirao das neves",
      "governador valadares",
      "teofilo otoni",
      "ipatinga",
      "montes claros",
      "divinopolis",
      "uberaba",
      "araxá",
      "passos mg",
      "pouso alegre mg",
      "sao joao del rei",
      "ouro preto",
      "mariana mg",
      "congonhas",
      "caldas novas",
      "brumadinho",
      "brasilia df",
      "brasilia distrito federal",
      "taguatinga",
      "ceilandia",
      "samambaia",
      "planaltina",
      "aguas claras",
      "cruzeiro df",
      "guara",
      "vicente pires",
      "lago norte",
      "lago sul",
      "sama",
      "nucleo bandeirante",
      "goiania go",
      "anapolis go",
      "rio verde",
      "luziânia",
      "aparecida de goiania",
      "valparaiso de goias",
      "senador canedo",
      "catalao",
      "itumbiara",
      "jatai",
      "caldas novas go",
      "rio quente",
      "cristalina",
      "governador rocha",
      "mineiros",
      "ipameri",
      "uruacu",
      "vila boa",
      "barro alto",
      "bonito go",
      "posse",
      "curitiba pr",
      "londrina pr",
      "maringa pr",
      "joinville sc",
      "florianopolis sc",
      "blumenau sc",
      "caxias do sul rs",
      "porto alegre rs",
      "porto alegre rio grande do sul",
      "sao jose",
      "sao jose sc",
      "palhoca",
      "biguacu",
      "itapema",
      "bombinhas",
      "balneario camboriu",
      "penha sc",
      "itajai sc",
      "concordia sc",
      "chapeco",
      "xanxere",
      "videira",
      "canoas rs",
      "sao leopoldo",
      "novo hamburgo",
      "gravatai",
      "pelotas rs",
      "santa maria rs",
      "gurgueia",
      "aguas de lindoia",
      "gramado rs",
      "canela rs",
      "bento goncalves",
      "garibaldi",
      "farroupilha",
      "caxias do sul rio grande do sul",
      "santo angelo",
      "erechim",
      "passo fundo",
      "passos de torres",
      "sao borja",
      "uruguaiana",
      "santana do livramento",
      "aguas de sao pedro",
      "vitoria es",
      "vila velha es",
      "serra es",
      "cachoeiro de itapemirim",
      "colatina",
      "linhares es",
      "sao mateus es",
      "guarapari",
      "anchieta es",
      "vitoria espirito santo",
      "nova venecia",
      "cariacica",
      "viana es",
      "santa maria de jetiba",
      "castelo es",
      "domingos martins",
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
      "fortaleza ce",
      "recife pe",
      "salvador ba",
      "maceio al",
      "joao pessoa pb",
      "natal rn",
      "teresina pi",
      "sao luis ma",
      "aracaju se",
      "caucaia",
      "maracanau",
      "juazeiro do norte",
      "sobral ce",
      "crato ce",
      "barbalha",
      "campina grande pb",
      "santa rita pb",
      "patos pb",
      "bayeux",
      "cabedelo",
      "mossoro rn",
      "parnamirim rn",
      "sao gonçalo do amarante",
      "macae rn",
      "assu",
      "currais novos",
      "ipatinga rn",
      "paulista pe",
      "caruaru",
      "petrolina",
      "jaboatao dos guararapes",
      "olinda pe",
      "cabo de santo agostinho",
      "ipojuca",
      "camocim de sao felix",
      "serra talhada",
      "salgueiro",
      "arcoverde",
      "laurentino",
      "lajedo",
      "sao luis de montes belos",
      "ilheus ba",
      "itabuna",
      "feira de santana",
      "lauro de freitas",
      "alagoinhas",
      "barreiras ba",
      "ribeirao do pombal",
      "juazeiro ba",
      "itabuna ba",
      "guanambi",
      "vitoria da conquista",
      "jequie",
      "campo formoso",
      "andai",
      "caetite",
      "porto seguro ba",
      "salvador bahia",
      "santo amaro",
      "camacari",
      "simões filho",
      "maceio alagoas",
      "arapiraca",
      "rio largo",
      "uniao dos palmares",
      "pilar al",
      "teresina piaui",
      "parnaiba pi",
      "campo maior do piaui",
      "floriano pi",
      "sao raimundo nonato",
      "corrente",
      "ivinhema",
      "batalha",
      "sao luis maranhao",
      "imperatriz ma",
      "timon",
      "caxias ma",
      "bacabal",
      "santa ines",
      "codó",
      "paço do lumiar",
      "sao jose de ribamar",
      "arraial do cabo",
      "cabo verde",
      "itapipoca",
      "trairi",
      "morada nova",
      "crateus",
      "mombaça",
      "pacajus",
      "horizonte",
      "maranguape",
      "guaraciaba do norte",
      "tigre do brasil",
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
      "parkland",
      "coral springs",
      "pompano beach",
      "deerfield beach",
      "plantation",
      "sunrise fl",
      "weston fl",
      "boca raton",
      "pembroke pines",
      "hollywood fl",
      "doral",
      "homestead fl",
      "miramar fl",
      "davie fl",
      "north miami",
      "north miami beach",
      "aventura",
      "hallandale beach",
      "sunny isles beach",
      "coconut creek",
      "boynton beach",
      "delray beach",
      "wellington fl",
      "jupiter fl",
      "palm beach gardens",
      "weston",
      "cooper city",
      "pembroke park",
      "lauderhill",
      "tamarac",
      "north lauderdale",
      "oakland park",
      "fort myers beach",
      "cape coral fl",
      "estero",
      "bonita springs",
      "clearwater",
      "st pete",
      "saint pete",
      "palm bay",
      "broward",
      "ft lauderdale",
      "bradenton",
      "vero beach",
      "port st lucie",
      "port saint lucie",
      "stuart fl",
      "fort pierce",
      "lakeland fl",
      "daytona",
      "pensacola fl",
      "destin",
      "panama city beach",
      "tallahassee fl",
      "gainesville fl",
      "jacksonville fl",
      "st augustine",
      "saint augustine",
      "ocala fl",
      "spring hill",
      "the villages",
      "clermont",
      "winter haven",
      "winter park",
      "altamonte springs",
      "sanford fl",
      "daytona beach shores",
      "south daytona",
      "flagler beach",
      "new smyrna beach",
      "melbourne village",
      "palm coast",
      "ormond beach",
      "cocoa beach",
      "cape canaveral",
      "kissimmee fl",
      "four corners",
      "lehigh acres",
      "north fort myers",
      "cape coral florida",
      "brandon fl",
      "riverview fl",
      "temple terrace",
      "plant city",
      "carrollwood",
      "wesley chapel",
      "largo fl",
      "pinellas park",
      "dunedin",
      "seminole fl",
      "bradenton beach",
      "sarasota fl",
      "venice fl",
      "north port",
      "port charlotte",
      "punta gorda",
      "alafaya",
      " hunters creek",
      "horizon west",
      "west melbourne",
      "titusville",
      "edgewater fl",
      "deltona",
      "deland",
      "sanford airport",
      "florida keys",
      "key west",
      "key largo",
      "marathon fl",
      "islamorada",
      "miami gardens",
      "hialeah gardens",
      "coral gables",
      "pinecrest fl",
      "south miami",
      "north bay village",
      "bal harbour",
      "bay harbor islands",
      "sunrise florida",
      "lauderhill fl",
      "margate fl",
      "coral springs fl",
      "fort lauderdale fl",
      "pembroke pines fl",
      "miramar florida",
      "hollywood florida",
      "doral fl",
      "tampa fl",
      "orlando fl",
      "jacksonville florida",
      "st petersburg fl",
      "saint petersburg fl",
      "miami fl",
      "west palm beach fl",
      "fort myers fl",
      "fort lauderdale florida",
      "philadelphia pa",
      "pittsburgh pa",
      "allentown pa",
      "erie pa",
      "lancaster pa",
      "scranton pa",
      "harrisburg",
      "reading pa",
      "bethlehem pa",
      "york pa",
      "altoona",
      "state college",
      "philadelphia pennsylvania",
      "washington dc",
      "dc",
      "washington district of columbia",
      "arlington va",
      "alexandria virginia",
      "virginia beach va",
      "norfolk virginia",
      "chesapeake va",
      "newport news va",
      "richmond va",
      "roanoke",
      "charlottesville",
      "lynchburg",
      "hampton va",
      "new haven ct",
      "hartford ct",
      "stanford ct",
      "greenwich ct",
      "stamford ct",
      "norwalk ct",
      "danbury ct",
      "bridgeport ct",
      "waterbury ct",
      "new britain",
      "hartford connecticut",
      "boston ma",
      "worcester ma",
      "springfield massachusetts",
      "lowell ma",
      "cambridge ma",
      "brockton",
      "quincy ma",
      "new bedford",
      "lynn ma",
      "fall river",
      "lawrence ma",
      "somerville ma",
      "boston massachusetts",
      "providence ri",
      "warwick ri",
      "cranston",
      "pawtucket",
      "newport ri",
      "manchester nh",
      "nashua nh",
      "concord nh",
      "portsmouth nh",
      "portland me",
      "bangor me",
      "augusta me",
      "lewiston",
      "burlington vt",
      "rutland vt",
      "montpelier vt",
      "essex vt",
      "dover de",
      "wilmington de",
      "newark de",
      "dover delaware",
      "baltimore md",
      "frederick md",
      "rockville md",
      "bethesda md",
      "gaithersburg md",
      "silver spring md",
      "annapolis md",
      "columbia md",
      "bowie md",
      "baltimore maryland",
      "hagerstown",
      "raleigh nc",
      "charlotte nc",
      "greensboro nc",
      "winston salem nc",
      "durham nc",
      "fayetteville nc",
      "cary nc",
      "wilmington nc",
      "high point nc",
      "concord nc",
      "gastonia nc",
      "greenville nc",
      "burlington nc",
      "asheville nc",
      "jacksonville nc",
      "chapel hill",
      "raleigh north carolina",
      "charlotte north carolina",
      "charleston sc",
      "columbia sc",
      "greenville sc",
      "myrtle beach sc",
      "spartanburg sc",
      "savannah ga",
      "augusta ga",
      "athens ga",
      "atlanta ga",
      "augusta georgia",
      "columbus ga",
      "macon ga",
      "savannah georgia",
      "marietta ga",
      "athens georgia",
      "alpharetta",
      "roswell ga",
      "johns creek",
      "sandy springs",
      "decatur ga",
      "atlanta georgia",
      "charleston wv",
      "huntington wv",
      "parkersburg wv",
      "morgantown",
      "wheeling",
      "fairmont wv",
      "louisville ky",
      "lexington ky",
      "bowling green ky",
      "owensboro",
      "covington ky",
      "frankfort ky",
      "louisville kentucky",
      "lexington kentucky",
      "indianapolis in",
      "fort wayne in",
      "evansville in",
      "south bend in",
      "bloomington in",
      "carmel in",
      "fishers",
      "muncie",
      "terre haute",
      "indianapolis indiana",
      "detroit mi",
      "grand rapids mi",
      "warren mi",
      "ann arbor mi",
      "lansing mi",
      "flint mi",
      "sterling heights",
      "dearborn",
      "troy mi",
      "westland mi",
      "farmington hills",
      "kalamazoo",
      "saginaw",
      "detroit michigan",
      "columbus ohio",
      "cleveland oh",
      "cincinnati oh",
      "toledo oh",
      "akron oh",
      "dayton oh",
      "parma oh",
      "youngstown oh",
      "canton oh",
      "lorain",
      "huber heights",
      "springfield oh",
      "lakewood oh",
      "cleveland heights",
      "columbus oh",
      "newark nj",
      "jersey city",
      "paterson nj",
      "elizabeth nj",
      "edison nj",
      "woodbridge",
      "lakewood nj",
      "trenton nj",
      "camden nj",
      "clifton nj",
      "new jersey cities",
      "atlantic city",
      "new brunswick nj",
      "newark new jersey",
      "buffalo ny",
      "rochester ny",
      "albany ny",
      "syracuse",
      "troy ny",
      "schenectady",
      "niagara falls",
      "binghamton",
      "utica",
      "yonkers",
      "white plains",
      "new rochelle",
      "mount vernon",
      "staten island",
      "bronx",
      "queens",
      "brooklyn",
      "manhattan",
      "long beach ny",
      "freeport ny",
      "spring valley",
      "new york city",
      "nyc ny",
      "long island",
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
      "shreveport",
      "baton rouge",
      "lafayette la",
      "lake charles",
      "new orleans la",
      "metairie",
      "kenner",
      "bossier city",
      "monroe la",
      "alexandria la",
      "houma",
      "texas cities",
      "houston tx",
      "dallas tx",
      "austin tx",
      "san antonio tx",
      "fort worth",
      "el paso",
      "corpus christi",
      "lubbock",
      "garland tx",
      "irving tx",
      "arlington tx",
      "amarillo",
      "laredo",
      "plano",
      "fort worth tx",
      "corpus christi tx",
      "laredo tx",
      "lubbock tx",
      "midland tx",
      "odessa",
      "abeline",
      "abilene",
      "waco",
      "wichita falls",
      "killeen",
      "brownsville",
      "mcallen",
      "edinburg",
      "mission tx",
      "harlingen",
      "beaumont",
      "port arthur",
      "tyler tx",
      "longview",
      "odessa tx",
      "midland odessa",
      "san angelo",
      "galveston",
      "sugar land",
      "katy",
      "the woodlands",
      "conroe",
      "pearland",
      "college station",
      "bryan",
      "lewisville",
      "carrollton",
      "richardson",
      "mckinney",
      "frisco tx",
      "denton",
      "mesquite tx",
      "grand prairie",
      "garland texas",
      "san antonio texas",
      "austin texas",
      "dallas texas",
      "houston texas",
      "tulsa ok",
      "oklahoma city ok",
      "norman ok",
      "broken arrow",
      "moore ok",
      "midwest city",
      "stillwater",
      "edmond ok",
      "lawton ok",
      "kansas city mo",
      "st louis mo",
      "springfield mo",
      "independence mo",
      "columbia mo",
      "lee summit",
      "overland park",
      "olathe",
      "kansas city ks",
      "topeka ks",
      "wichita ks",
      "lawrence ks",
      "manhattan ks",
      "salina ks",
      "omaha ne",
      "lincoln nebraska",
      "bellevue ne",
      "grand island",
      "des moines iowa",
      "cedar rapids",
      "davenport ia",
      "sioux city ia",
      "iowa city ia",
      "waterloo ia",
      "ames ia",
      "dubuque",
      "west des moines",
      "urbandale",
      "ankeny",
      "council bluffs",
      "marion ia",
      "minneapolis mn",
      "st paul",
      "saint paul mn",
      "rochester mn",
      "duluth mn",
      "bloomington mn",
      "brooklyn park",
      "plymouth mn",
      "st cloud",
      "saint cloud mn",
      "eagan",
      "burnsville",
      "coon rapids",
      "eden prairie",
      "maple grove",
      "woodbury",
      "blaine mn",
      "lakeville",
      "minnetonka",
      "chaska",
      "apple valley",
      "fargo nd",
      "bismarck nd",
      "grand forks",
      "sioux falls sd",
      "rapid city sd",
      "sioux city",
      "rapid city south dakota",
      "madison wi",
      "milwaukee wi",
      "green bay wi",
      "kenosha",
      "racine",
      "appleton",
      "waukesha",
      "oshkosh",
      "eau claire",
      "janesville",
      "west allis",
      "la crosse",
      "sheboygan",
      "wausau",
      "beloit",
      "green bay wisconsin",
      "milwaukee wisconsin",
      "madison wisconsin",
      "louisville",
      "lexington",
      "bowling green",
      "paducah",
      "nashville tennessee",
      "memphis tennessee",
      "knoxville tennessee",
      "chattanooga tennessee",
      "clarksville tennessee",
      "murfreesboro",
      "jackson tn",
      "johnson city",
      "kingsport tn",
      "tri cities tn",
      "birmingham alabama",
      "montgomery alabama",
      "huntsville alabama",
      "mobile alabama",
      "tuscaloosa alabama",
      "auburn al",
      "dothan",
      "decatur al",
      "madison al",
      "florence al",
      "gadsden",
      "anniston al",
      "hoover",
      "jackson mississippi",
      "gulfport",
      "biloxi",
      "southaven",
      "hattiesburg",
      "meridian ms",
      "tupelo",
      "greenville ms",
      "oxford ms",
      "starkville",
      "madison ms",
      "pearl ms",
      "little rock arkansas",
      "fayetteville arkansas",
      "fort smith ar",
      "springdale ar",
      "jonesboro ar",
      "north little rock",
      "conway ar",
      "rogers ar",
      "pine bluff",
      "bentonville",
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
      "loveland",
      "greeley",
      "grand junction",
      "pueblo",
      "thornton",
      "westminster co",
      "arvada",
      "centennial",
      "lakewood co",
      "wheat ridge",
      "englewood co",
      "littleton co",
      "northglenn",
      "commerce city",
      "parker co",
      "highlands ranch",
      "castle rock",
      "broomfield",
      "longmont",
      "loveland co",
      "fort morgan",
      "sterling co",
      "durango co",
      "telluride",
      "aspen",
      "vail",
      "breckenridge",
      "steamboat springs",
      "estes park",
      "canyonlands",
      "moab ut",
      "ogden ut",
      "provo ut",
      "west valley city",
      "west jordan",
      "salt lake city ut",
      "sandy ut",
      "orem ut",
      "saint george ut",
      "st george ut",
      "lehi ut",
      "logan ut",
      "murray ut",
      "layton ut",
      "south jordan",
      "draper ut",
      "bountiful ut",
      "tooele ut",
      "heber",
      "park city ut",
      "santa fe nm",
      "albuquerque nm",
      "las cruces nm",
      "rio rancho",
      "roswell nm",
      "farmington nm",
      "clovis nm",
      "hobbs nm",
      "taos",
      "albuquerque new mexico",
      "santa fe new mexico",
      "cheyenne wy",
      "casper wy",
      "gillette",
      "laramie",
      "sheridan wy",
      "rock springs",
      "jackson wy",
      "cody wy",
      "evanston wy",
      "douglas wy",
      "worland",
      "thermopolis",
      "billings mt",
      "bozeman mt",
      "helena mt",
      "missoula",
      "great falls mt",
      "butte mt",
      "kalispell",
      "sidney mt",
      "havre",
      "glendive",
      "belgrade mt",
      "livingston",
      "whitefish",
      "columbia falls",
      "laurel mt",
      "miles city",
      "boise id",
      "idaho falls id",
      "nampa id",
      "meridian id",
      "pocatello id",
      "twin falls id",
      "coeur dalene",
      "lewiston id",
      "rexburg",
      "post falls",
      "eagle id",
      "garden city",
      "kuna",
      "moscow id",
      "ammon",
      "chubbuck",
      "inkom",
      "blackfoot",
      "jerome",
      "burley id",
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
    keywords: ["phoenix", "scottsdale", "mesa", "tucson", "chandler", "tempe", "gilbert",
      "phoenix az",
      "scottsdale az",
      "mesa az",
      "tucson az",
      "chandler az",
      "tempe az",
      "gilbert az",
      "glendale az",
      "peoria az",
      "surprise az",
      "goodyear az",
      "avondale",
      "buckeye",
      "queen creek",
      "apache junction",
      "maricopa az",
      "el mirage",
      "fountain hills",
      "prescott",
      "flagstaff",
      "sedona",
      "yuma",
      "litchfield park",
      "casa grande",
      "mohave valley",
      "lake havasu city",
      "bullhead city",
      "show low",
      "payson",
      "kingman",
      "prescott valley",
      "chino valley",
      "verde valley",
      "cottonwood",
      "camp verde",
      "sierra vista",
      "douglas az",
      "naco",
      "nogales",
      "tombstone",
      "benson az",
      "willcox",
      "safford",
      "thatcher",
      "snowflake",
      "holbrook",
      "winslow",
    ],
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
      "irvine",
      "anaheim ca",
      "santa ana",
      "riverside ca",
      "corona ca",
      "san bernardino",
      "ontario ca",
      "fontana ca",
      "moreno valley",
      "glendale ca",
      "huntington beach",
      "gardena",
      "inglewood",
      "burbank",
      "pasadena ca",
      "el monte",
      "downey",
      "west covina",
      "norwalk ca",
      "fullerton ca",
      "orange ca",
      "garden grove",
      "stanton ca",
      "buena park",
      "cerritos",
      "bellflower",
      "la habra",
      "hawthorne",
      "santa clarita",
      "palmdale",
      "lancaster ca",
      "thousand oaks",
      "simi valley",
      "oxnard",
      "ventura",
      "santa barbara",
      "san luis obispo",
      "bakersfield ca",
      "stockton ca",
      "modesto",
      "fresno ca",
      "tulare",
      "clovis",
      "merced",
      "visalia",
      "paso robles",
      "salinas",
      "monterey",
      "santa cruz",
      "napa",
      "sonoma",
      "san mateo",
      "daly city",
      "berkeley",
      "hayward",
      "richmond ca",
      "sunnyvale",
      "mountain view",
      "santa clara",
      "milpitas",
      "fremont ca",
      "union city ca",
      "alameda",
      "palo alto",
      "redwood city",
      "san leandro",
      "antioch ca",
      "concord ca",
      "livermore",
      "san ramon",
      "pleasanton",
      "walnut creek",
      "foster city",
      "san bruno",
      "dublin ca",
      "danville ca",
      "san rafael",
      "novato",
      "vallejo",
      "fairfield ca",
      "vacaville",
      "rohnert park",
      "santa rosa",
      "petaluma",
      "ukiah",
      "arcata",
      "eureka ca",
      "redding",
      "chico ca",
      "yuba city",
      "sacramento ca",
      "roseville",
      "elk grove",
      "stockton",
      "modesto ca",
      "tracy ca",
      "manteca",
      "lodi ca",
      "galt",
      "folsom",
      "citrus heights",
      "rancho cordova",
      "north highlands",
      "sacramento california",
      "los angeles ca",
      "san diego ca",
      "san francisco ca",
      "seattle wa",
      "portland or",
      "las vegas nv",
      "san jose ca",
      "oakland ca",
      "long beach ca",
      "reno nv",
      "henderson nv",
      "tacoma wa",
      "spokane wa",
      "eugene or",
      "salem oregon",
      "san diego california",
      "los angeles california",
      "san francisco california",
      "sacramento california",
      "san jose california",
      "las vegas nevada",
      "reno nevada",
      "henderson nevada",
      "seattle washington",
      "tacoma washington",
      "spokane washington",
      "vancouver wa",
      "bellevue wa",
      "everett wa",
      "kent wa",
      "renton",
      "redmond wa",
      "kirkland wa",
      "issaquah",
      "samammish",
      "bothell",
      "lynnwood",
      "puyallup",
      "lakewood wa",
      "gig harbor",
      "bremerton",
      "bellingham",
      "yakima",
      "kennewick",
      "pasco wa",
      "richland wa",
      "walla walla",
      "spokane valley",
      "moses lake",
      "olympia wa",
      "portland oregon",
      "eugene oregon",
      "salem or",
      "gresham",
      "hillsboro or",
      "beaverton or",
      "bend or",
      "medford or",
      "springfield or",
      "corvallis",
      "aloha",
      "oregon city",
      "mcminnville",
      "tigard",
      "lake oswego",
      "keizer",
      "newberg",
      "woodburn",
      "coos bay",
      "astoria",
      "la grande",
      "pendleton",
      "hermiston",
      "central point",
      "grants pass",
      "roseburg",
      "klamath falls",
      "las vegas strip",
      "north las vegas",
      "paradise nv",
      "sunrise manor",
      "spring valley nv",
      "summerlin",
      "enterprise nv",
      "boulder city",
      "henderson nevada",
      "reno tahoe",
      "carson city",
      "mesquite nv",
      "elko",
      "dayton nv",
      "fernley",
      " sparks nv",
      "winnemucca",
    ],
    stateKeywords: ["california", "ca", "washington", "wa", "nevada", "nv", "oregon", "or"],
  },
  {
    timeZone: "America/Anchorage",
    country: "US",
    keywords: ["anchorage", "fairbanks", "juneau", "sitka",
      "anchorage ak",
      "fairbanks ak",
      "juneau ak",
      "sitka ak",
      "wasilla",
      "palmer ak",
      "ketchikan",
      "kenai",
      "soldotna",
      "homer ak",
      "valdez ak",
      "nome ak",
      "barrow",
      "utqiagvik",
      "bethel ak",
      "kotzebue",
      "dillingham",
      "kodiak",
      "seward ak",
      "whittier",
      "talkeetna",
      "denali park",
      "delta junction",
      "north pole ak",
      "fairbanks north star",
      "matsu valley",
      "matanuska susitna",
    ],
    stateKeywords: ["alaska", "ak"],
  },
  {
    timeZone: "Pacific/Honolulu",
    country: "US",
    keywords: ["honolulu", "hilo", "kailua", "waianae", "pearl city",
      "honolulu hi",
      "hilo hi",
      "kailua hi",
      "waianae hi",
      "pearl city hi",
      "oahu",
      "maui",
      "kauai",
      "big island",
      "lanai",
      "molokai",
      "kahului",
      "lahaina",
      "kihei",
      "wailea",
      "makawao",
      "haleakala",
      "hilo hawaii",
      "kona",
      "kailua kona",
      "waimea hi",
      "hawi",
      "honokaa",
      "pahoa",
      "volcano hi",
      "wahiawa",
      "ewa beach",
      "kapolei",
      "waipahu",
      "mililani",
      "halawa",
      "kaneohe",
      "laie",
      "north shore oahu",
      "waikiki",
      "kahala",
      "hawaii kai",
    ],
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

  const matchingRules = CITY_TIME_ZONE_RULES.filter((rule) =>
    rule.stateKeywords?.some((keyword) => candidateMatchesKeyword(candidates, keyword)),
  );

  const preferredRules = phoneCountry
    ? matchingRules.filter((rule) => rule.country === phoneCountry)
    : matchingRules;
  const selectedRule = preferredRules[0] ?? matchingRules[0] ?? null;
  if (selectedRule) {
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

  return null;
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

  const phoneCountry = inferTimeZoneFromPhoneCountryCode(params.phone)?.country ?? null;

  const usStateFromRaw = rawState ? lookupUsStateByCandidate(rawState) : null;
  const brStateFromRaw: { country: "BR"; normalizedState: string } | null = (() => {
    if (!rawState) return null;
    for (const rule of CITY_TIME_ZONE_RULES.filter((r) => r.country === "BR")) {
      for (const kw of rule.stateKeywords ?? []) {
        if (candidateMatchesKeyword(stateCandidates, kw)) {
          return { country: "BR", normalizedState: kw };
        }
      }
    }
    return null;
  })();
  const explicitStateCountry: "BR" | "US" | null = usStateFromRaw
    ? "US"
    : brStateFromRaw
      ? "BR"
      : null;

  for (const rule of CITY_TIME_ZONE_RULES) {
    if (explicitStateCountry && rule.country !== explicitStateCountry) continue;
    if (phoneCountry && rule.country !== phoneCountry) {
      if (explicitStateCountry ? explicitStateCountry === phoneCountry : true) continue;
    }
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
    if (explicitStateCountry && stateResolution.country !== explicitStateCountry) return null;
    const resolvedStateUs = stateResolution.country === "US" ? lookupUsStateByCandidate(stateResolution.state) : null;
    return {
      city: null,
      state: resolvedStateUs ? resolvedStateUs.fullName : stateResolution.state,
      normalizedCity: null,
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
  if (explicitStateCountry && finalStateFromRawUs && explicitStateCountry !== "US") return null;
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

export function resolveStudentTimezone(params: {
  state?: string | null;
  city?: string | null;
  phone?: string | null;
  browserTimeZone?: string | null;
}): string | null {
  const state = String(params.state ?? "").trim() || null;
  const city = String(params.city ?? "").trim() || null;
  const phone = String(params.phone ?? "").trim() || null;
  const browserTz = String(params.browserTimeZone ?? "").trim() || null;

  if (city) {
    const r = resolveTimeZoneFromCityInput({
      city,
      state: state ?? undefined,
      phone: phone ?? undefined,
      allowPhoneCountryFallback: false,
    });
    if (r?.timeZone) return r.timeZone;
  }

  if (state) {
    const r = resolveTimeZoneFromStateInput({
      state,
      phone: phone ?? undefined,
    });
    if (r?.timeZone) return r.timeZone;
  }

  if (browserTz && browserTz !== PROFESSOR_TIME_ZONE) {
    return browserTz;
  }

  return null;
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

export function parseStateCityCombined(
  rawText: string,
  opts?: { phone?: string | null },
): { state?: string; city?: string } | null {
  const clean = String(rawText ?? "").trim();
  if (!clean) return null;

  const stripIntroPhrases = (text: string): string => {
    return text
      .replace(/^[\s]*(?:(?:eu\s+)?(?:moro|resido|vivo|estou|fico|morei)\s+(?:em|na|no|a)\s+)/i, "")
      .replace(/^[\s]*(?:sou\s+(?:de|do|da)\s+)/i, "")
      .replace(/^[\s]*(?:(?:a\s+)?(?:cidade|casa|minha\s+casa|endereço|endereco)\s+(?:é|e)\s+)/i, "")
      .replace(/^[\s]*(?:(?:o\s+)?(?:estado|meu\s+estado)\s+(?:é|e)\s+)/i, "")
      .replace(/^[\s]*(?:em\s+)/i, "")
      .trim();
  };

  const tryCombo = (parts: [string, string]) => {
    const [a, b] = parts.map((s) => s.replace(/\s+/g, " ").trim());
    if (!a || !b) return null;
    const ab = resolveTimeZoneFromCityInput({
      city: a,
      state: b,
      phone: opts?.phone ?? null,
      allowPhoneCountryFallback: false,
    });
    if (ab?.city && ab?.state) return { city: ab.city, state: ab.state };
    const ba = resolveTimeZoneFromCityInput({
      city: b,
      state: a,
      phone: opts?.phone ?? null,
      allowPhoneCountryFallback: false,
    });
    if (ba?.city && ba?.state) return { city: ba.city, state: ba.state };
    const aState = resolveTimeZoneFromStateInput({ state: a, phone: opts?.phone ?? null });
    const bState = resolveTimeZoneFromStateInput({ state: b, phone: opts?.phone ?? null });
    if (aState?.normalizedState && !bState) {
      const bCity = resolveTimeZoneFromCityInput({
        city: b,
        state: aState.normalizedState,
        phone: opts?.phone ?? null,
        allowPhoneCountryFallback: false,
      });
      if (bCity?.city) return { city: bCity.city, state: aState.normalizedState };
    }
    if (bState?.normalizedState && !aState) {
      const aCity = resolveTimeZoneFromCityInput({
        city: a,
        state: bState.normalizedState,
        phone: opts?.phone ?? null,
        allowPhoneCountryFallback: false,
      });
      if (aCity?.city) return { city: aCity.city, state: bState.normalizedState };
    }
    return null;
  };

  const hasExplicitSeparator = (t: string) => /[,\-–—\/|]/.test(t);

  const tryAllTokenSplits = (text: string): { city: string; state: string } | null => {
    const stripped = stripIntroPhrases(text);
    for (const input of [stripped, text]) {
      if (!input) continue;
      const tokens = input.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
      if (tokens.length < 2) continue;
      for (let i = 1; i < tokens.length; i++) {
        const left = tokens.slice(0, i).join(" ");
        const right = tokens.slice(i).join(" ");
        const combo = tryCombo([left, right]);
        if (combo) return combo;
      }
    }
    return null;
  };

  const trySeparatedSplits = (text: string): { city: string; state: string } | null => {
    const stripped = stripIntroPhrases(text);
    for (const input of [stripped, text]) {
      if (!input) continue;
      if (hasExplicitSeparator(input)) {
        const sep = /\s*(?:,|-|–|—|\/|\|)\s*/;
        const sepSplit = input.split(sep).filter(Boolean);
        if (sepSplit.length === 2) {
          const combo = tryCombo([sepSplit[0], sepSplit[1]]);
          if (combo) return combo;
        }
        if (sepSplit.length > 2) {
          for (let i = 1; i < sepSplit.length; i++) {
            const left = sepSplit.slice(0, i).join(" ");
            const right = sepSplit.slice(i).join(" ");
            const combo = tryCombo([left, right]);
            if (combo) return combo;
          }
        }
      }
      const ufAtEnd = input.match(/^(.+?)\s+(\S{2})$/);
      if (ufAtEnd) {
        const [, rest, uf] = ufAtEnd;
        const combo = tryCombo([rest, uf]);
        if (combo) return combo;
      }
      const ufAtStart = input.match(/^(\S{2})\s+(.+)$/);
      if (ufAtStart) {
        const [, uf, rest] = ufAtStart;
        const combo = tryCombo([uf, rest]);
        if (combo) return combo;
      }
    }
    return null;
  };

  const tryWholeCity = (text: string): { state: string; city: string } | null => {
    const stripped = stripIntroPhrases(text);
    for (const input of [stripped, text]) {
      if (!input) continue;
      const whole = resolveTimeZoneFromCityInput({
        city: input,
        state: null,
        phone: opts?.phone ?? null,
        allowPhoneCountryFallback: false,
      });
      if (whole?.city && whole?.state) {
        return { state: whole.state, city: whole.city };
      }
    }
    return null;
  };

  const wholeResult = tryWholeCity(clean);
  if (wholeResult) return wholeResult;

  const sepResult = trySeparatedSplits(clean);
  if (sepResult) return sepResult;

  const tokensResult = tryAllTokenSplits(clean);
  if (tokensResult) return tokensResult;

  return null;
}
