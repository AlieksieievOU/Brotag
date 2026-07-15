import { describe, it, expect } from "vitest";
import { handleRoast } from "../../src/commands/roastCommands";
import type { Member } from "../../src/store/types";

describe("handleRoast", () => {
  it("roasts the given target directly, ignoring the member pool", () => {
    const target: Member = { chatId: 1, userId: 1, firstName: "Ada" };
    const reply = handleRoast([], target, () => 0);
    expect(reply).toContain("Ada");
    expect(reply.startsWith("🔥 ")).toBe(true);
  });

  it("picks a random member from the pool when no target is given", () => {
    const members: Member[] = [
      { chatId: 1, userId: 1, firstName: "Ada" },
      { chatId: 1, userId: 2, firstName: "Grace" },
    ];
    const reply = handleRoast(members, undefined, () => 0.9);
    expect(reply).toContain("Grace");
  });

  it("reports when there is nobody to roast", () => {
    const reply = handleRoast([], undefined, () => 0);
    expect(reply).toBe("Бот поки що нікого тут не знає, щоб підколоти. Напишіть щось у чат спочатку.");
  });
});
