import { beforeEach, describe, expect, it } from "vitest";
import { clearOperatorOrderForTests, getOperatorOrder, placeFirstInGroup } from "./operator-order";

beforeEach(clearOperatorOrderForTests);

describe("placeFirstInGroup", () => {
  it("records one decision: the chosen item first and the rest behind it in the order shown", async () => {
    expect(await placeFirstInGroup("b", ["a", "b", "c"])).toBe(true);
    expect(await getOperatorOrder()).toEqual([["b", "a", "c"]]);
  });

  it("orders a group of three by choosing the third, then the second, then the first", async () => {
    await placeFirstInGroup("c", ["a", "b", "c"]);
    await placeFirstInGroup("b", ["c", "a", "b"]);
    await placeFirstInGroup("a", ["b", "c", "a"]);
    expect(await getOperatorOrder()).toEqual([["a", "b", "c"]]);
  });

  it("choosing again replaces the decision for the same members and leaves other groups alone", async () => {
    await placeFirstInGroup("y", ["x", "y"]);
    await placeFirstInGroup("b", ["a", "b"]);
    await placeFirstInGroup("x", ["y", "x"]);
    expect(await getOperatorOrder()).toEqual([["b", "a"], ["x", "y"]]);
  });

  it("keeps a decision about {a, b} separate from one about {a, b, c}", async () => {
    await placeFirstInGroup("b", ["a", "b"]);
    await placeFirstInGroup("c", ["a", "b", "c"]);
    expect(await getOperatorOrder()).toEqual([["b", "a"], ["c", "a", "b"]]);
  });

  it("rejects an item that is not in the group", async () => {
    expect(await placeFirstInGroup("z", ["a", "b"])).toBe(false);
    expect(await getOperatorOrder()).toEqual([]);
  });

  it("returns a copy, so callers cannot change the store", async () => {
    await placeFirstInGroup("b", ["a", "b"]);
    (await getOperatorOrder())[0].push("zzz");
    expect(await getOperatorOrder()).toEqual([["b", "a"]]);
  });
});
