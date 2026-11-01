import test from "node:test";
import assert from "node:assert/strict";

import { buildAgendaRows } from "./agendaRows.ts";

test("buildAgendaRows prioriza o ciclo operacional de novembro quando o schedule ainda aponta para a charge de outubro", () => {
  const rows = buildAgendaRows({
    debtors: [
      {
        id: "debtor-1",
        nome: "Aline Faustino",
        debtor_charges: [
          {
            id: "charge-oct",
            due_day: 22,
            recurrence_month: 10,
            recurrence_year: 2026,
            created_at: "2026-08-01T00:00:00.000Z",
          },
          {
            id: "charge-nov",
            due_day: 22,
            recurrence_month: 11,
            recurrence_year: 2026,
            created_at: "2026-09-01T00:00:00.000Z",
          },
        ],
      },
    ],
    schedules: [
      {
        id: "schedule-1",
        debtor_id: "debtor-1",
        charge_id: "charge-oct",
        data_envio: "2026-11-22T16:00:00.000Z",
        charge_due_at: "2026-11-22T16:00:00.000Z",
        recurrence_day: 22,
        recurrence_time: "12:00",
        recurrence: "monthly",
        schedule_timezone: "America/Cuiaba",
        status: "agendado",
        charge: {
          due_day: 22,
          recurrence_month: 10,
          recurrence_year: 2026,
        },
      },
    ],
    latestExecutedRunBySchedule: new Map(),
    templates: [],
    defaultTimeZone: "America/Cuiaba",
  });

  assert.equal(rows.length, 1);
  assert.match(String(rows[0]?.operational_due_at ?? ""), /^2026-11-22T16:00:00/);
  assert.match(String(rows[0]?.charge_due_at ?? ""), /^2026-11-22T16:00:00/);
});
