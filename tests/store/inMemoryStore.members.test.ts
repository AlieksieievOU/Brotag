import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../src/store/inMemoryStore";

describe("InMemoryStore member tracking", () => {
  it("upserts a member and retrieves it", async () => {
    const store = new InMemoryStore();
    await store.upsertMember({ chatId: 1, userId: 100, firstName: "Ada" });

    const member = await store.getMember(1, 100);
    expect(member).toEqual({ chatId: 1, userId: 100, firstName: "Ada" });
  });

  it("overwrites fields on repeated upsert of the same user", async () => {
    const store = new InMemoryStore();
    await store.upsertMember({ chatId: 1, userId: 100, firstName: "Ada" });
    await store.upsertMember({ chatId: 1, userId: 100, firstName: "Ada L.", username: "ada" });

    const member = await store.getMember(1, 100);
    expect(member).toEqual({ chatId: 1, userId: 100, firstName: "Ada L.", username: "ada" });
  });

  it("scopes members by chatId", async () => {
    const store = new InMemoryStore();
    await store.upsertMember({ chatId: 1, userId: 100, firstName: "Ada" });
    await store.upsertMember({ chatId: 2, userId: 100, firstName: "Ada-in-other-chat" });

    const chat1Members = await store.getMembers(1);
    expect(chat1Members).toEqual([{ chatId: 1, userId: 100, firstName: "Ada" }]);
  });

  it("returns undefined for a user that has never posted", async () => {
    const store = new InMemoryStore();
    const member = await store.getMember(1, 999);
    expect(member).toBeUndefined();
  });
});
