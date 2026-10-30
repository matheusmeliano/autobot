import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveReferenceMonthDebtorChargeProgress,
  deriveReferenceMonthDebtorStatus,
} from "./debtorChargeStatus.ts";

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

test("deriveReferenceMonthDebtorChargeProgress nao conta disparo executado sem pagamento como recebido", () => {
  const progress = deriveReferenceMonthDebtorChargeProgress(
    [],
    [
      {
        id: "schedule-oct",
        debtor_id: "debtor-1",
        status: "executado",
        charge_due_at: "2026-11-10T12:00:00.000Z",
        last_executed_scheduled_for: "2026-10-10T12:00:00.000Z",
        payment_received_at: null,
        schedule_timezone: "America/Sao_Paulo",
      },
    ],
    "2026-10-25T15:00:00.000Z",
  );

  assert.deepEqual(progress, { paid: 0, total: 1 });
});

test("deriveReferenceMonthDebtorStatus nao marca como pago quando houve apenas disparo", () => {
  const status = deriveReferenceMonthDebtorStatus(
    [],
    [
      {
        id: "schedule-oct",
        debtor_id: "debtor-1",
        status: "executado",
        charge_due_at: "2026-11-10T12:00:00.000Z",
        last_executed_scheduled_for: "2026-10-10T12:00:00.000Z",
        payment_received_at: null,
        schedule_timezone: "America/Sao_Paulo",
      },
    ],
    "2026-10-25T15:00:00.000Z",
  );

  assert.equal(status, "agendado");
});

test("deriveReferenceMonthDebtorStatus marca como nao pago imediatamente apos disparo sem pagamento", () => {
  const status = deriveReferenceMonthDebtorStatus(
    [
      {
        id: "charge-oct",
        due_day: 29,
        recurrence_month: 10,
        recurrence_year: 2026,
      },
    ],
    [
      {
        id: "schedule-oct",
        debtor_id: "debtor-1",
        charge_id: "charge-oct",
        status: "pendente",
        data_envio: "2026-10-29T16:00:00.000Z",
        charge_due_at: "2026-10-29T16:00:00.000Z",
        first_sent_at: "2026-10-29T16:00:06.000Z",
        last_sent_at: "2026-10-29T16:00:06.000Z",
        payment_received_at: null,
        schedule_timezone: "America/Cuiaba",
      },
    ],
    "2026-10-29T16:05:00.000Z",
  );

  assert.equal(status, "nao_pago");
});

test("deriveReferenceMonthDebtorStatus ignora pagamento antigo preso no mesmo agendamento recorrente", () => {
  const status = deriveReferenceMonthDebtorStatus(
    [
      {
        id: "charge-oct",
        due_day: 27,
        recurrence_month: 10,
        recurrence_year: 2026,
      },
    ],
    [
      {
        id: "schedule-oct",
        debtor_id: "debtor-1",
        charge_id: "charge-oct",
        status: "pendente",
        data_envio: "2026-10-29T16:00:00.000Z",
        charge_due_at: "2026-10-27T16:00:00.000Z",
        first_sent_at: "2026-10-27T16:00:06.000Z",
        last_sent_at: "2026-10-29T16:00:06.000Z",
        payment_received_at: "2026-09-28T12:58:34.556Z",
        schedule_timezone: "America/Cuiaba",
      },
    ],
    "2026-10-29T16:05:00.000Z",
  );

  assert.equal(status, "nao_pago");
});
