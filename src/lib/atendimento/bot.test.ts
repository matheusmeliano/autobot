import test from "node:test";
import assert from "node:assert/strict";
import { extractLeadDataFromMessage, filterCapturedDataForLead, getNextMissingField, initialBotMessages } from "./bot.ts";

test("extractLeadDataFromMessage captura email e telefone", () => {
  const data = extractLeadDataFromMessage(
    "Olá, meu nome é Ana Maria, meu CPF é 123.456.789-10, meu e-mail é ana@email.com e meu telefone é +1 321 555 9988.",
  );

  assert.equal(data.email, "ana@email.com");
  assert.equal(data.phone, "+1 321 555 9988");
});

test("getNextMissingField respeita a ordem do pré-cadastro", () => {
  const nextField = getNextMissingField({
    full_name: "Ana Maria",
    phone: "+1 321 555 9988",
    email: "",
  });

  assert.equal(nextField, "email");
});

test("initialBotMessages inicia o fluxo com convite e pré-cadastro", () => {
  const messages = initialBotMessages();

  assert.equal(messages.length, 4);
  assert.match(messages[0], /bem-vindo/i);
  assert.match(messages[2], /aula experimental/i);
  assert.equal(
    messages[3],
    "Perfeito! Para começarmos, informe o número do seu WhatsApp.\n\nBrasil: +55 (65) 99999-9999\nEstados Unidos: +1 (407) 555-1234\n\nImportante: inclua o código do país no início do número (+55 para Brasil ou +1 para Estados Unidos).",
  );
});

test("initialBotMessages inclui o primeiro nome quando ele estiver disponivel", () => {
  const messages = initialBotMessages({ userName: "Ana Maria" });

  assert.equal(messages[0], "Olá, Ana! Seja muito bem-vindo(a) ao Lucas Brum Online Music USA.");
});

test("getNextMissingField pede whatsapp depois do nome ja preenchido", () => {
  const nextField = getNextMissingField({
    full_name: "Ana Maria",
    phone: "",
    cpf: "",
    email: "",
  });

  assert.equal(nextField, "phone");
});

test("extractLeadDataFromMessage nao trata horario como nome", () => {
  const data = extractLeadDataFromMessage("Às 19:h");

  assert.equal(data.full_name, undefined);
});

test("extractLeadDataFromMessage nao trata timezone como nome", () => {
  const data = extractLeadDataFromMessage("America/New_York ou GMT-4");

  assert.equal(data.timezone, "America/New_York");
  assert.equal(data.full_name, undefined);
});

test("filterCapturedDataForLead nao sobrescreve nome existente com outro campo", () => {
  const captured = filterCapturedDataForLead({
    lead: {
      full_name: "Ana Divina Pereira",
      best_contact_time: "",
    } as any,
    captured: {
      full_name: "Às :h",
      best_contact_time: "Às 19:h",
    },
    expectedField: "best_contact_time",
  });

  assert.deepEqual(captured, {
    best_contact_time: "Às 19:h",
  });
});
