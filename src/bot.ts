import { Bot, type Api } from "grammy";
import type { ChatMember } from "grammy/types";
import type { Store, Member } from "./store/types.js";
import { isGroupAdmin } from "./permissions.js";
import { handleCreateRole, handleDeleteRole, handleListRoles } from "./commands/roleCommands.js";
import { handleAssign, handleUnassign, handleMyRoles } from "./commands/assignCommands.js";
import { parseTags } from "./tagging/parseTags.js";
import { resolveTags } from "./tagging/resolveTags.js";
import { formatMentions } from "./tagging/formatMentions.js";

function isGroupChat(chatType: string): boolean {
  return chatType === "group" || chatType === "supergroup";
}

function replyTargetFrom(
  replyToUser: { id: number; is_bot: boolean; first_name: string; username?: string } | undefined,
  chatId: number,
): Member | undefined {
  if (!replyToUser || replyToUser.is_bot) return undefined;
  return {
    chatId,
    userId: replyToUser.id,
    firstName: replyToUser.first_name,
    username: replyToUser.username,
  };
}

const HELP_TEXT = `Commands:
/createrole <name> - create a role (admins only)
/deleterole <name> - delete a role (admins only)
/roles - list roles and member counts
/assign <role> @username - assign a role (admins only; or reply to the user's message with /assign <role>)
/unassign <role> @username - remove a role (admins only; or reply to the user's message with /unassign <role>)
/myroles - show your own roles
/help - show this message

Tagging:
@all - mention everyone the bot knows about
@rolename - mention everyone assigned to that role

Note: assigning by @username only works once that user has posted in this group at least once.`;

// Splits "<role> @username" (in either order) into a role name and an
// optional target username. Reply-based targeting is handled separately in
// the command handlers; this only covers the inline @mention form.
function parseAssignArgs(text: string): { roleName: string; username?: string } {
  const tokens = text.split(/\s+/).filter(Boolean);
  const mentionIndex = tokens.findIndex((t) => t.startsWith("@") && t.length > 1);
  if (mentionIndex === -1) return { roleName: tokens.join(" ") };
  const username = tokens[mentionIndex].slice(1);
  const roleName = [...tokens.slice(0, mentionIndex), ...tokens.slice(mentionIndex + 1)].join(" ");
  return { roleName, username };
}

async function resolveAssignTarget(
  store: Store,
  chatId: number,
  replyToUser: { id: number; is_bot: boolean; first_name: string; username?: string } | undefined,
  username: string | undefined,
): Promise<Member | undefined> {
  const replyTarget = replyTargetFrom(replyToUser, chatId);
  if (replyTarget) return replyTarget;
  if (!username) return undefined;
  return store.findMemberByUsername(chatId, username);
}

function isActiveMember(chatMember: ChatMember): boolean {
  switch (chatMember.status) {
    case "creator":
    case "administrator":
    case "member":
      return true;
    case "restricted":
      return chatMember.is_member;
    default:
      return false;
  }
}

// The Bot API has no "list all members" call, so the member store is fed from
// three sources: message senders, chat_member join/leave updates, and — right
// before an @all tag — the live admin list fetched here.
async function syncAdminsToStore(api: Api, store: Store, chatId: number): Promise<void> {
  try {
    const admins = await api.getChatAdministrators(chatId);
    for (const admin of admins) {
      if (admin.user.is_bot) continue;
      await store.upsertMember({
        chatId,
        userId: admin.user.id,
        firstName: admin.user.first_name,
        username: admin.user.username,
      });
    }
  } catch (err) {
    console.error("Failed to sync chat administrators:", err);
  }
}

