import test from "node:test";
import assert from "node:assert/strict";

import {
  getOpenMonthlyInstallments,
  nextRecurringIsoAfterSettlement,
} from "./chargeAccumulation.ts";

test("getOpenMonthlyInstallments mantem apenas a pendencia vencida ate a nova data de vencimento", () => {
  const installments = getOpenMonthlyInstallments({
    chargeDueAt: "2026-10-27T16:00:00.000Z",
    nowUtcIso: "2026-11-01T15:00:00.000Z",
    timeZone: "America/Cuiaba",
  });

  assert.equal(installments, 1);
});

test("getOpenMonthlyInstallments acumula a nova mensalidade apenas no dia do vencimento seguinte", () => {
  const installments = getOpenMonthlyInstallments({
    chargeDueAt: "2026-10-27T16:00:00.000Z",
    nowUtcIso: "2026-11-27T15:00:00.000Z",
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

test("nextRecurringIsoAfterSettlement mantem novembro em aberto quando o pagamento ocorre antes do novo vencimento", () => {
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

  assert.match(nextIso, /^2026-11-27T16:00:00/);
});

test("nextRecurringIsoAfterSettlement avanca para dezembro quando novembro ja venceu sem pagamento", () => {
  const nextIso = nextRecurringIsoAfterSettlement({
    accumulateOpenMonthlyCharges: true,
    chargeDueAt: "2026-10-27T16:00:00.000Z",
    nowUtcIso: "2026-11-27T15:00:00.000Z",
    timeZone: "America/Cuiaba",
    day: 27,
    time: "12:00",
    recurrence: "monthly",
    targetMonth: 10,
    targetYear: 2026,
  });

  assert.match(nextIso, /^2026-12-27T16:00:00/);
});
