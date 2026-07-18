import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../src/store/inMemoryStore";

describe("InMemoryStore steam linking", () => {
  it("stores and retrieves a link token", async () => {
    const store = new InMemoryStore();
    await store.createSteamLinkToken({ token: "abc", chatId: 1, userId: 100, expiresAt: 123 });
    expect(await store.getSteamLinkToken("abc")).toEqual({ token: "abc", chatId: 1, userId: 100, expiresAt: 123 });
  });

  it("returns undefined for an unknown token", async () => {
    const store = new InMemoryStore();
    expect(await store.getSteamLinkToken("nope")).toBeUndefined();
  });

  it("deletes a link token", async () => {
    const store = new InMemoryStore();
    await store.createSteamLinkToken({ token: "abc", chatId: 1, userId: 100, expiresAt: 123 });
    await store.deleteSteamLinkToken("abc");
    expect(await store.getSteamLinkToken("abc")).toBeUndefined();
  });

  it("stores, retrieves, and deletes a steam link", async () => {
    const store = new InMemoryStore();
    expect(await store.getSteamLink(1, 100)).toBeUndefined();

    await store.setSteamLink(1, 100, "76561198000000000");
    expect(await store.getSteamLink(1, 100)).toBe("76561198000000000");

    await store.deleteSteamLink(1, 100);
    expect(await store.getSteamLink(1, 100)).toBeUndefined();
  });

  it("scopes steam links per chat", async () => {
    const store = new InMemoryStore();
    await store.setSteamLink(1, 100, "111");
    await store.setSteamLink(2, 100, "222");
    expect(await store.getSteamLink(1, 100)).toBe("111");
    expect(await store.getSteamLink(2, 100)).toBe("222");
  });
});
