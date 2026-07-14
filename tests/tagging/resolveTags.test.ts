import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../src/store/inMemoryStore";
import { resolveTags } from "../../src/tagging/resolveTags";

describe("resolveTags", () => {
  it("resolves @all to every member of the chat", async () => {
    const store = new InMemoryStore();
    await store.upsertMember({ chatId: 1, userId: 100, firstName: "Ada" });
    await store.upsertMember({ chatId: 1, userId: 200, firstName: "Grace" });

    const members = await resolveTags("@all", store, 1);
    expect(members.map((m) => m.userId).sort()).toEqual([100, 200]);
  });

  it("resolves @RoleName to that role's members", async () => {
    const store = new InMemoryStore();
    await store.upsertMember({ chatId: 1, userId: 100, firstName: "Ada" });
    await store.upsertMember({ chatId: 1, userId: 200, firstName: "Grace" });
    const role = await store.createRole(1, "Designers");
    await store.assignUserToRole(role.id, 100);

    const members = await resolveTags("@Designers", store, 1);
    expect(members.map((m) => m.userId)).toEqual([100]);
  });

  it("merges and deduplicates members across multiple tags", async () => {
    const store = new InMemoryStore();
    await store.upsertMember({ chatId: 1, userId: 100, firstName: "Ada" });
    await store.upsertMember({ chatId: 1, userId: 200, firstName: "Grace" });
    const designers = await store.createRole(1, "Designers");
    const mods = await store.createRole(1, "Moderators");
    await store.assignUserToRole(designers.id, 100);
    await store.assignUserToRole(mods.id, 100);
    await store.assignUserToRole(mods.id, 200);

    const members = await resolveTags("@Designers @Moderators", store, 1);
    expect(members.map((m) => m.userId).sort()).toEqual([100, 200]);
  });

  it("silently ignores an unknown role tag", async () => {
    const store = new InMemoryStore();
    await store.upsertMember({ chatId: 1, userId: 100, firstName: "Ada" });

    const members = await resolveTags("@Nonexistent", store, 1);
    expect(members).toEqual([]);
  });

  it("returns an empty array when the message has no tags", async () => {
    const store = new InMemoryStore();
    const members = await resolveTags("no tags here", store, 1);
    expect(members).toEqual([]);
  });
});
