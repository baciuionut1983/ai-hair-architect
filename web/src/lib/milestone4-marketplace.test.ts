import { describe, expect, it } from "vitest";

import { getProducts, getRecommendedSuppliers, getSuppliers } from "./milestone1-store";

describe("milestone4 marketplace module", () => {
  it("filters localized products and ranked suppliers", () => {
    const products = getProducts({ countryCode: "RO", city: "Bucharest" });
    expect(products.length).toBeGreaterThan(0);

    const suppliers = getSuppliers({ countryCode: "RO", city: "Bucharest" });
    expect(suppliers.length).toBeGreaterThan(0);

    const recommended = getRecommendedSuppliers({ countryCode: "RO", city: "Bucharest" });
    expect(recommended.length).toBeGreaterThan(0);

    for (let index = 1; index < recommended.length; index += 1) {
      expect(recommended[index - 1].rating >= recommended[index].rating).toBe(true);
    }
  });
});
