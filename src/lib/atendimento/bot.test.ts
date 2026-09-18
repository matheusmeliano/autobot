import test from "node:test";
import assert from "node:assert/strict";
import { botReplyForLead, extractLeadDataFromMessage, filterCapturedDataForLead, getNextMissingField, initialBotMessages } from "./bot.ts";
import { buildExperimentalClassDatePromptMessages, EXPERIMENTAL_CLASS_DATE_PROMPT_MESSAGE } from "./constants.ts";
import { resolveTimeZoneFromCityInput, resolveTimeZoneFromStateInput } from "../timezone.ts";

test("extractLeadDataFromMessage captura apenas nome, captura de telefone e proibida para evitar contatos importados", () => {
  const data = extractLeadDataFromMessage(
    "Olá, meu nome é Ana Maria, meu CPF é 123.456.789-10, meu e-mail é ana@email.com e meu telefone é +1 321 555 9988.",
  );

  assert.equal(data.full_name, "Ana Maria");
  assert.equal(data.phone, undefined);
});

test("getNextMissingField retorna null quando o pre-cadastro estiver completo", () => {
  const nextField = getNextMissingField({
    full_name: "Ana Maria",
    phone: "+1 321 555 9988",
    state: "Florida",
    city: "Orlando",
  });

  assert.equal(nextField, null);
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
    state: "",
    city: "",
  });

  assert.equal(nextField, "phone");
});

test("getNextMissingField pede estado depois do whatsapp validado", () => {
  const nextField = getNextMissingField({
    full_name: "Ana Maria",
    phone: "+1 321 555 9988",
    state: "",
    city: "",
  });

  assert.equal(nextField, "state");
});

test("getNextMissingField pede cidade depois do estado informado", () => {
  const nextField = getNextMissingField({
    full_name: "Ana Maria",
    phone: "+1 321 555 9988",
    state: "Florida",
    city: "",
  });

  assert.equal(nextField, "city");
});

test("extractLeadDataFromMessage nao trata horario como nome", () => {
  const data = extractLeadDataFromMessage("Às 19:h");

  assert.equal(data.full_name, undefined);
});

test("extractLeadDataFromMessage nao trata timezone como nome", () => {
  const data = extractLeadDataFromMessage("America/New_York ou GMT-4");

  assert.equal(data.full_name, undefined);
});

test("filterCapturedDataForLead nao sobrescreve nome existente quando o campo esperado nao for nome", () => {
  const captured = filterCapturedDataForLead({
    lead: {
      full_name: "Ana Divina Pereira",
      phone: "",
    },
    captured: {
      full_name: "Nome errado",
      phone: "+1 321 555 9988",
    },
    expectedField: "phone",
  });

  assert.deepEqual(captured, {
    phone: "+1 321 555 9988",
  });
});

test("botReplyForLead encerra o pre-cadastro pedindo a data da aula experimental", () => {
  const reply = botReplyForLead({
    lead: {
      full_name: "Ana Maria",
      phone: "+1 321 555 9988",
      state: "Florida",
      city: "Orlando",
    } as any,
    messageText: "Orlando",
  });

  assert.equal(reply.message, EXPERIMENTAL_CLASS_DATE_PROMPT_MESSAGE);
  assert.equal(reply.stage, "pre_cadastro_concluido");
  assert.equal(reply.status, "matricula_pendente");
});

test("buildExperimentalClassDatePromptMessages monta a nova sequencia com o nome do lead", () => {
  assert.deepEqual(buildExperimentalClassDatePromptMessages("Ana Maria"), [
    "Ana, agora é só escolher o melhor dia e horário para sua aula experimental, COM BASE NO HORÁRIO DA SUA CIDADE.",
  ]);
  assert.deepEqual(buildExperimentalClassDatePromptMessages(null), [
    "Aluno, agora é só escolher o melhor dia e horário para sua aula experimental, COM BASE NO HORÁRIO DA SUA CIDADE.",
  ]);
});

test("resolveTimeZoneFromCityInput identifica Orlando automaticamente", () => {
  const resolution = resolveTimeZoneFromCityInput({
    state: "Florida",
    city: "Orlando, FL",
    phone: "+1 321 555 9988",
  });

  assert.equal(resolution?.timeZone, "America/New_York");
  assert.equal(resolution?.country, "US");
});

test("resolveTimeZoneFromStateInput identifica Florida automaticamente", () => {
  const resolution = resolveTimeZoneFromStateInput({
    state: "Florida",
    phone: "+1 321 555 9988",
  });

  assert.equal(resolution?.timeZone, "America/New_York");
  assert.equal(resolution?.country, "US");
});

test("resolveTimeZoneFromStateInput identifica Mato Grosso automaticamente", () => {
  const resolution = resolveTimeZoneFromStateInput({
    state: "Mato Grosso",
    phone: "+55 65 99999-9999",
  });

  assert.equal(resolution?.timeZone, "America/Cuiaba");
  assert.equal(resolution?.country, "BR");
});

test("resolveTimeZoneFromStateInput reconhece estados US por nome completo (ex: Florida)", () => {
  const resolution = resolveTimeZoneFromStateInput({
    state: "Florida",
    phone: "+1 321 555 9988",
  });

  assert.equal(resolution?.state, "Florida");
  assert.equal(resolution?.timeZone, "America/New_York");
  assert.equal(resolution?.country, "US");
});

