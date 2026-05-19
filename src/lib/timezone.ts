type ZonedDateTimeInput = {
  date: string;
  time: string;
  timeZone: string;
};

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
  "America/Cuiaba",
  "America/Manaus",
  "America/Rio_Branco",
] as const;

export type BrazilTimeZone = (typeof BRAZIL_TIMEZONES)[number];

