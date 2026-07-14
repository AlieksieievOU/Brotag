import { describe, it, expect } from "vitest";
import { formatMentions } from "../../src/tagging/formatMentions";

describe("formatMentions", () => {
  it("formats a single member as a text-mention link", () => {
    const text = formatMentions([{ chatId: 1, userId: 100, firstName: "Ada" }]);
    expect(text).toBe("[Ada](tg://user?id=100)");
  });

  it("formats multiple members, one per line", () => {
    const text = formatMentions([
      { chatId: 1, userId: 100, firstName: "Ada" },
      { chatId: 1, userId: 200, firstName: "Grace" },
    ]);
    expect(text).toBe("[Ada](tg://user?id=100)\n[Grace](tg://user?id=200)");
  });

  it("returns an empty string for no members", () => {
    expect(formatMentions([])).toBe("");
  });
});
