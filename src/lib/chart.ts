export type ChartFilter = "days" | "weeks" | "months" | "years";
export type ChartPoint = { name: string; value: number; label: string };

const CHART_TIME_ZONE = "America/Sao_Paulo";

function formatDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CHART_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
  };
}

function zonedDateKey(date: Date) {
  const parts = formatDateParts(date);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function startOfZonedDay(date: Date) {
  const parts = formatDateParts(date);
  return new Date(parts.year, parts.month - 1, parts.day);
}

export function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

export function addMonths(date: Date, amount: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + amount);
  return next;
}

function startOfWeek(date: Date) {
  const start = startOfZonedDay(date);
  const day = start.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(start, diff);
}

function monthKey(date: Date) {
  const parts = formatDateParts(date);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}`;
}

function yearKey(date: Date) {
  return String(formatDateParts(date).year);
}

function shortDateLabel(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: CHART_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

function shortMonthLabel(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: CHART_TIME_ZONE,
    month: "short",
  })
    .format(date)
    .replace(".", "");
}

function weekdayLabel(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: CHART_TIME_ZONE,
    weekday: "short",
  })
    .format(date)
    .replace(".", "");
}

export function buildChartPoints(filter: ChartFilter, chartDates: string[]): ChartPoint[] {
  const validDates = chartDates
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()));

  const now = new Date();

  if (filter === "days") {
    const buckets = Array.from({ length: 7 }).map((_, index) => {
      const day = addDays(startOfZonedDay(now), -(6 - index));
      return {
        key: zonedDateKey(day),
        name: weekdayLabel(day),
        label: shortDateLabel(day),
      };
    });

    return buckets.map((bucket) => ({
      name: bucket.name,
      label: bucket.label,
      value: validDates.filter((date) => zonedDateKey(date) === bucket.key).length,
    }));
  }

  if (filter === "weeks") {
    const currentWeek = startOfWeek(now);
    const buckets = Array.from({ length: 8 }).map((_, index) => {
      const weekStart = addDays(currentWeek, -(7 - index) * 7);
      const weekEnd = addDays(weekStart, 6);
      return {
        key: zonedDateKey(weekStart),
        name: shortDateLabel(weekStart),
        label: `${shortDateLabel(weekStart)} a ${shortDateLabel(weekEnd)}`,
      };
    });

    return buckets.map((bucket) => ({
      name: bucket.name,
      label: `Semana ${bucket.label}`,
      value: validDates.filter((date) => zonedDateKey(startOfWeek(date)) === bucket.key).length,
    }));
  }

  if (filter === "months") {
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const buckets = Array.from({ length: 12 }).map((_, index) => {
      const month = addMonths(currentMonth, -(11 - index));
      const monthLabel = shortMonthLabel(month);
      const monthYear = new Intl.DateTimeFormat("pt-BR", {
        timeZone: CHART_TIME_ZONE,
        month: "long",
        year: "numeric",
      }).format(month);
      return {
        key: monthKey(month),
        name: monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1),
        label: monthYear.charAt(0).toUpperCase() + monthYear.slice(1),
      };
    });

    return buckets.map((bucket) => ({
      name: bucket.name,
      label: bucket.label,
      value: validDates.filter((date) => monthKey(date) === bucket.key).length,
    }));
  }

  const currentYear = new Date(now.getFullYear(), 0, 1);
  const buckets = Array.from({ length: 5 }).map((_, index) => {
    const yearDate = addMonths(currentYear, -(4 - index) * 12);
    const label = String(yearDate.getFullYear());
    return {
      key: yearKey(yearDate),
      name: label,
      label,
    };
  });

  return buckets.map((bucket) => ({
    name: bucket.name,
    label: bucket.label,
    value: validDates.filter((date) => yearKey(date) === bucket.key).length,
  }));
}
