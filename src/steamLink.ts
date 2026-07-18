import { randomBytes } from "node:crypto";
import type { Store } from "./store/types.js";
import { buildSteamLoginUrl, verifySteamOpenId } from "./steamAuth.js";

const TOKEN_TTL_MS = 10 * 60 * 1000;

export const EXPIRED_LINK_MESSAGE = "This link has expired. Go back to Telegram and run /linksteam again.";
const VERIFICATION_FAILED_MESSAGE =
  "Steam couldn't verify that login. Go back to Telegram and run /linksteam again.";
const LINKED_MESSAGE = "Linked! You can close this tab and return to Telegram.";

export interface HttpResult {
  status: number;
  headers?: Record<string, string>;
  body: string;
}

export async function createLinkRequest(store: Store, chatId: number, userId: number): Promise<string> {
  const token = randomBytes(16).toString("hex");
  await store.createSteamLinkToken({ token, chatId, userId, expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

export async function handleStartRequest(
  store: Store,
  token: string | undefined,
  appUrl: string,
): Promise<HttpResult> {
  if (!token) return { status: 400, body: EXPIRED_LINK_MESSAGE };
  const record = await store.getSteamLinkToken(token);
  if (!record || record.expiresAt < Date.now()) return { status: 400, body: EXPIRED_LINK_MESSAGE };

  const returnUrl = `${appUrl}/api/steam-link/callback?token=${token}`;
  const loginUrl = buildSteamLoginUrl(returnUrl, appUrl);
  return { status: 302, headers: { Location: loginUrl }, body: "" };
}

export async function handleCallbackRequest(
  store: Store,
  query: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<HttpResult> {
  const token = query.token;
  if (!token) return { status: 400, body: EXPIRED_LINK_MESSAGE };
  const record = await store.getSteamLinkToken(token);
  if (!record || record.expiresAt < Date.now()) return { status: 400, body: EXPIRED_LINK_MESSAGE };

  const steamId64 = await verifySteamOpenId(query, fetchImpl);
  // The token is single-use regardless of outcome, so a rejected or replayed
  // callback can't be retried against the same token.
  await store.deleteSteamLinkToken(token);
  if (!steamId64) return { status: 400, body: VERIFICATION_FAILED_MESSAGE };

  await store.setSteamLink(record.chatId, record.userId, steamId64);
  return { status: 200, body: LINKED_MESSAGE };
}
