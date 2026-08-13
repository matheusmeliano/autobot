import test from "node:test";
import assert from "node:assert/strict";
import {
  buildExperimentalClassAttendantWhatsAppMessage,
  buildExperimentalClassAttendantStartReminderWhatsAppMessage,
  buildExperimentalClassBookingChatMessages,
  buildExperimentalClassDatesMessages,
  buildExperimentalClassNoShowRepescagemWhatsAppMessages,
  buildExperimentalClassPostAttendanceWhatsAppMessages,
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
    "Show, Ana! Vai ser um prazer conhecer você na aula. 😊",
    "Agora é só aguardar. No dia agendado, vamos enviar o link da sua aula por aqui.",
  ]);
});

test("buildExperimentalClassAttendantWhatsAppMessage monta a notificacao do atendente com nome", () => {
  assert.equal(
    buildExperimentalClassAttendantWhatsAppMessage("Maria Souza"),
    "Você recebeu um novo agendamento de aula experimental para Maria.\n\nAcesse o link abaixo e adicione o link da aula ao interessado.\n\nhttps://www.autobot.business/app/atendimento",
  );
});

test("buildExperimentalClassAttendantWhatsAppMessage usa fallback quando nome vazio", () => {
  assert.equal(
    buildExperimentalClassAttendantWhatsAppMessage(""),
    "Você recebeu um novo agendamento de aula experimental para o interessado.\n\nAcesse o link abaixo e adicione o link da aula ao interessado.\n\nhttps://www.autobot.business/app/atendimento",
  );
});

test("buildExperimentalClassStudentLessonReadyWhatsAppMessage monta a mensagem de inicio da aula para o aluno", () => {
  assert.equal(
    buildExperimentalClassStudentLessonReadyWhatsAppMessage("Pedro Henrique", "https://meet.google.com/abc-defg-hij"),
    "Pedro, sua aula experimental já está disponível.\n\nLink da aula: https://meet.google.com/abc-defg-hij\n\nO professor Lucas Brum já está te aguardando.\n\nLembrando que ele aguardará por até 10 minutos. Após esse período, a aula será encerrada para dar continuidade aos demais agendamentos.",
  );
});

test("buildExperimentalClassAttendantStartReminderWhatsAppMessage monta o aviso do atendente antes da aula com nome", () => {
  assert.equal(
    buildExperimentalClassAttendantStartReminderWhatsAppMessage("Pedro Silva", "https://meet.google.com/abc-defg-hij"),
    "A aula experimental de Pedro está perto de começar!\n\nLink da aula: https://meet.google.com/abc-defg-hij",
  );
});

test("buildExperimentalClassPostAttendanceWhatsAppMessages envia 1 mensagem UNICA (4 blocos juntos com \\n\\n) apos comparecimento, com primeiro nome", () => {
  const messages = buildExperimentalClassPostAttendanceWhatsAppMessages("Pedro Henrique");
  assert.equal(Array.isArray(messages), true);
  assert.equal(messages.length, 1);
  assert.equal(
    messages[0],
    [
      "Pedro, ficamos felizes pela sua participação na aula experimental!",
      "Agora é hora do próximo passo.",
      "Vamos confirmar sua matrícula e iniciar suas aulas?",
      "Responda com sim ou não.",
    ].join("\n\n"),
  );
});

test("buildExperimentalClassNoShowRepescagemWhatsAppMessages prefixa o primeiro nome na 1a mensagem", () => {
  const withName = buildExperimentalClassNoShowRepescagemWhatsAppMessages("Maria Silva");
  assert.equal(withName[0], "Maria, notamos que você não compareceu à aula experimental.");
  assert.equal(withName[1], "Mas não se preocupe, novas oportunidades estarão disponíveis.");
  assert.equal(withName[2], "Em breve nossa equipe entrará em contato.");

  const withoutName = buildExperimentalClassNoShowRepescagemWhatsAppMessages(null);
  assert.equal(withoutName[0], "Notamos que você não compareceu à aula experimental.");
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

test("findExperimentalClassTimeOption prioriza horario do usuario (lead/displayLabel) sobre horario do professor quando valores coincidem em opcoes diferentes (fuso LA vs Cuiaba)", () => {
  const slotsOverlapping = [
    {
      id: "2026-08-03|09:30",
      professorDate: "2026-08-03",
      professorTime: "09:30",
      professorStartAt: "2026-08-03T13:30:00.000Z",
      leadDate: "2026-08-03",
      leadTime: "06:30",
      displayLabel: "06:30",
    },
    {
      id: "2026-08-03|12:30",
      professorDate: "2026-08-03",
      professorTime: "12:30",
      professorStartAt: "2026-08-03T16:30:00.000Z",
      leadDate: "2026-08-03",
      leadTime: "09:30",
      displayLabel: "09:30",
    },
    {
      id: "2026-08-03|15:30",
      professorDate: "2026-08-03",
      professorTime: "15:30",
      professorStartAt: "2026-08-03T19:30:00.000Z",
      leadDate: "2026-08-03",
      leadTime: "12:30",
      displayLabel: "12:30",
    },
    {
      id: "2026-08-03|18:30",
      professorDate: "2026-08-03",
      professorTime: "18:30",
      professorStartAt: "2026-08-03T22:30:00.000Z",
      leadDate: "2026-08-03",
      leadTime: "15:30",
      displayLabel: "15:30",
    },
  ];

  const pick1230 = findExperimentalClassTimeOption("12:30", slotsOverlapping);
  assert.equal(pick1230?.leadTime, "12:30", "12:30 digitado deve bater com leadTime=12:30 do slot 15:30 professor (usuario LA escolhe o que VIU)");
  assert.equal(pick1230?.professorTime, "15:30", "professorTime deve ser 15:30 Cuiaba (convertido)");

  const pick0930 = findExperimentalClassTimeOption("09:30", slotsOverlapping);
  assert.equal(pick0930?.leadTime, "09:30", "09:30 digitado deve bater com leadTime=09:30 do slot 12:30 professor");
  assert.equal(pick0930?.professorTime, "12:30");

  const pick12h30 = findExperimentalClassTimeOption("12h30", slotsOverlapping);
  assert.equal(pick12h30?.leadTime, "12:30", "formato 12h30 flexivel tambem prioriza lead");
  assert.equal(pick12h30?.professorTime, "15:30");
});

test("findExperimentalClassTimeOption fallback para professorTime quando horario NAO existe do lado do usuario", () => {
  const options = [
    {
      id: "2026-08-03|14:00",
      professorDate: "2026-08-03",
      professorTime: "14:00",
      professorStartAt: "2026-08-03T18:00:00.000Z",
      leadDate: "2026-08-03",
      leadTime: "11:00",
      displayLabel: "11:00",
    },
  ];

  const fallback = findExperimentalClassTimeOption("14:00", options);
  assert.equal(fallback?.professorTime, "14:00", "se usuario digitar horario do professor diretamente, ainda deve acertar (fallback retrocompatibilidade)");
  assert.equal(fallback?.leadTime, "11:00");
});
