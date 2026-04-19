import * as SecureStore from 'expo-secure-store';

const PENDING_INVITE_KEY = 'carelead.pending_invite_token';

/**
 * Parse a CareLead deep link URL and extract the invite token (if any).
 *
 * Accepts:
 *   carelead://invite/abc123
 *   carelead://invite/abc123?foo=bar
 *   https://carelead.app/invite/abc123  (future universal-link form)
 */
export function parseInviteToken(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const match = url.match(/\/invite\/([^/?#]+)/i);
    if (match && match[1]) {
      return decodeURIComponent(match[1]);
    }
  } catch {
    return null;
  }
  return null;
}

/** Save an invite token to be applied after the user finishes signing in. */
export async function setPendingInviteToken(token: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(PENDING_INVITE_KEY, token);
  } catch {
    // Best-effort — if SecureStore is unavailable we simply won't resume the invite.
  }
}

/** Read the pending invite token (if any). */
export async function getPendingInviteToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(PENDING_INVITE_KEY);
  } catch {
    return null;
  }
}

/** Clear the pending invite token after it's been consumed. */
export async function clearPendingInviteToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(PENDING_INVITE_KEY);
  } catch {
    // Best-effort
  }
}
