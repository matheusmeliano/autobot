import test from "node:test";
import assert from "node:assert/strict";

import { detectPhoneCountry, formatPhoneNumber, normalizePhoneDigits } from "./phone.ts";

test("normalizePhoneDigits remove caracteres não numéricos", () => {
  assert.equal(normalizePhoneDigits("+351 912 345 678"), "351912345678");
});

test("detectPhoneCountry reconhece BR, US e PT", () => {
  assert.equal(detectPhoneCountry("+55 (65) 99693-3336"), "BR");
  assert.equal(detectPhoneCountry("+1 (555) 555-1234"), "US");
  assert.equal(detectPhoneCountry("+351 912 345 678"), "PT");
});

test("formatPhoneNumber aplica o padrão obrigatório do Brasil com código internacional", () => {
  assert.equal(
    formatPhoneNumber("5565996933336", { defaultCountry: "BR", includeCountryCode: true }),
    "+55 (65) 99693-3336",
  );
});

test("formatPhoneNumber aplica o padrão obrigatório do Brasil sem código internacional", () => {
  assert.equal(
    formatPhoneNumber("65996933336", { defaultCountry: "BR", includeCountryCode: false }),
    "(65) 99693-3336",
  );
});

test("formatPhoneNumber aplica o padrão obrigatório dos Estados Unidos", () => {
  assert.equal(
    formatPhoneNumber("14155551234", { defaultCountry: "US", includeCountryCode: true }),
    "+1 (415) 555-1234",
  );
});

test("formatPhoneNumber aplica o padrão obrigatório de Portugal", () => {
  assert.equal(
    formatPhoneNumber("351912345678", { defaultCountry: "PT", includeCountryCode: true }),
    "+351 912 345 678",
  );
});

test("formatPhoneNumber corta dígitos extras em vez de deixá-los sobrando no final", () => {
  assert.equal(
    formatPhoneNumber("55659969333366", { defaultCountry: "BR", includeCountryCode: true }),
    "+55 (65) 99693-3336",
  );
});
