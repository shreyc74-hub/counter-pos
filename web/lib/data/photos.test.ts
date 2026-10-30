import { describe, expect, it } from "vitest";
import { mergePhotos } from "./photos";

describe("dish photo cache", () => {
  it("keeps cached data for unchanged photos, takes new data, and drops removed ones", () => {
    const cache = { a: { updatedAt: "1", data: "A1" }, b: { updatedAt: "1", data: "B1" }, gone: { updatedAt: "1", data: "G" } };
    const next = mergePhotos(cache, [
      { itemId: "a", updatedAt: "1", data: null },
      { itemId: "b", updatedAt: "2", data: "B2" },
      { itemId: "c", updatedAt: "1", data: "C1" },
    ]);
    expect(next).toEqual({ a: { updatedAt: "1", data: "A1" }, b: { updatedAt: "2", data: "B2" }, c: { updatedAt: "1", data: "C1" } });
  });
});
