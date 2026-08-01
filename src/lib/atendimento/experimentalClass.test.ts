import test from "node:test";
import assert from "node:assert/strict";
import {
  buildExperimentalClassAttendantWhatsAppMessage,
  buildExperimentalClassAttendantStartReminderWhatsAppMessage,
  buildExperimentalClassBookingChatMessages,
  buildExperimentalClassDatesMessages,
  buildExperimentalClassPostAttendanceWhatsAppMessage,
  buildExperimentalClassStudentLessonReadyWhatsAppMessage,
  buildExperimentalClassTimesMessages,
  deriveExperimentalClassBookingDisplayStatus,
  experimentalClassBookingDisplayStatusLabel,
  findExperimentalClassDateOption,
  findExperimentalClassTimeOption,
  listExperimentalClassAvailability,
} from "./experimentalClass.ts";

test("listExperimentalClassAvailability comeca no dia seguinte ao domingo atual, com todos os slots horarios", () => {
  const availability = listExperimentalClassAvailability({
    now: new Date("2026-07-12T10:00:00.000Z"),
    leadTimeZone: "America/Cuiaba",
    bookedProfessorStartAts: [],
  });

  const firstDate = availability.dates[0];
  const slots = availability.slotsByProfessorDate.get(firstDate.professorDate) ?? [];

  assert.equal(firstDate.professorDate, "2026-07-13");
  assert.deepEqual(
    slots.map((slot) => slot.professorTime),
    ["08:00", "09:30", "11:00", "12:30", "14:00", "15:30", "17:00", "18:30", "20:00"],
  );
});

test("listExperimentalClassAvailability remove slots que conflitam em 1h30 mantendo os demais livres", () => {
  const availability = listExperimentalClassAvailability({
    now: new Date("2026-07-12T10:00:00.000Z"),
    leadTimeZone: "America/Cuiaba",
    bookedProfessorStartAts: ["2026-07-24T17:30:00.000Z"],
  });

  const slots = availability.slotsByProfessorDate.get("2026-07-24") ?? [];
  const times = slots.map((slot) => slot.professorTime);

  assert.equal(times.includes("13:00"), false);
  assert.equal(times.includes("14:30"), true);
  assert.equal(times.includes("16:00"), true);
});

test("listExperimentalClassAvailability nao exibe domingos entre as datas restantes do mes", () => {
  const availability = listExperimentalClassAvailability({
    now: new Date("2026-07-24T10:00:00.000Z"),
    leadTimeZone: "America/Cuiaba",
    bookedProfessorStartAts: [],
  });

  assert.deepEqual(
    availability.dates.map((option) => option.professorDate),
    ["2026-07-24", "2026-07-25", "2026-07-26", "2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31"],
  );
});

test("listExperimentalClassAvailability vira automaticamente para o proximo mes quando nao ha mais slots no dia final", () => {
  const availability = listExperimentalClassAvailability({
    now: new Date("2026-07-31T23:00:00.000Z"),
    leadTimeZone: "America/Cuiaba",
    bookedProfessorStartAts: [],
  });

  assert.equal(availability.dates[0]?.professorDate, "2026-08-01");
  assert.equal(availability.dates.some((option) => option.professorDate === "2026-08-02"), false);
});

