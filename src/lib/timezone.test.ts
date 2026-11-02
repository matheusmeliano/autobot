import assert from "node:assert/strict";
import { resolveStudentTimezone } from "./timezone.ts";

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
