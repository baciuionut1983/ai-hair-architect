import { describe, expect, it } from "vitest";

import { validateClientForm } from "./client-form-validation";

const validForm = { fullName: "Jane Doe", email: "jane@example.com", phone: "555-0100", notes: "Prefers cool tones" };

describe("validateClientForm", () => {
  it("accepts a valid form", () => {
    expect(validateClientForm(validForm)).toBeNull();
  });

  it("rejects an empty full name", () => {
    expect(validateClientForm({ ...validForm, fullName: "" })).toBe("Full name is required.");
  });

  it("rejects a full name that is only whitespace", () => {
    expect(validateClientForm({ ...validForm, fullName: "   " })).toBe("Full name is required.");
  });

  it("rejects a full name over 200 characters", () => {
    expect(validateClientForm({ ...validForm, fullName: "a".repeat(201) })).toBe(
      "Full name must not exceed 200 characters."
    );
  });

  it("accepts a full name at exactly 200 characters", () => {
    expect(validateClientForm({ ...validForm, fullName: "a".repeat(200) })).toBeNull();
  });

  it("rejects an email over 320 characters", () => {
    expect(validateClientForm({ ...validForm, email: "a".repeat(321) })).toBe(
      "Email must not exceed 320 characters."
    );
  });

  it("rejects a phone over 40 characters", () => {
    expect(validateClientForm({ ...validForm, phone: "1".repeat(41) })).toBe(
      "Phone must not exceed 40 characters."
    );
  });

  it("rejects notes over 4000 characters", () => {
    expect(validateClientForm({ ...validForm, notes: "a".repeat(4001) })).toBe(
      "Notes must not exceed 4000 characters."
    );
  });

  it("treats optional fields as valid when empty", () => {
    expect(validateClientForm({ fullName: "Jane Doe", email: "", phone: "", notes: "" })).toBeNull();
  });
});
