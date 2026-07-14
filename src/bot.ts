import { Bot } from "grammy";
import type { Store, Member } from "./store/types.js";
import { isGroupAdmin } from "./permissions.js";
import { handleCreateRole, handleDeleteRole, handleListRoles } from "./commands/roleCommands.js";
import { handleAssign, handleUnassign, handleMyRoles } from "./commands/assignCommands.js";
import { resolveTags } from "./tagging/resolveTags.js";
import { formatMentions } from "./tagging/formatMentions.js";

function isGroupChat(chatType: string): boolean {
  return chatType === "group" || chatType === "supergroup";
}

function replyTargetFrom(
  replyToUser: { id: number; first_name: string; username?: string } | undefined,
  chatId: number,
): Member | undefined {
  if (!replyToUser) return undefined;
  return {
    chatId,
    userId: replyToUser.id,
    firstName: replyToUser.first_name,
    username: replyToUser.username,
  };
}

export function createBot(token: string, store: Store): Bot {
  const bot = new Bot(token);

  // Track every poster as a known member of the chat.
  bot.on("message", async (ctx, next) => {
    if (isGroupChat(ctx.chat.type) && ctx.from) {
      await store.upsertMember({
        chatId: ctx.chat.id,
        userId: ctx.from.id,
        firstName: ctx.from.first_name,
        username: ctx.from.username,
      });
    }
    await next();
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
    const name = ctx.match.trim();
    if (!name) return ctx.reply("Usage: reply to a user's message with /assign <role>");
    const target = replyTargetFrom(ctx.message?.reply_to_message?.from, ctx.chat.id);
    return ctx.reply(await handleAssign(store, ctx.chat.id, name, target));
  });

  bot.command("unassign", async (ctx) => {
    if (!isGroupChat(ctx.chat.type)) return ctx.reply("This command only works in a group.");
    if (!ctx.from || !(await isGroupAdmin(ctx.api, ctx.chat.id, ctx.from.id))) {
      return ctx.reply("Only group admins can unassign roles.");
    }
    const name = ctx.match.trim();
    if (!name) return ctx.reply("Usage: reply to a user's message with /unassign <role>");
    const target = replyTargetFrom(ctx.message?.reply_to_message?.from, ctx.chat.id);
    return ctx.reply(await handleUnassign(store, ctx.chat.id, name, target));
  });

  bot.command("myroles", async (ctx) => {
    if (!isGroupChat(ctx.chat.type)) return ctx.reply("This command only works in a group.");
    if (!ctx.from) return;
    return ctx.reply(await handleMyRoles(store, ctx.chat.id, ctx.from.id));
  });

  // Handles free-text tag mentions (e.g. "@all", "@rolename"). Registered
  // after the command handlers above, so a matched /command never reaches
  // here (grammY's command filter only calls next() when it does NOT match).
  // Slash-prefixed text is still guarded against explicitly below in case an
  // unrecognized command (e.g. "/foo") falls through the command filters.
  bot.on("message:text", async (ctx) => {
    if (!isGroupChat(ctx.chat.type)) return;
    if (ctx.message.text.startsWith("/")) return;
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
