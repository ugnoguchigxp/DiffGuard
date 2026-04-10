import { describe, expect, it } from "vitest";

import { computeRisk, isBlocking } from "../../src/engine/risk";

describe("computeRisk", () => {
  it("returns high when an error exists", () => {
    const result = computeRisk([{ severity: "info" }, { severity: "error" }]);
    expect(result).toBe("high");
  });

  it("returns medium when warn exists without error", () => {
    const result = computeRisk([{ severity: "warn" }]);
    expect(result).toBe("medium");
  });

  it("returns low when only info exists", () => {
    const result = computeRisk([{ severity: "info" }]);
    expect(result).toBe("low");
  });
});

describe("isBlocking", () => {
  it("returns true when an error exists", () => {
    expect(isBlocking([{ severity: "error" }])).toBe(true);
  });

  it("returns false when no error exists", () => {
    expect(isBlocking([{ severity: "warn" }, { severity: "info" }])).toBe(false);
  });
});
