import test from "node:test";
import assert from "node:assert/strict";
import { extractLeadDataFromMessage, getNextMissingField, initialBotMessages } from "./bot.ts";

test("extractLeadDataFromMessage captura cpf, email e telefone", () => {
  const data = extractLeadDataFromMessage(
    "Olá, meu nome é Ana Maria, meu CPF é 123.456.789-10, meu e-mail é ana@email.com e meu telefone é +1 321 555 9988.",
  );

  assert.equal(data.cpf, "123.456.789-10");
  assert.equal(data.email, "ana@email.com");
  assert.equal(data.phone, "+1 321 555 9988");
});

test("getNextMissingField respeita a ordem do pré-cadastro", () => {
  const nextField = getNextMissingField({
    full_name: "Ana Maria",
    phone: "+1 321 555 9988",
    cpf: "123.456.789-10",
    email: "",
  });

  assert.equal(nextField, "email");
});

test("initialBotMessages inicia o fluxo com convite e pré-cadastro", () => {
  const messages = initialBotMessages();

  assert.equal(messages.length, 4);
  assert.match(messages[0], /bem-vindo/i);
  assert.match(messages[2], /aula experimental/i);
});
