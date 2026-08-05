export interface ClientFormValues {
  fullName: string;
  email: string;
  phone: string;
  notes: string;
}

// Mirrors the exact limits enforced server-side in
// src/app/api/v1/clients/route.ts (POST) -- this is UX-only, first-line
// feedback; the backend remains the source of truth.
export function validateClientForm(values: ClientFormValues): string | null {
  const fullName = values.fullName.trim();
  if (!fullName) {
    return "Full name is required.";
  }
  if (fullName.length > 200) {
    return "Full name must not exceed 200 characters.";
  }
  if (values.email.trim().length > 320) {
    return "Email must not exceed 320 characters.";
  }
  if (values.phone.trim().length > 40) {
    return "Phone must not exceed 40 characters.";
  }
  if (values.notes.trim().length > 4000) {
    return "Notes must not exceed 4000 characters.";
  }
  return null;
}
