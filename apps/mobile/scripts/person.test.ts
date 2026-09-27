import assert from "node:assert/strict";
import test from "node:test";
import { personDisplayName } from "../src/core/person";

test("a display name is shown as it is", () => {
  assert.equal(personDisplayName("Sara (Account Manager)", "sara@palm.test"), "Sara (Account Manager)");
});

test("an email used as the name shows the part before the @", () => {
  assert.equal(personDisplayName("operations@palmlivingae.com", "operations@palmlivingae.com"), "operations");
  assert.equal(personDisplayName("", "maya@studio.test"), "maya");
  assert.equal(personDisplayName(null, null), "");
});
