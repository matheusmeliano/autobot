import test from "node:test";
import assert from "node:assert/strict";

import {
  getOpenMonthlyInstallments,
  nextRecurringIsoAfterSettlement,
} from "./chargeAccumulation.ts";

test("getOpenMonthlyInstallments acumula outubro e novembro quando novembro vira sem pagamento", () => {
  const installments = getOpenMonthlyInstallments({
    chargeDueAt: "2026-10-27T16:00:00.000Z",
    nowUtcIso: "2026-11-01T15:00:00.000Z",
    timeZone: "America/Cuiaba",
  });

  assert.equal(installments, 2);
});

test("nextRecurringIsoAfterSettlement avanca apenas um mes quando a quitacao consome a pendencia mais antiga", () => {
  const nextIso = nextRecurringIsoAfterSettlement({
    accumulateOpenMonthlyCharges: false,
    chargeDueAt: "2026-10-27T16:00:00.000Z",
    nowUtcIso: "2026-11-01T15:00:00.000Z",
    timeZone: "America/Cuiaba",
    day: 27,
    time: "12:00",
    recurrence: "monthly",
    targetMonth: 10,
    targetYear: 2026,
  });

  assert.match(nextIso, /^2026-11-27T16:00:00/);
});

test("nextRecurringIsoAfterSettlement mantem o salto total quando a quitacao consome todo o acumulado", () => {
  const nextIso = nextRecurringIsoAfterSettlement({
    accumulateOpenMonthlyCharges: true,
    chargeDueAt: "2026-10-27T16:00:00.000Z",
    nowUtcIso: "2026-11-01T15:00:00.000Z",
    timeZone: "America/Cuiaba",
    day: 27,
    time: "12:00",
    recurrence: "monthly",
    targetMonth: 10,
    targetYear: 2026,
  });

  assert.match(nextIso, /^2026-12-27T16:00:00/);
});
