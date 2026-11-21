import { parseInviteUrl } from './config';

// The invite page's "Open in the Hereabouts app" link (templates/join.php,
// src/join.js in the Nextcloud app) opens hereabouts://join?url=<invite link>.
// Returns that invite link, or null for anything else (including the dev
// client's own exp+hereabouts-companion:// links).
//
// Parsed by hand: React Native's URL class doesn't implement searchParams.
export function inviteFromAppLink(link: string | null | undefined): string | null {
  if (!link) return null;
  const match = /^hereabouts:\/\/join\/?\?(.*)$/i.exec(link.trim());
  if (!match) return null;
  for (const pair of match[1].split('&')) {
    const eq = pair.indexOf('=');
    if (eq < 0 || pair.slice(0, eq) !== 'url') continue;
    try {
      const invite = decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' '));
      return parseInviteUrl(invite) ? invite : null;
    } catch {
      return null;
    }
  }
  return null;
}
