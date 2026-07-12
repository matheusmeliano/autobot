import test from "node:test";
import assert from "node:assert/strict";
import {
  buildExperimentalClassDatesMessage,
  buildExperimentalClassTimesMessage,
  findExperimentalClassDateOption,
  findExperimentalClassTimeOption,
  listExperimentalClassAvailability,
} from "./experimentalClass.ts";

test("listExperimentalClassAvailability gera apenas slots de 1h30 entre 13:00 e 16:00", () => {
  const availability = listExperimentalClassAvailability({
    now: new Date("2026-07-12T10:00:00.000Z"),
    leadTimeZone: "America/Cuiaba",
    bookedProfessorStartAts: [],
  });

  const firstDate = availability.dates[0];
  const slots = availability.slotsByProfessorDate.get(firstDate.professorDate) ?? [];

  assert.deepEqual(
    slots.map((slot) => slot.professorTime),
    ["13:00", "14:30", "16:00"],
  );
});

test("listExperimentalClassAvailability remove slots que conflitam em 1h30", () => {
  const availability = listExperimentalClassAvailability({
    now: new Date("2026-07-12T10:00:00.000Z"),
    leadTimeZone: "America/Cuiaba",
    bookedProfessorStartAts: ["2026-07-13T17:30:00.000Z"],
  });

  const slots = availability.slotsByProfessorDate.get("2026-07-13") ?? [];

  assert.deepEqual(
    slots.map((slot) => slot.professorTime),
    ["14:30", "16:00"],
  );
});

test("buildExperimentalClassDatesMessage mostra apenas os dias selecionaveis", () => {
  const message = buildExperimentalClassDatesMessage([
    {
      id: "2026-07-13",
      professorDate: "2026-07-13",
      leadDate: "2026-07-13",
      dayLabel: "13",
      displayLabel: "13",
      slotCount: 3,
    },
    {
      id: "2026-07-14",
      professorDate: "2026-07-14",
      leadDate: "2026-07-14",
      dayLabel: "14",
      displayLabel: "14",
      slotCount: 2,
    },
  ]);

  assert.equal(message, "Disponível: 13, 14");
});

test("buildExperimentalClassTimesMessage mostra apenas os horarios selecionaveis", () => {
  const message = buildExperimentalClassTimesMessage({
    dayLabel: "13",
    options: [
      {
        id: "2026-07-13|13:00",
        professorDate: "2026-07-13",
        professorTime: "13:00",
        professorStartAt: "2026-07-13T17:00:00.000Z",
        leadDate: "2026-07-13",
        leadTime: "13:00",
        displayLabel: "13:00",
      },
      {
        id: "2026-07-13|14:30",
        professorDate: "2026-07-13",
        professorTime: "14:30",
        professorStartAt: "2026-07-13T18:30:00.000Z",
        leadDate: "2026-07-13",
        leadTime: "14:30",
        displayLabel: "14:30",
      },
    ],
  });

  assert.equal(message, "Horários disponíveis: 13:00, 14:30");
});

test("findExperimentalClassDateOption aceita apenas dia exibido", () => {
  const option = findExperimentalClassDateOption("13", [
    {
      id: "2026-07-13",
      professorDate: "2026-07-13",
      leadDate: "2026-07-13",
      dayLabel: "13",
      displayLabel: "13",
      slotCount: 3,
    },
  ]);

  const invalid = findExperimentalClassDateOption("15", [
    {
      id: "2026-07-13",
      professorDate: "2026-07-13",
      leadDate: "2026-07-13",
      dayLabel: "13",
      displayLabel: "13",
      slotCount: 3,
    },
  ]);

  assert.equal(option?.professorDate, "2026-07-13");
  assert.equal(invalid, null);
});

test("findExperimentalClassTimeOption aceita apenas horario exibido", () => {
  const option = findExperimentalClassTimeOption("14:30", [
    {
      id: "2026-07-13|14:30",
      professorDate: "2026-07-13",
      professorTime: "14:30",
      professorStartAt: "2026-07-13T18:30:00.000Z",
      leadDate: "2026-07-13",
      leadTime: "14:30",
      displayLabel: "14:30",
    },
  ]);

  const invalid = findExperimentalClassTimeOption("15:00", [
    {
      id: "2026-07-13|14:30",
      professorDate: "2026-07-13",
      professorTime: "14:30",
      professorStartAt: "2026-07-13T18:30:00.000Z",
      leadDate: "2026-07-13",
      leadTime: "14:30",
      displayLabel: "14:30",
    },
  ]);

  assert.equal(option?.professorTime, "14:30");
  assert.equal(invalid, null);
});
