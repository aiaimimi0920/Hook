import { expect, it } from "vitest";
import { extractArtDeliveryCandidatesState } from "../../src/services/artDeliveryCandidates";

it("accepts at most 64 candidates and does not process an oversized remote array", () => {
    const items = Array.from({ length: 64 }, (_, index) => ({ index, imageUrl: `https://example.com/${index}.png` }));
    const accepted = extractArtDeliveryCandidatesState({ candidates: { items, selectedIndex: 63 } });
    expect(accepted.resultCandidates).toHaveLength(64);
    expect(accepted.selectedResultIndex).toBe(63);
    const oversized = [...items, { index: 64, imageUrl: "https://example.com/64.png" }];
    expect(extractArtDeliveryCandidatesState({ candidates: { items: oversized } }).resultCandidates).toBeUndefined();
});
