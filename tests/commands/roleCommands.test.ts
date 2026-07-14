import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../src/store/inMemoryStore";
import { handleCreateRole, handleDeleteRole, handleListRoles } from "../../src/commands/roleCommands";

describe("role management commands", () => {
  it("creates a role and confirms it", async () => {
    const store = new InMemoryStore();
    const reply = await handleCreateRole(store, 1, "Designers");
    expect(reply).toBe('Role "Designers" created.');
    expect(await store.findRole(1, "Designers")).toBeDefined();
  });

  it("refuses to create a duplicate role", async () => {
    const store = new InMemoryStore();
    await handleCreateRole(store, 1, "Designers");
    const reply = await handleCreateRole(store, 1, "Designers");
    expect(reply).toBe('Role "Designers" already exists.');
  });

  it("deletes an existing role", async () => {
    const store = new InMemoryStore();
    await handleCreateRole(store, 1, "Designers");
    const reply = await handleDeleteRole(store, 1, "Designers");
    expect(reply).toBe('Role "Designers" deleted.');
    expect(await store.findRole(1, "Designers")).toBeUndefined();
  });

  it("reports when deleting a role that does not exist", async () => {
    const store = new InMemoryStore();
    const reply = await handleDeleteRole(store, 1, "Nope");
    expect(reply).toBe('Role "Nope" does not exist.');
  });

  it("lists roles with member counts", async () => {
    const store = new InMemoryStore();
    await store.upsertMember({ chatId: 1, userId: 100, firstName: "Ada" });
    const role = await handleCreateRoleAndReturn(store, 1, "Designers");
    await store.assignUserToRole(role.id, 100);
    await handleCreateRole(store, 1, "Moderators");

    const reply = await handleListRoles(store, 1);
    expect(reply).toBe("Designers (1 member)\nModerators (0 members)");
  });

  it("reports when there are no roles", async () => {
    const store = new InMemoryStore();
    const reply = await handleListRoles(store, 1);
    expect(reply).toBe("No roles have been created yet.");
  });
});

async function handleCreateRoleAndReturn(store: InMemoryStore, chatId: number, name: string) {
  await handleCreateRole(store, chatId, name);
  const role = await store.findRole(chatId, name);
  if (!role) throw new Error("role should exist");
  return role;
}
