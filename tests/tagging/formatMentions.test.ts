import { describe, it, expect } from "vitest";
import { formatMentions } from "../../src/tagging/formatMentions";

describe("formatMentions", () => {
  it("formats a single member as an HTML text-mention link", () => {
    const text = formatMentions([{ chatId: 1, userId: 100, firstName: "Ada" }]);
    expect(text).toBe('<a href="tg://user?id=100">Ada</a>');
  });

  it("formats multiple members in one row, space-separated", () => {
    const text = formatMentions([
      { chatId: 1, userId: 100, firstName: "Ada" },
      { chatId: 1, userId: 200, firstName: "Grace" },
    ]);
    expect(text).toBe('<a href="tg://user?id=100">Ada</a> <a href="tg://user?id=200">Grace</a>');
  });

  it("returns an empty string for no members", () => {
    expect(formatMentions([])).toBe("");
  });

  it("HTML-escapes a hostile first name", () => {
    const text = formatMentions([{ chatId: 1, userId: 100, firstName: "Eve<b>&[x](y)" }]);
    expect(text).toBe('<a href="tg://user?id=100">Eve&lt;b&gt;&amp;[x](y)</a>');
  });
});
