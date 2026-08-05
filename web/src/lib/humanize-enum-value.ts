// M31 GO-2: generic snake_case -> Title Case converter for the many
// plan-output enums (StructuralTechnique, ColorFormulaDirection,
// TreatmentCategory, etc.) that are only ever displayed, never chosen from
// a dropdown. Hand-written labels aren't worth maintaining for ~20+ output
// enums the way they are for the ~15 input enums in
// analysis-field-options.ts; this keeps output rendering readable without
// a second large hand-maintained dictionary.
export function humanizeEnumValue(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
