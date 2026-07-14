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

  it("finds a member by username case-insensitively", async () => {
    const store = new InMemoryStore();
    await store.upsertMember({ chatId: 1, userId: 100, firstName: "Ada", username: "AdaLovelace" });

    const member = await store.findMemberByUsername(1, "adalovelace");
    expect(member).toEqual({ chatId: 1, userId: 100, firstName: "Ada", username: "AdaLovelace" });
  });

  it("returns undefined from findMemberByUsername for an unknown username", async () => {
    const store = new InMemoryStore();
    const member = await store.findMemberByUsername(1, "nobody");
    expect(member).toBeUndefined();
  });

  it("sets a birthday on an existing member", async () => {
    const store = new InMemoryStore();
    await store.upsertMember({ chatId: 1, userId: 100, firstName: "Ada" });

    await store.setBirthday(1, 100, "12-24");

    const member = await store.getMember(1, 100);
    expect(member).toEqual({ chatId: 1, userId: 100, firstName: "Ada", birthday: "12-24" });
  });

  it("is a no-op setting a birthday for an unknown member", async () => {
    const store = new InMemoryStore();
    await store.setBirthday(1, 999, "12-24");
    expect(await store.getMember(1, 999)).toBeUndefined();
  });
});
