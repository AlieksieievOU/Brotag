import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../src/store/inMemoryStore";

const TRACKING = {
  chatId: 1,
  userId: 100,
  authCode: "AAAA-BBBBB-CCCC",
  lastShareCode: "CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee",
  status: "active" as const,
};

describe("InMemoryStore cs2 tracking", () => {
  it("sets and gets a tracking row", async () => {
    const store = new InMemoryStore();
    await store.setCs2Tracking(TRACKING);
    expect(await store.getCs2Tracking(1, 100)).toEqual(TRACKING);
  });

  it("returns undefined for unknown tracking", async () => {
    const store = new InMemoryStore();
    expect(await store.getCs2Tracking(1, 100)).toBeUndefined();
  });

  it("deletes a tracking row", async () => {
    const store = new InMemoryStore();
    await store.setCs2Tracking(TRACKING);
    await store.deleteCs2Tracking(1, 100);
    expect(await store.getCs2Tracking(1, 100)).toBeUndefined();
  });

  it("lists only active tracking rows across chats", async () => {
    const store = new InMemoryStore();
    await store.setCs2Tracking(TRACKING);
    await store.setCs2Tracking({ ...TRACKING, chatId: 2, userId: 200 });
    await store.setCs2Tracking({ ...TRACKING, chatId: 3, userId: 300, status: "broken" });
    const active = await store.listActiveCs2Tracking();
    expect(active.map((t) => t.chatId).sort()).toEqual([1, 2]);
  });

  it("advances the last share code", async () => {
    const store = new InMemoryStore();
    await store.setCs2Tracking(TRACKING);
    await store.updateCs2TrackingCode(1, 100, "CSGO-11111-22222-33333-44444-55555");
    expect((await store.getCs2Tracking(1, 100))!.lastShareCode).toBe(
      "CSGO-11111-22222-33333-44444-55555",
    );
  });

  it("marks tracking broken", async () => {
    const store = new InMemoryStore();
    await store.setCs2Tracking(TRACKING);
    await store.markCs2TrackingBroken(1, 100);
    expect((await store.getCs2Tracking(1, 100))!.status).toBe("broken");
    expect(await store.listActiveCs2Tracking()).toEqual([]);
  });

  it("re-enrolling resets a broken row to active", async () => {
    const store = new InMemoryStore();
    await store.setCs2Tracking(TRACKING);
    await store.markCs2TrackingBroken(1, 100);
    await store.setCs2Tracking(TRACKING);
    expect((await store.getCs2Tracking(1, 100))!.status).toBe("active");
  });
});

describe("InMemoryStore match queue", () => {
  const CODE = "CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee";

  it("inserts a new match", async () => {
    const store = new InMemoryStore();
    expect(await store.enqueueMatch(1, CODE, [100])).toBe("inserted");
  });

  it("merges a duplicate match in the same chat", async () => {
    const store = new InMemoryStore();
    await store.enqueueMatch(1, CODE, [100]);
    expect(await store.enqueueMatch(1, CODE, [200])).toBe("merged");
  });

  it("treats the same code in a different chat as a new match", async () => {
    const store = new InMemoryStore();
    await store.enqueueMatch(1, CODE, [100]);
    expect(await store.enqueueMatch(2, CODE, [100])).toBe("inserted");
  });
});
