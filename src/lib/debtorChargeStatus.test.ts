import test from "node:test";
import assert from "node:assert/strict";

import { deriveReferenceMonthDebtorChargeProgress } from "./debtorChargeStatus.ts";

test("deriveReferenceMonthDebtorChargeProgress nao conta pagamento antigo como recebido do mes atual", () => {
  const progress = deriveReferenceMonthDebtorChargeProgress(
    [
      {
        id: "charge-oct",
        due_day: 10,
        recurrence_month: 10,
        recurrence_year: 2026,
      },
    ],
    [
      {
        id: "schedule-oct",
        debtor_id: "debtor-1",
        charge_id: "charge-oct",
        status: "executado",
        charge_due_at: "2026-10-10T12:00:00.000Z",
        payment_received_at: "2026-09-10T12:00:00.000Z",
        schedule_timezone: "America/Sao_Paulo",
      },
    ],
    "2026-10-10T15:00:00.000Z",
  );

  assert.deepEqual(progress, { paid: 0, total: 1 });
});

test("deriveReferenceMonthDebtorChargeProgress conta pagamento confirmado no mes atual", () => {
  const progress = deriveReferenceMonthDebtorChargeProgress(
    [
      {
        id: "charge-oct",
        due_day: 10,
        recurrence_month: 10,
        recurrence_year: 2026,
      },
    ],
    [
      {
        id: "schedule-oct",
        debtor_id: "debtor-1",
        charge_id: "charge-oct",
        status: "pago",
        charge_due_at: "2026-10-10T12:00:00.000Z",
        payment_received_at: "2026-10-10T12:30:00.000Z",
        schedule_timezone: "America/Sao_Paulo",
      },
    ],
    "2026-10-10T15:00:00.000Z",
  );

  assert.deepEqual(progress, { paid: 1, total: 1 });
});
