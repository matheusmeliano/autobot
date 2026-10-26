import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveAgendarVisualStatus,
  getAgendarDisplayReferenceMoment,
} from "./agendarStatus.ts";

test("deriveAgendarVisualStatus mostra executado pago no mes atual quando o proximo ciclo ja avancou", () => {
  const visualStatus = deriveAgendarVisualStatus(
    {
      status: "agendado",
      charge_due_at: "2026-11-09T16:00:00.000Z",
      payment_received_at: "2026-10-12T18:25:05.822Z",
      last_executed_scheduled_for: "2026-10-12T16:00:00.000Z",
    },
    "America/Cuiaba",
    "2026-10",
  );

  assert.equal(visualStatus.label, "Executado");
  assert.equal(visualStatus.subtitle, "Pago");
  assert.equal(visualStatus.isExecuted, true);
  assert.equal(visualStatus.isPaid, true);
  assert.equal(visualStatus.referenceMonthKey, "2026-10");
  assert.equal(visualStatus.isCurrentMonth, true);
});

test("getAgendarDisplayReferenceMoment prioriza o ciclo liquidado do mes atual antes do proximo vencimento", () => {
  const referenceMoment = getAgendarDisplayReferenceMoment(
    {
      status: "agendado",
      charge_due_at: "2026-11-09T16:00:00.000Z",
      payment_received_at: "2026-10-12T18:25:05.822Z",
      last_executed_scheduled_for: "2026-10-12T16:00:00.000Z",
    },
    "America/Cuiaba",
    "2026-10",
  );

  assert.equal(referenceMoment, "2026-10-12T18:25:05.822Z");
});