test("resolveTimeZoneFromStateInput reconhece estados US por sigla maiuscula (FL)", () => {
  const resolution = resolveTimeZoneFromStateInput({
    state: "FL",
    phone: "+1 321 555 9988",
  });

  assert.equal(resolution?.state, "Florida");
  assert.equal(resolution?.normalizedState, "florida");
  assert.equal(resolution?.timeZone, "America/New_York");
  assert.equal(resolution?.country, "US");
});

test("resolveTimeZoneFromStateInput reconhece estados US por sigla minuscula (fl)", () => {
  const resolution = resolveTimeZoneFromStateInput({
    state: "fl",
    phone: "+1 321 555 9988",
  });

  assert.equal(resolution?.state, "Florida");
  assert.equal(resolution?.normalizedState, "florida");
  assert.equal(resolution?.timeZone, "America/New_York");
  assert.equal(resolution?.country, "US");
});

test("resolveTimeZoneFromStateInput reconhece estado US com prefixo em frase 'Moro em CA'", () => {
  const resolution = resolveTimeZoneFromStateInput({
    state: "Moro em CA",
    phone: "+1 213 555 9988",
  });

  assert.equal(resolution?.state, "California");
  assert.equal(resolution?.timeZone, "America/Los_Angeles");
  assert.equal(resolution?.country, "US");
});

test("resolveTimeZoneFromStateInput reconhece Texas TX com cidade depois, nome ou sigla", () => {
  const byAbbr = resolveTimeZoneFromStateInput({ state: "TX", phone: "+1 512 555 9988" });
  assert.equal(byAbbr?.state, "Texas");
  assert.equal(byAbbr?.timeZone, "America/Chicago");
  assert.equal(byAbbr?.country, "US");

  const byFull = resolveTimeZoneFromStateInput({ state: "Texas", phone: "+1 512 555 9988" });
  assert.equal(byFull?.state, "Texas");
  assert.equal(byFull?.timeZone, "America/Chicago");
  assert.equal(byFull?.country, "US");
});

test("resolveTimeZoneFromStateInput reconhece MA = Massachusetts (nao Maine)", () => {
  const resolution = resolveTimeZoneFromStateInput({
    state: "MA",
    phone: "+1 617 555 9988",
  });
  assert.equal(resolution?.state, "Massachusetts");
  assert.equal(resolution?.timeZone, "America/New_York");
  assert.equal(resolution?.country, "US");
});

test("resolveTimeZoneFromStateInput reconhece NY e Washington WA = Washington state", () => {
  const ny = resolveTimeZoneFromStateInput({ state: "NY", phone: "+1 212 555 9988" });
  assert.equal(ny?.state, "New York");
  assert.equal(ny?.timeZone, "America/New_York");

  const wa = resolveTimeZoneFromStateInput({ state: "WA", phone: "+1 206 555 9988" });
  assert.equal(wa?.state, "Washington");
  assert.equal(wa?.timeZone, "America/Los_Angeles");
});

test("resolveTimeZoneFromCityInput aceita estado US por sigla (Orlando FL)", () => {
  const resolution = resolveTimeZoneFromCityInput({
    state: "FL",
    city: "Orlando",
    phone: "+1 321 555 9988",
    allowPhoneCountryFallback: false,
  });

  assert.equal(resolution?.state, "Florida");
  assert.equal(resolution?.normalizedState, "florida");
  assert.equal(resolution?.city, "orlando");
  assert.equal(resolution?.timeZone, "America/New_York");
  assert.equal(resolution?.country, "US");
});

test("resolveTimeZoneFromCityInput reconhece estado cidade inexistente mas estado CA por sigla => state_match fallback", () => {
  const resolution = resolveTimeZoneFromCityInput({
    state: "CA",
    city: "Cidade Californiana Inexistente",
    phone: "+1 213 555 9988",
    allowPhoneCountryFallback: true,
  });

  assert.equal(resolution?.source, "state_match");
  assert.equal(resolution?.state, "California");
  assert.equal(resolution?.normalizedState, "california");
  assert.equal(resolution?.timeZone, "America/Los_Angeles");
  assert.equal(resolution?.country, "US");
});

test("resolveTimeZoneFromCityInput aceita cidade brasileira com estado validado (match direto cidade+estado)", () => {
  const resolution = resolveTimeZoneFromCityInput({
    state: "Mato Grosso",
    city: "Primavera do Leste",
    phone: "+55 65 99999-9999",
    allowPhoneCountryFallback: false,
  });

  assert.equal(resolution?.timeZone, "America/Cuiaba");
  assert.equal(resolution?.country, "BR");
  assert.equal(resolution?.source, "city_match");
  assert.equal(resolution?.city, "primavera do leste");
  assert.equal(resolution?.normalizedCity, "primavera do leste");
  assert.equal(resolution?.state, "mato grosso");
  assert.equal(resolution?.normalizedState, "mato grosso");
});

test("resolveTimeZoneFromCityInput falha sem fallback quando a cidade nao for reconhecida", () => {
  const resolution = resolveTimeZoneFromCityInput({
    state: "Florida",
    city: "Cidade Inexistente",
    phone: "+1 321 555 9988",
    allowPhoneCountryFallback: false,
  });

  assert.equal(resolution, null);
});
