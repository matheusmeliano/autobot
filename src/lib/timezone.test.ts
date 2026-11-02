import test from "node:test";
import assert from "node:assert/strict";
import {
  inferTimeZoneFromPhoneCountryCode,
  resolveStudentTimezone,
  resolveTimeZoneFromCityInput,
  resolveTimeZoneFromStateInput,
} from "./timezone.ts";

test("resolveStudentTimezone identifica Massachusetts como America/New_York", () => {
  const timeZone = resolveStudentTimezone({
    city: "Boston",
    state: "Massachusetts",
    phone: "+1 617 555 0100",
  });

  assert.equal(timeZone, "America/New_York");
});

test("resolveStudentTimezone identifica noroeste da Florida como America/Chicago", () => {
  const timeZone = resolveStudentTimezone({
    city: "Destin",
    state: "Florida",
    phone: "+1 850 555 0100",
  });

  assert.equal(timeZone, "America/Chicago");
});

test("resolveStudentTimezone identifica Portugal continental como Europe/Lisbon", () => {
  const timeZone = resolveStudentTimezone({
    city: "Lisboa",
    state: "Portugal",
    phone: "+351 912 345 678",
  });

  assert.equal(timeZone, "Europe/Lisbon");
});

test("resolveTimeZoneFromCityInput identifica Madeira como Atlantic/Madeira", () => {
  const resolution = resolveTimeZoneFromCityInput({
    city: "Funchal",
    state: "Madeira",
    phone: "+351 912 345 678",
    allowPhoneCountryFallback: false,
  });

  assert.equal(resolution?.timeZone, "Atlantic/Madeira");
  assert.equal(resolution?.country, "PT");
});

test("resolveTimeZoneFromCityInput identifica Açores como Atlantic/Azores", () => {
  const resolution = resolveTimeZoneFromCityInput({
    city: "Ponta Delgada",
    state: "Açores",
    phone: "+351 912 345 678",
    allowPhoneCountryFallback: false,
  });

  assert.equal(resolution?.timeZone, "Atlantic/Azores");
  assert.equal(resolution?.country, "PT");
});

test("resolveTimeZoneFromStateInput identifica Madeira e Açores", () => {
  const madeira = resolveTimeZoneFromStateInput({
    state: "Madeira",
    phone: "+351 912 345 678",
  });
  const acores = resolveTimeZoneFromStateInput({
    state: "Açores",
    phone: "+351 912 345 678",
  });

  assert.equal(madeira?.timeZone, "Atlantic/Madeira");
  assert.equal(madeira?.country, "PT");
  assert.equal(acores?.timeZone, "Atlantic/Azores");
  assert.equal(acores?.country, "PT");
});

test("inferTimeZoneFromPhoneCountryCode usa Portugal como fallback para +351", () => {
  const resolution = inferTimeZoneFromPhoneCountryCode("+351 912 345 678");

  assert.equal(resolution?.timeZone, "Europe/Lisbon");
  assert.equal(resolution?.country, "PT");
});
