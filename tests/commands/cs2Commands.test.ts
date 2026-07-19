import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../src/store/inMemoryStore";
import { handleTrackCs2, handleUntrackCs2, TRACKCS2_GUIDE } from "../../src/commands/cs2Commands";

const AUTH = "AAAA-BBBBB-CCCC";
const CODE = "CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee";

describe("handleTrackCs2", () => {
  it("requires a linked steam account", async () => {
    const store = new InMemoryStore();
    const reply = await handleTrackCs2(store, 1, 100, `${AUTH} ${CODE}`);
    expect(reply).toBe("Link your Steam account first with /linksteam.");
  });

  it("replies with the guide when args are missing", async () => {
    const store = new InMemoryStore();
    await store.setSteamLink(1, 100, "76561198000000000");
    expect(await handleTrackCs2(store, 1, 100, "")).toBe(TRACKCS2_GUIDE);
  });

  it.each([
    ["bad auth code", `WRONG ${"CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee"}`],
    ["bad share code", `${"AAAA-BBBBB-CCCC"} CSGO-nope`],
  ])("replies with the guide on %s", async (_label, args) => {
    const store = new InMemoryStore();
    await store.setSteamLink(1, 100, "76561198000000000");
    expect(await handleTrackCs2(store, 1, 100, args)).toBe(TRACKCS2_GUIDE);
  });

  it("enrolls with valid codes and confirms", async () => {
    const store = new InMemoryStore();
    await store.setSteamLink(1, 100, "76561198000000000");
    const reply = await handleTrackCs2(store, 1, 100, `${AUTH} ${CODE}`);
    expect(reply).toBe("CS2 match tracking is on. New matches are detected within ~15 minutes.");
    expect(await store.getCs2Tracking(1, 100)).toEqual({
      chatId: 1,
      userId: 100,
      authCode: AUTH,
      lastShareCode: CODE,
      status: "active",
    });
  });

  it("re-enrolling resets a broken row", async () => {
    const store = new InMemoryStore();
    await store.setSteamLink(1, 100, "76561198000000000");
    await handleTrackCs2(store, 1, 100, `${AUTH} ${CODE}`);
    await store.markCs2TrackingBroken(1, 100);
    await handleTrackCs2(store, 1, 100, `${AUTH} ${CODE}`);
    expect((await store.getCs2Tracking(1, 100))!.status).toBe("active");
  });
});

describe("handleUntrackCs2", () => {
  it("removes tracking", async () => {
    const store = new InMemoryStore();
    await store.setSteamLink(1, 100, "76561198000000000");
    await handleTrackCs2(store, 1, 100, `${AUTH} ${CODE}`);
    expect(await handleUntrackCs2(store, 1, 100)).toBe("CS2 match tracking is off.");
    expect(await store.getCs2Tracking(1, 100)).toBeUndefined();
  });

  it("reports when nothing was tracked", async () => {
    const store = new InMemoryStore();
    expect(await handleUntrackCs2(store, 1, 100)).toBe("You weren't tracking CS2 matches.");
  });
});
