import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../src/store/inMemoryStore";
import { handleLinkSteam, handleMySteam, handleUnlinkSteam } from "../../src/commands/steamCommands";

describe("handleLinkSteam", () => {
  it("replies with a one-time link built from the app URL", async () => {
    const store = new InMemoryStore();
    const reply = await handleLinkSteam(store, 1, 100, "https://example.com");
    expect(reply).toContain("https://example.com/api/steam-link/start?token=");
  });
});

describe("handleMySteam", () => {
  it("reports when nothing is linked", async () => {
    const store = new InMemoryStore();
    const reply = await handleMySteam(store, 1, 100);
    expect(reply).toBe("You haven't linked a Steam account yet — run /linksteam.");
  });

  it("reports the linked profile", async () => {
    const store = new InMemoryStore();
    await store.setSteamLink(1, 100, "76561198000000000");
    const reply = await handleMySteam(store, 1, 100);
    expect(reply).toBe("Your linked Steam account: https://steamcommunity.com/profiles/76561198000000000");
  });
});

describe("handleUnlinkSteam", () => {
  it("reports when there's nothing to unlink", async () => {
    const store = new InMemoryStore();
    const reply = await handleUnlinkSteam(store, 1, 100);
    expect(reply).toBe("You don't have a linked Steam account.");
  });

  it("removes an existing link", async () => {
    const store = new InMemoryStore();
    await store.setSteamLink(1, 100, "76561198000000000");
    const reply = await handleUnlinkSteam(store, 1, 100);
    expect(reply).toBe("Your Steam account has been unlinked.");
    expect(await store.getSteamLink(1, 100)).toBeUndefined();
  });
});