export function createBot(token: string, store: Store): Bot {
  const bot = new Bot(token);

  // Track every poster as a known member of the chat. Bots are never real
  // members (anonymous admins post as @GroupAnonymousBot, channels as
  // @Channel_Bot), so drop any bot row that slipped in before this guard.
  bot.on("message", async (ctx, next) => {
    if (isGroupChat(ctx.chat.type) && ctx.from) {
      if (ctx.from.is_bot) {
        await store.deleteMember(ctx.chat.id, ctx.from.id);
      } else {
        await store.upsertMember({
          chatId: ctx.chat.id,
          userId: ctx.from.id,
          firstName: ctx.from.first_name,
          username: ctx.from.username,
        });
      }
    }
    await next();
  });

  // Track joins/leaves. These updates are only delivered when the bot is an
  // admin AND the webhook subscribes to "chat_member" (see scripts/set-webhook.ts).
  bot.on("chat_member", async (ctx) => {
    if (!isGroupChat(ctx.chat.type)) return;
    const updated = ctx.chatMember.new_chat_member;
    if (updated.user.is_bot) return;
    if (isActiveMember(updated)) {
      await store.upsertMember({
        chatId: ctx.chat.id,
        userId: updated.user.id,
        firstName: updated.user.first_name,
        username: updated.user.username,
      });
    } else {
      await store.deleteMember(ctx.chat.id, updated.user.id);
    }
  });

  bot.command("createrole", async (ctx) => {
    if (!isGroupChat(ctx.chat.type)) return ctx.reply("This command only works in a group.");
    if (!ctx.from || !(await isGroupAdmin(ctx.api, ctx.chat.id, ctx.from.id))) {
      return ctx.reply("Only group admins can create roles.");
    }
    const name = ctx.match.trim();
    if (!name) return ctx.reply("Usage: /createrole <name>");
    return ctx.reply(await handleCreateRole(store, ctx.chat.id, name));
  });

  bot.command("deleterole", async (ctx) => {
    if (!isGroupChat(ctx.chat.type)) return ctx.reply("This command only works in a group.");
    if (!ctx.from || !(await isGroupAdmin(ctx.api, ctx.chat.id, ctx.from.id))) {
      return ctx.reply("Only group admins can delete roles.");
    }
    const name = ctx.match.trim();
    if (!name) return ctx.reply("Usage: /deleterole <name>");
    return ctx.reply(await handleDeleteRole(store, ctx.chat.id, name));
  });

  bot.command("roles", async (ctx) => {
    if (!isGroupChat(ctx.chat.type)) return ctx.reply("This command only works in a group.");
    return ctx.reply(await handleListRoles(store, ctx.chat.id));
  });

  bot.command("assign", async (ctx) => {
    if (!isGroupChat(ctx.chat.type)) return ctx.reply("This command only works in a group.");
    if (!ctx.from || !(await isGroupAdmin(ctx.api, ctx.chat.id, ctx.from.id))) {
      return ctx.reply("Only group admins can assign roles.");
    }
    const raw = ctx.match.trim();
    if (!raw) return ctx.reply("Usage: /assign <role> @username, or reply to a user's message with /assign <role>");
    const { roleName, username } = parseAssignArgs(raw);
    if (!roleName) return ctx.reply("Usage: /assign <role> @username, or reply to a user's message with /assign <role>");
    const target = await resolveAssignTarget(
      store,
      ctx.chat.id,
      ctx.message?.reply_to_message?.from,
      username,
    );
    return ctx.reply(await handleAssign(store, ctx.chat.id, roleName, target));
  });

  bot.command("unassign", async (ctx) => {
    if (!isGroupChat(ctx.chat.type)) return ctx.reply("This command only works in a group.");
    if (!ctx.from || !(await isGroupAdmin(ctx.api, ctx.chat.id, ctx.from.id))) {
      return ctx.reply("Only group admins can unassign roles.");
    }
    const raw = ctx.match.trim();
    if (!raw) return ctx.reply("Usage: /unassign <role> @username, or reply to a user's message with /unassign <role>");
    const { roleName, username } = parseAssignArgs(raw);
    if (!roleName) return ctx.reply("Usage: /unassign <role> @username, or reply to a user's message with /unassign <role>");
    const target = await resolveAssignTarget(
      store,
      ctx.chat.id,
      ctx.message?.reply_to_message?.from,
      username,
    );
    return ctx.reply(await handleUnassign(store, ctx.chat.id, roleName, target));
  });

  bot.command("myroles", async (ctx) => {
    if (!isGroupChat(ctx.chat.type)) return ctx.reply("This command only works in a group.");
    if (!ctx.from) return;
    return ctx.reply(await handleMyRoles(store, ctx.chat.id, ctx.from.id));
  });

  bot.command(["help", "commands"], async (ctx) => {
    return ctx.reply(HELP_TEXT);
  });

  // Handles free-text tag mentions (e.g. "@all", "@rolename"). Registered
  // after the command handlers above, so a matched /command never reaches
  // here (grammY's command filter only calls next() when it does NOT match).
  // Slash-prefixed text is still guarded against explicitly below in case an
  // unrecognized command (e.g. "/foo") falls through the command filters.
  bot.on("message:text", async (ctx) => {
    if (!isGroupChat(ctx.chat.type)) return;
    if (ctx.message.text.startsWith("/")) return;
    // @all should cover admins even if they never posted (e.g. only ever
    // posted anonymously), so refresh the admin list before resolving.
    if (parseTags(ctx.message.text).includes("all")) {
      await syncAdminsToStore(ctx.api, store, ctx.chat.id);
    }
    const members = await resolveTags(ctx.message.text, store, ctx.chat.id);
    if (members.length === 0) return;
    const mentionText = formatMentions(members);
    await ctx.reply(mentionText, {
      parse_mode: "HTML",
      reply_parameters: { message_id: ctx.message.message_id },
    });
  });

  return bot;
}
