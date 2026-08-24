import { describe, it, expect } from "vitest";

import {
  parseUtmParams,
  hasUtmParams,
  serializeUtmParams,
  UTM_STORAGE_KEY,
  UTM_PARAM_NAMES,
} from "@/lib/utm";

describe("parseUtmParams", () => {
  it("extracts utm params from a query string", () => {
    const params = parseUtmParams("?utm_source=facebook&utm_medium=social&utm_campaign=launch");
    expect(params.utm_source).toBe("facebook");
    expect(params.utm_medium).toBe("social");
    expect(params.utm_campaign).toBe("launch");
  });

  it("works with or without the leading question mark", () => {
    expect(parseUtmParams("utm_source=reddit")).toEqual({ utm_source: "reddit" });
    expect(parseUtmParams("?utm_source=reddit")).toEqual({ utm_source: "reddit" });
  });

  it("ignores non-utm params", () => {
    const params = parseUtmParams("?v=abc123&utm_source=reddit");
    expect(params.utm_source).toBe("reddit");
    expect(params).not.toHaveProperty("v");
  });

  it("captures all five standard utm params", () => {
    const params = parseUtmParams(
      "?utm_source=s&utm_medium=m&utm_campaign=c&utm_content=ct&utm_term=t",
    );
    expect(params).toEqual({
      utm_source: "s",
      utm_medium: "m",
      utm_campaign: "c",
      utm_content: "ct",
      utm_term: "t",
    });
  });

  it("trims whitespace and drops empty values", () => {
    const params = parseUtmParams("?utm_source=  google  &utm_medium=");
    expect(params).toEqual({ utm_source: "google" });
  });
});

describe("hasUtmParams", () => {
  it("returns false for empty params", () => {
    expect(hasUtmParams(parseUtmParams("?v=abc123"))).toBe(false);
  });

  it("returns true when any utm param is present", () => {
    expect(hasUtmParams({ utm_source: "facebook" })).toBe(true);
  });
});

describe("serializeUtmParams", () => {
  it("round-trips utm params", () => {
    const params = { utm_source: "google", utm_campaign: "summer" };
    const qs = serializeUtmParams(params);
    expect(parseUtmParams(`?${qs}`)).toEqual(params);
  });

  it("omits undefined values", () => {
    expect(serializeUtmParams({ utm_source: "x" })).toBe("utm_source=x");
  });
});

describe("constants", () => {
  it("exposes a stable storage key and the standard param names", () => {
    expect(UTM_STORAGE_KEY).toBe("ytr:utm-attribution");
    expect(UTM_PARAM_NAMES).toEqual([
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "utm_term",
    ]);
  });
});
