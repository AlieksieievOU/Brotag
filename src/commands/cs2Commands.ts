import type { Store } from "../store/types.js";
import { SHARE_CODE_PATTERN } from "../steamMatches.js";

const AUTH_CODE_PATTERN = /^[A-Za-z0-9]{4}-[A-Za-z0-9]{5}-[A-Za-z0-9]{4}$/;

export const TRACKCS2_GUIDE = `To track your CS2 matches:
1. Open https://help.steampowered.com/en/wizard/HelpWithGameIssue/?appid=730&issueid=128 (sign in with the Steam account you linked).
2. Click "Create authentication code" — that's your auth code (XXXX-XXXXX-XXXX).
3. The same page shows "Your most recently completed match token" — that's your share code (CSGO-...).
4. Run /trackcs2 <auth-code> <share-code>`;

export async function handleTrackCs2(
  store: Store,
  chatId: number,
  userId: number,
  args: string,
): Promise<string> {
  const steamId64 = await store.getSteamLink(chatId, userId);
  if (!steamId64) return "Link your Steam account first with /linksteam.";

  const tokens = args.split(/\s+/).filter(Boolean);
  if (tokens.length !== 2) return TRACKCS2_GUIDE;
  const [authCode, shareCode] = tokens;
  if (!AUTH_CODE_PATTERN.test(authCode) || !SHARE_CODE_PATTERN.test(shareCode)) {
    return TRACKCS2_GUIDE;
  }

  await store.setCs2Tracking({ chatId, userId, authCode, lastShareCode: shareCode, status: "active" });
  return "CS2 match tracking is on. New matches are detected within ~15 minutes.";
}

export async function handleUntrackCs2(store: Store, chatId: number, userId: number): Promise<string> {
  const existing = await store.getCs2Tracking(chatId, userId);
  if (!existing) return "You weren't tracking CS2 matches.";
  await store.deleteCs2Tracking(chatId, userId);
  return "CS2 match tracking is off.";
}