test("buildExperimentalClassDatesMessages mostra as duas mensagens com conjuncao final", () => {
  const messages = buildExperimentalClassDatesMessages([
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

  assert.deepEqual(messages, [
    "As datas disponíveis são:\n\n13 e 14.",
    "Responda apenas com a data desejada.",
  ]);
});

test("buildExperimentalClassTimesMessages mostra as duas mensagens de horario", () => {
  const messages = buildExperimentalClassTimesMessages({
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

  assert.deepEqual(messages, [
    "Perfeito! E os horários disponíveis são:\n\n13:00, 14:30",
    "Responda apenas com o horário desejado.",
  ]);
});

test("buildExperimentalClassBookingChatMessages monta o novo fechamento com primeiro nome", () => {
  const messages = buildExperimentalClassBookingChatMessages("Ana");

  assert.deepEqual(messages, [
    "Parabéns!",
    "É uma satisfação receber você para a sua primeira aula em Lucas Brum Online Music USA.",
    "Agora é só aguardar. No dia e horário escolhidos, enviaremos o link da sua aula experimental.",
  ]);
});

test("buildExperimentalClassAttendantWhatsAppMessage monta a notificacao do atendente", () => {
  assert.equal(
    buildExperimentalClassAttendantWhatsAppMessage(),
    "Você recebeu um novo agendamento de aula experimental.\n\nAcesse o link abaixo e adicione o link da aula ao interessado.\n\nhttps://www.autobot.business/app/atendimento",
  );
});

test("buildExperimentalClassStudentLessonReadyWhatsAppMessage monta a mensagem de inicio da aula para o aluno", () => {
  assert.equal(
    buildExperimentalClassStudentLessonReadyWhatsAppMessage("Pedro", "https://meet.google.com/abc-defg-hij"),
    "Olá, Pedro! 👋\n\nSua aula experimental já está disponível.\n\nLink da aula: https://meet.google.com/abc-defg-hij\n\nO professor Lucas Brum já está te aguardando.\n\nLembrando que ele aguardará por até 10 minutos. Após esse período, a aula será encerrada para dar continuidade aos demais agendamentos.",
  );
});

test("buildExperimentalClassAttendantStartReminderWhatsAppMessage monta o aviso do atendente antes da aula", () => {
  assert.equal(
    buildExperimentalClassAttendantStartReminderWhatsAppMessage("Pedro Silva", "https://meet.google.com/abc-defg-hij"),
    "A aula experimental do(a) aluno(a) Pedro Silva está perto de começar!\n\nLink da aula: https://meet.google.com/abc-defg-hij\n\nAguarde o(a) aluno(a) acessar a sala.",
  );
});

test("buildExperimentalClassPostAttendanceWhatsAppMessage monta a mensagem apos comparecimento", () => {
  assert.equal(
    buildExperimentalClassPostAttendanceWhatsAppMessage("Pedro"),
    "Show, Pedro! 😄\n\nFicamos felizes por você ter participado da aula experimental com o professor Lucas Brum.\n\nAgora é hora de dar o próximo passo!\n\nVamos confirmar sua matrícula e realizar o pagamento da primeira mensalidade para iniciar suas aulas?",
  );
});

test("deriveExperimentalClassBookingDisplayStatus resolve os status padronizados do agendamento", () => {
  assert.equal(
    deriveExperimentalClassBookingDisplayStatus({
      hasLead: true,
    }),
    "incomplete",
  );
  assert.equal(
    deriveExperimentalClassBookingDisplayStatus({
      bookingStatus: "scheduled",
    }),
    "scheduled",
  );
  assert.equal(
    deriveExperimentalClassBookingDisplayStatus({
      bookingStatus: "scheduled",
      studentStartNotificationSentAt: "2026-07-16T15:00:00.000Z",
      attendantStartNotificationSentAt: "2026-07-16T14:55:00.000Z",
    }),
    "in_progress",
  );
  assert.equal(
    deriveExperimentalClassBookingDisplayStatus({
      attendanceStatus: "no_show",
    }),
    "no_show",
  );
  assert.equal(
    deriveExperimentalClassBookingDisplayStatus({
      attendanceStatus: "attended",
    }),
    "completed",
  );
  assert.equal(experimentalClassBookingDisplayStatusLabel("incomplete"), "Incompleto");
  assert.equal(experimentalClassBookingDisplayStatusLabel("scheduled"), "Agendado");
  assert.equal(experimentalClassBookingDisplayStatusLabel("cancelled"), "Cancelado");
  assert.equal(experimentalClassBookingDisplayStatusLabel("in_progress"), "Em andamento");
  assert.equal(experimentalClassBookingDisplayStatusLabel("no_show"), "Não compareceu");
  assert.equal(experimentalClassBookingDisplayStatusLabel("completed"), "Concluído");
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

test("findExperimentalClassTimeOption aceita formatos equivalentes de horario", () => {
  const options = [
    {
      id: "2026-07-13|10:00",
      professorDate: "2026-07-13",
      professorTime: "10:00",
      professorStartAt: "2026-07-13T14:00:00.000Z",
      leadDate: "2026-07-13",
      leadTime: "10:00",
      displayLabel: "10:00",
    },
    {
      id: "2026-07-13|13:30",
      professorDate: "2026-07-13",
      professorTime: "13:30",
      professorStartAt: "2026-07-13T17:30:00.000Z",
      leadDate: "2026-07-13",
      leadTime: "13:30",
      displayLabel: "13:30",
    },
  ];

  assert.equal(findExperimentalClassTimeOption("10h", options)?.professorTime, "10:00");
  assert.equal(findExperimentalClassTimeOption("10 horas", options)?.professorTime, "10:00");
  assert.equal(findExperimentalClassTimeOption("10:00h", options)?.professorTime, "10:00");
  assert.equal(findExperimentalClassTimeOption("13h30", options)?.professorTime, "13:30");
  assert.equal(findExperimentalClassTimeOption("13h30min", options)?.professorTime, "13:30");
  assert.equal(findExperimentalClassTimeOption("13 horas 30 min", options)?.professorTime, "13:30");
  assert.equal(findExperimentalClassTimeOption("13:30h", options)?.professorTime, "13:30");
  assert.equal(findExperimentalClassTimeOption("13:30 h", options)?.professorTime, "13:30");
});
