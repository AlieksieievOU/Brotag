import { describe, it, expect, vi } from "vitest";
import { InMemoryStore } from "../src/store/inMemoryStore";
import { createLinkRequest, handleStartRequest, handleCallbackRequest } from "../src/steamLink";

describe("createLinkRequest", () => {
  it("creates a token record tied to the chat and user, expiring in the future", async () => {
    const store = new InMemoryStore();
    const token = await createLinkRequest(store, 1, 100);
    const record = await store.getSteamLinkToken(token);
    expect(record).toMatchObject({ token, chatId: 1, userId: 100 });
    expect(record!.expiresAt).toBeGreaterThan(Date.now());
  });
});

describe("handleStartRequest", () => {
  it("redirects to Steam when the token is valid", async () => {
    const store = new InMemoryStore();
    const token = await createLinkRequest(store, 1, 100);

    const result = await handleStartRequest(store, token, "https://example.com");

    expect(result.status).toBe(302);
    expect(result.headers?.Location).toContain("https://steamcommunity.com/openid/login");
  });

  it("rejects a missing token", async () => {
    const store = new InMemoryStore();
    const result = await handleStartRequest(store, undefined, "https://example.com");
    expect(result.status).toBe(400);
  });

  it("rejects an expired token", async () => {
    const store = new InMemoryStore();
    const token = "expired-token";
    await store.createSteamLinkToken({ token, chatId: 1, userId: 100, expiresAt: Date.now() - 1000 });

    const result = await handleStartRequest(store, token, "https://example.com");

    expect(result.status).toBe(400);
  });
});

describe("handleCallbackRequest", () => {
  it("links the Steam account and consumes the token on success", async () => {
    const store = new InMemoryStore();
    const token = await createLinkRequest(store, 1, 100);
    const fetchImpl = vi.fn().mockResolvedValue({ text: async () => "is_valid:true\n" });
    const query = { token, "openid.claimed_id": "https://steamcommunity.com/openid/id/76561198000000000" };

    const result = await handleCallbackRequest(store, query, fetchImpl as unknown as typeof fetch);

    expect(result.status).toBe(200);
    expect(await store.getSteamLink(1, 100)).toBe("76561198000000000");
    expect(await store.getSteamLinkToken(token)).toBeUndefined();
  });

  it("does not link when Steam rejects the response, but still consumes the token", async () => {
    const store = new InMemoryStore();
    const token = await createLinkRequest(store, 1, 100);
    const fetchImpl = vi.fn().mockResolvedValue({ text: async () => "is_valid:false\n" });
    const query = { token, "openid.claimed_id": "https://steamcommunity.com/openid/id/76561198000000000" };

    const result = await handleCallbackRequest(store, query, fetchImpl as unknown as typeof fetch);

    expect(result.status).toBe(400);
    expect(await store.getSteamLink(1, 100)).toBeUndefined();
    expect(await store.getSteamLinkToken(token)).toBeUndefined();
  });

  it("does not verify or consume the token if it's missing or expired", async () => {
    const store = new InMemoryStore();
    const fetchImpl = vi.fn().mockResolvedValue({ text: async () => "is_valid:true\n" });
    const result = await handleCallbackRequest(store, { token: "nope" }, fetchImpl as unknown as typeof fetch);

    expect(result.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
