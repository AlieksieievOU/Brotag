import type { Store } from "./store/types.js";
import { getNextShareCode } from "./steamMatches.js";

const MAX_CODES_PER_USER_PER_CYCLE = 10;
const STEAM_HELP_URL = "https://help.steampowered.com/en/wizard/HelpWithGameIssue/?appid=730&issueid=128";

export interface PollSummary {
  checked: number;
  newMatches: number;
  brokenAuth: number;
}

export type Notify = (chatId: number, text: string) => Promise<void>;

async function memberName(store: Store, chatId: number, userId: number): Promise<string> {
  const member = await store.getMember(chatId, userId);
  return member?.firstName ?? "someone";
}

async function safeNotify(notify: Notify, chatId: number, text: string): Promise<void> {
  try {
    await notify(chatId, text);
  } catch (err) {
    console.error("Failed to send match notification:", err);
  }
}

export async function runMatchPoll(
  store: Store,
  steamApiKey: string,
  fetchImpl: typeof fetch,
  notify: Notify,
): Promise<PollSummary> {
  const tracked = await store.listActiveCs2Tracking();
  const summary: PollSummary = { checked: tracked.length, newMatches: 0, brokenAuth: 0 };
  // (chatId -> shareCode -> { userIds, inserted }) collected across the whole sweep so that
  // two users who played the same match produce one queue row and one message.
  const found = new Map<number, Map<string, { players: Set<number>; inserted: boolean }>>();

  for (const tracking of tracked) {
    const steamId64 = await store.getSteamLink(tracking.chatId, tracking.userId);
    if (!steamId64) {
      await store.markCs2TrackingBroken(tracking.chatId, tracking.userId);
      summary.brokenAuth++;
      const name = await memberName(store, tracking.chatId, tracking.userId);
      await safeNotify(
        notify,
        tracking.chatId,
        `⚠️ ${name}, your Steam link is gone — run /linksteam and /trackcs2 again.`,
      );
      continue;
    }

    let knownCode = tracking.lastShareCode;
    for (let i = 0; i < MAX_CODES_PER_USER_PER_CYCLE; i++) {
      const result = await getNextShareCode(steamApiKey, steamId64, tracking.authCode, knownCode, fetchImpl);
      if (result.kind === "next") {
        knownCode = result.shareCode;
        const outcome = await store.enqueueMatch(tracking.chatId, knownCode, [tracking.userId]);
        await store.updateCs2TrackingCode(tracking.chatId, tracking.userId, knownCode);
        const chatMatches = found.get(tracking.chatId) ?? new Map<string, { players: Set<number>; inserted: boolean }>();
        const entry = chatMatches.get(knownCode) ?? { players: new Set<number>(), inserted: false };
        entry.players.add(tracking.userId);
        if (outcome === "inserted") entry.inserted = true;
        chatMatches.set(knownCode, entry);
        found.set(tracking.chatId, chatMatches);
        continue;
      }
      if (result.kind === "authFailed") {
        await store.markCs2TrackingBroken(tracking.chatId, tracking.userId);
        summary.brokenAuth++;
        const name = await memberName(store, tracking.chatId, tracking.userId);
        await safeNotify(
          notify,
          tracking.chatId,
          `⚠️ ${name}, your CS2 auth code stopped working. Create a new one and re-run /trackcs2: ${STEAM_HELP_URL}`,
        );
      } else if (result.kind === "error") {
        console.error(
          `Steam poll error for chat ${tracking.chatId} user ${tracking.userId}: ${result.detail}`,
        );
      }
      break;
    }
  }

  for (const [chatId, matches] of found) {
    for (const [, entry] of matches) {
      if (!entry.inserted) continue;
      summary.newMatches++;
      const names = await Promise.all([...entry.players].map((id) => memberName(store, chatId, id)));
      await safeNotify(notify, chatId, `🎮 New match detected for ${names.join(", ")} — queued for highlights.`);
    }
  }

  return summary;
}
