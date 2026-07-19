import type { Store } from "../store/types.js";
import { createLinkRequest } from "../steamLink.js";

export async function handleLinkSteam(
  store: Store,
  chatId: number,
  userId: number,
  appUrl: string,
): Promise<string> {
  const token = await createLinkRequest(store, chatId, userId);
  return `Click to link your Steam account (expires in 10 minutes):\n${appUrl}/api/steam-link/start?token=${token}`;
}

export async function handleMySteam(store: Store, chatId: number, userId: number): Promise<string> {
  const steamId64 = await store.getSteamLink(chatId, userId);
  if (!steamId64) return "You haven't linked a Steam account yet — run /linksteam.";
  const tracking = await store.getCs2Tracking(chatId, userId);
  const trackingLine =
    tracking === undefined
      ? "CS2 tracking: off — use /trackcs2 to get match highlights."
      : tracking.status === "active"
        ? "CS2 tracking: on."
        : "CS2 tracking: broken — re-run /trackcs2.";
  return `Your linked Steam account: https://steamcommunity.com/profiles/${steamId64}\n${trackingLine}`;
}

export async function handleUnlinkSteam(store: Store, chatId: number, userId: number): Promise<string> {
  const existing = await store.getSteamLink(chatId, userId);
  if (!existing) return "You don't have a linked Steam account.";
  await store.deleteSteamLink(chatId, userId);
  return "Your Steam account has been unlinked.";
}
