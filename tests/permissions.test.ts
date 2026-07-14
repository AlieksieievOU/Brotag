import { describe, it, expect } from "vitest";
import { isGroupAdmin } from "../src/permissions";

describe("isGroupAdmin", () => {
  it("returns true for status 'administrator'", async () => {
    const api = { getChatMember: async () => ({ status: "administrator" }) };
    expect(await isGroupAdmin(api, 1, 100)).toBe(true);
  });

  it("returns true for status 'creator'", async () => {
    const api = { getChatMember: async () => ({ status: "creator" }) };
    expect(await isGroupAdmin(api, 1, 100)).toBe(true);
  });

  it("returns false for status 'member'", async () => {
    const api = { getChatMember: async () => ({ status: "member" }) };
    expect(await isGroupAdmin(api, 1, 100)).toBe(false);
  });

  it("calls getChatMember with the given chatId and userId", async () => {
    let calledWith: [number, number] | undefined;
    const api = {
      getChatMember: async (chatId: number, userId: number) => {
        calledWith = [chatId, userId];
        return { status: "member" };
      },
    };
    await isGroupAdmin(api, 42, 7);
    expect(calledWith).toEqual([42, 7]);
  });
});
