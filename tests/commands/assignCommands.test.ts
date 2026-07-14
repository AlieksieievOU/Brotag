import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../src/store/inMemoryStore";
import { handleAssign, handleUnassign, handleMyRoles } from "../../src/commands/assignCommands";

describe("assignment commands", () => {
  it("assigns a target member to an existing role", async () => {
    const store = new InMemoryStore();
    await store.createRole(1, "Designers");
    const target = { chatId: 1, userId: 100, firstName: "Ada" };
    await store.upsertMember(target);

    const reply = await handleAssign(store, 1, "Designers", target);
    expect(reply).toBe("Ada added to Designers.");

    const role = await store.findRole(1, "Designers");
    const members = await store.getRoleMembers(role!.id);
    expect(members.map((m) => m.userId)).toEqual([100]);
  });

  it("reports when the role does not exist", async () => {
    const store = new InMemoryStore();
    const target = { chatId: 1, userId: 100, firstName: "Ada" };
    await store.upsertMember(target);

    const reply = await handleAssign(store, 1, "Nope", target);
    expect(reply).toBe('Role "Nope" does not exist.');
  });

  it("reports when no target user was identified", async () => {
    const store = new InMemoryStore();
    await store.createRole(1, "Designers");

    const reply = await handleAssign(store, 1, "Designers", undefined);
    expect(reply).toBe(
      "Couldn't identify that user. Reply to one of their messages with this command, and make sure they've posted in this group before.",
    );
  });

  it("unassigns a target member from a role", async () => {
    const store = new InMemoryStore();
    const role = await store.createRole(1, "Designers");
    const target = { chatId: 1, userId: 100, firstName: "Ada" };
    await store.upsertMember(target);
    await store.assignUserToRole(role.id, 100);

    const reply = await handleUnassign(store, 1, "Designers", target);
    expect(reply).toBe("Ada removed from Designers.");

    const members = await store.getRoleMembers(role.id);
    expect(members).toEqual([]);
  });

  it("lists a user's roles", async () => {
    const store = new InMemoryStore();
    const target = { chatId: 1, userId: 100, firstName: "Ada" };
    await store.upsertMember(target);
    const role = await store.createRole(1, "Designers");
    await store.assignUserToRole(role.id, 100);

    const reply = await handleMyRoles(store, 1, 100);
    expect(reply).toBe("Your roles: Designers");
  });

  it("reports when the user has no roles", async () => {
    const store = new InMemoryStore();
    const reply = await handleMyRoles(store, 1, 100);
    expect(reply).toBe("You have no roles in this group.");
  });

  it("upserts a target that never posted before, so they can be tagged afterward", async () => {
    const store = new InMemoryStore();
    const role = await store.createRole(1, "Designers");
    const target = { chatId: 1, userId: 100, firstName: "Ada" };
    // Note: target is never upserted into the store before assignment.

    const reply = await handleAssign(store, 1, "Designers", target);
    expect(reply).toBe("Ada added to Designers.");

    const members = await store.getRoleMembers(role.id);
    expect(members.map((m) => m.userId)).toEqual([100]);
  });
});
