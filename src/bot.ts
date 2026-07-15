import { Bot, InlineKeyboard, type Api } from "grammy";
import type { ChatMember } from "grammy/types";
import type { Store, Member, Role } from "./store/types.js";
import { isGroupAdmin } from "./permissions.js";
import { handleCreateRole, handleDeleteRole, handleListRoles } from "./commands/roleCommands.js";
import { handleAssign, handleUnassign, handleMyRoles, NO_TARGET_MESSAGE } from "./commands/assignCommands.js";
import { handleSetBirthday, handleBirthdays } from "./commands/birthdayCommands.js";
import { handleHoroscope } from "./commands/horoscopeCommands.js";
import { handleNaviSchedule } from "./commands/naviCommands.js";
import { handleRoast } from "./commands/roastCommands.js";
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
/assign @username - omit the role to pick one from a button list instead (same for a reply with no role)
/unassign <role> @username - remove a role (admins only; or reply to the user's message with /unassign <role>)
/unassign @username - omit the role to pick from the user's current roles instead (same for a reply with no role)
/myroles - show your own roles
/setbirthday DD-MM - set your own birthday (e.g. /setbirthday 24-12)
/birthdays - list members' birthdays, soonest first
/horoscope @username - a joke daily horoscope based on their zodiac sign (or reply to their message; omit target for your own)
/navi - upcoming NAVI matches with stream links
/roast @username - a light, good-natured roast (or reply to their message; omit target to roast a random member)
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

// callback_data encodes as "<action>|<roleName>|<userId>". Role names can't
// contain "|" (see VALID_ROLE_NAME in roleCommands.ts), so the delimiter is safe.
const CALLBACK_DATA_PATTERN = /^(assign|unassign)\|(.+)\|(\d+)$/;

function buildRoleKeyboard(action: "assign" | "unassign", userId: number, roles: Role[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  roles.forEach((role, i) => {
    keyboard.text(role.name, `${action}|${role.name}|${userId}`);
    if (i % 2 === 1) keyboard.row();
  });
  return keyboard;
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

// Telegram's own pseudo-accounts (not real users) that can end up stored as a
// "member" if they were ever the sender of a message: the anonymous-admin
// identity, a linked channel's posting identity, and the Telegram service
// account. Their ids are fixed platform-wide, not per-chat.
const PSEUDO_USER_IDS = new Set([1087968824, 136817688, 777000]);

// The Bot API has no "list all members" call, so the member store is fed from
// three sources: message senders, chat_member join/leave updates, and — right
// before an @all tag — the live admin list fetched here. This is also the
// only point where every chat is guaranteed to be touched regularly, so it
// doubles as a sweep to purge any pseudo-account row left over from before
// the is_bot guards existed (those only clean up reactively, on that
// specific pseudo-account's next message).
async function syncAdminsToStore(api: Api, store: Store, chatId: number): Promise<void> {
  for (const pseudoUserId of PSEUDO_USER_IDS) {
    await store.deleteMember(chatId, pseudoUserId);
  }
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
    const replyToUser = ctx.message?.reply_to_message?.from;
    if (!raw && !replyToUser) {
      return ctx.reply("Usage: /assign <role> @username, or reply to a user's message with /assign <role>");
    }
    const { roleName, username } = parseAssignArgs(raw);
    const target = await resolveAssignTarget(store, ctx.chat.id, replyToUser, username);
    if (!target) return ctx.reply(NO_TARGET_MESSAGE);
    if (roleName) return ctx.reply(await handleAssign(store, ctx.chat.id, roleName, target));

    const roles = await store.listRoles(ctx.chat.id);
    if (roles.length === 0) return ctx.reply("No roles have been created yet. Use /createrole <name> first.");
    return ctx.reply(`Choose a role to assign to ${target.firstName}:`, {
      reply_markup: buildRoleKeyboard("assign", target.userId, roles),
    });
  });

  bot.command("unassign", async (ctx) => {
    if (!isGroupChat(ctx.chat.type)) return ctx.reply("This command only works in a group.");
    if (!ctx.from || !(await isGroupAdmin(ctx.api, ctx.chat.id, ctx.from.id))) {
      return ctx.reply("Only group admins can unassign roles.");
    }
    const raw = ctx.match.trim();
    const replyToUser = ctx.message?.reply_to_message?.from;
    if (!raw && !replyToUser) {
      return ctx.reply("Usage: /unassign <role> @username, or reply to a user's message with /unassign <role>");
    }
    const { roleName, username } = parseAssignArgs(raw);
    const target = await resolveAssignTarget(store, ctx.chat.id, replyToUser, username);
    if (!target) return ctx.reply(NO_TARGET_MESSAGE);
    if (roleName) return ctx.reply(await handleUnassign(store, ctx.chat.id, roleName, target));

    const roles = await store.getUserRoles(ctx.chat.id, target.userId);
    if (roles.length === 0) return ctx.reply(`${target.firstName} has no roles to remove.`);
    return ctx.reply(`Choose a role to remove from ${target.firstName}:`, {
      reply_markup: buildRoleKeyboard("unassign", target.userId, roles),
    });
  });

  bot.on("callback_query:data", async (ctx) => {
    const match = CALLBACK_DATA_PATTERN.exec(ctx.callbackQuery.data);
    if (!match || !ctx.chat) return ctx.answerCallbackQuery();
    const [, action, roleName, userIdStr] = match;
    if (!(await isGroupAdmin(ctx.api, ctx.chat.id, ctx.from.id))) {
      return ctx.answerCallbackQuery({ text: "Only group admins can do this.", show_alert: true });
    }
    const target = await store.getMember(ctx.chat.id, Number(userIdStr));
    if (!target) {
      await ctx.answerCallbackQuery();
      return ctx.editMessageText("That user is no longer tracked.");
    }
    const resultText =
      action === "assign"
        ? await handleAssign(store, ctx.chat.id, roleName, target)
        : await handleUnassign(store, ctx.chat.id, roleName, target);
    await ctx.answerCallbackQuery();
    return ctx.editMessageText(resultText);
  });

  bot.command("myroles", async (ctx) => {
    if (!isGroupChat(ctx.chat.type)) return ctx.reply("This command only works in a group.");
    if (!ctx.from) return;
    return ctx.reply(await handleMyRoles(store, ctx.chat.id, ctx.from.id));
  });

  bot.command("setbirthday", async (ctx) => {
    if (!isGroupChat(ctx.chat.type)) return ctx.reply("This command only works in a group.");
    if (!ctx.from) return;
    const raw = ctx.match.trim();
    if (!raw) return ctx.reply("Usage: /setbirthday DD-MM (e.g. /setbirthday 24-12)");
    const target: Member = {
      chatId: ctx.chat.id,
      userId: ctx.from.id,
      firstName: ctx.from.first_name,
      username: ctx.from.username,
    };
    return ctx.reply(await handleSetBirthday(store, target, raw));
  });

  bot.command("birthdays", async (ctx) => {
    if (!isGroupChat(ctx.chat.type)) return ctx.reply("This command only works in a group.");
    return ctx.reply(await handleBirthdays(store, ctx.chat.id));
  });

  bot.command(["horoscope", "goroscope"], async (ctx) => {
    if (!isGroupChat(ctx.chat.type)) return ctx.reply("This command only works in a group.");
    if (!ctx.from) return;
    const raw = ctx.match.trim();
    const replyToUser = ctx.message?.reply_to_message?.from;
    const { username } = parseAssignArgs(raw);
    let target = await resolveAssignTarget(store, ctx.chat.id, replyToUser, username);
    if (!target && !username && !replyToUser) {
      target = await store.getMember(ctx.chat.id, ctx.from.id);
    }
    return ctx.reply(await handleHoroscope(target));
  });

  bot.command("roast", async (ctx) => {
    if (!isGroupChat(ctx.chat.type)) return ctx.reply("This command only works in a group.");
    const raw = ctx.match.trim();
    const replyToUser = ctx.message?.reply_to_message?.from;
    const { username } = parseAssignArgs(raw);
    const target = await resolveAssignTarget(store, ctx.chat.id, replyToUser, username);
    const members = await store.getMembers(ctx.chat.id);
    return ctx.reply(handleRoast(members, target));
  });

  bot.command("navi", async (ctx) => {
    if (!isGroupChat(ctx.chat.type)) return ctx.reply("This command only works in a group.");
    return ctx.reply(await handleNaviSchedule());
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
    const resolved = await resolveTags(ctx.message.text, store, ctx.chat.id);
    // Tagging the person who wrote the message is pointless noise; pseudo
    // accounts (e.g. @GroupAnonymousBot) are never real members to tag.
    const members = resolved.filter(
      (m) => m.userId !== ctx.from?.id && !PSEUDO_USER_IDS.has(m.userId),
    );
    if (members.length === 0) return;
    const mentionText = formatMentions(members);
    await ctx.reply(mentionText, {
      parse_mode: "HTML",
      reply_parameters: { message_id: ctx.message.message_id },
    });
  });

  return bot;
}
