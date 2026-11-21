import { type AppConfig, type GuestLink, basicAuthHeader, normalizeUrl } from './config';

export interface Share {
  id: number;
  token: string;
  url: string;
  expiresAt: number | null;
  createdAt: number;
}

export interface Member {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  hasPosition: boolean;
  lat: number | null;
  lon: number | null;
  acc: number | null;
  updatedAt: number | null;
  isMe: boolean;
  type: 'user' | 'guest';
}

export interface Group {
  id: number;
  name: string;
  token: string;
  isOwner: boolean;
  memberCount: number;
  visible: boolean;
  inviteUrl: string;
  positionsUrl: string;
}

interface GroupsResponse {
  updateUrl: string;
  groups: Group[];
}

// Always go through index.php. Without it the URL only works on servers that
// have pretty URLs set up; on the others Apache reaches Nextcloud via its 404
// error page, which turns every request into a GET, so all POSTs fail with 405.
function appUrl(server: string, path: string): string {
  return `${normalizeUrl(server).replace(/\/index\.php$/, '')}/index.php/apps/hereabouts${path}`;
}

function url(config: AppConfig, path: string): string {
  return appUrl(config.serverUrl, path);
}

function headers(config: AppConfig): HeadersInit {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'OCS-APIRequest': 'true',
  };
  if (config.mode === 'nextcloud') {
    h['Authorization'] = basicAuthHeader(config);
  }
  return h;
}

// Nextcloud mode only - config carries the credentials used to authenticate.
export async function sendPosition(
  config: AppConfig,
  lat: number,
  lon: number,
  acc: number | null,
  alt: number | null,
  speed: number | null,
  heading: number | null,
): Promise<boolean> {
  try {
    const endpoint = url(config, '/position');
    const body = { lat, lon, acc, alt, speed, bearing: heading };
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: headers(config),
      body: JSON.stringify(body),
    });
    if (!res.ok) console.error('[Hereabouts] sendPosition failed:', res.status, endpoint);
    return res.ok;
  } catch (e) {
    console.error('[Hereabouts] sendPosition error:', e);
    return false;
  }
}

const guestHeaders: HeadersInit = {
  'Content-Type': 'application/json',
  'OCS-APIRequest': 'true',
};

// Guest mode - one call per joined group, since each carries its own
// server/token/name and is otherwise independent of the others.
/**
 * 'removed': the group owner removed this guest; 'gone': the group was
 * deleted. Both are final, so the caller stops sending for this link.
 * 'failed' is anything that may work again later (no connection, server
 * down or in maintenance mode).
 */
export type GuestSendResult = 'ok' | 'removed' | 'gone' | 'failed';

export async function sendGuestPosition(
  link: GuestLink,
  lat: number,
  lon: number,
  acc: number | null,
  alt: number | null,
  speed: number | null,
  heading: number | null,
): Promise<GuestSendResult> {
  try {
    const endpoint = appUrl(link.server, `/guest/${link.token}`);
    const body = {
      name: link.name,
      lat,
      lon,
      acc,
      alt,
      speed,
      bearing: heading,
      timestamp: Math.floor(Date.now() / 1000),
      ...(link.duration > 0 ? { duration: link.duration } : {}),
      ...(link.rejoin ? { rejoin: true } : {}),
    };
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: guestHeaders,
      body: JSON.stringify(body),
    });
    if (res.ok) return 'ok';
    // Only the app's own JSON answers count as final: a plain 404 page (e.g.
    // the app disabled on the server for a moment) must not end the link.
    const data = await res.json().catch(() => null);
    if (res.status === 403 && data?.error === 'removed') return 'removed';
    if (res.status === 404 && data?.error === 'not_found') return 'gone';
    console.error('[Hereabouts] sendGuestPosition failed:', res.status, endpoint);
    return 'failed';
  } catch (e) {
    console.error('[Hereabouts] sendGuestPosition error:', e);
    return 'failed';
  }
}

// Public lookup used to label a joined guest group with its real name
// instead of the guest's own display name - see GroupController::info().
export async function fetchGroupInfo(
  server: string,
  token: string,
): Promise<{ name: string; ownerDisplayName: string } | null> {
  try {
    const res = await fetch(
      appUrl(server, `/join/${token}/info`),
      { headers: guestHeaders },
    );
    if (!res.ok) return null;
    return (await res.json()) as { name: string; ownerDisplayName: string };
  } catch (e) {
    console.error('[Hereabouts] fetchGroupInfo error:', e);
    return null;
  }
}

// Same shape as fetchMembers(), but for guest mode - uses the group's
// invite token as the auth boundary instead of a Nextcloud session. The
// `name` param marks the caller's own entry as "me", mirroring
// GroupController::guestPositions().
export async function fetchGuestPositions(link: GuestLink): Promise<Member[]> {
  try {
    const params = new URLSearchParams({ name: link.name });
    const res = await fetch(
      appUrl(link.server, `/guest/${link.token}/positions?${params}`),
      { headers: guestHeaders },
    );
    if (!res.ok) {
      console.error('[Hereabouts] fetchGuestPositions failed:', res.status, await res.text());
      return [];
    }
    return (await res.json()) as Member[];
  } catch (e) {
    console.error('[Hereabouts] fetchGuestPositions error:', e);
    return [];
  }
}

export async function stopGuestLink(link: GuestLink): Promise<void> {
  try {
    const params = new URLSearchParams({ name: link.name, stop: '1' });
    await fetch(
      appUrl(link.server, `/guest/${link.token}?${params}`),
      { method: 'POST', headers: guestHeaders },
    );
  } catch (e) {
    console.error('[Hereabouts] stopGuestLink error:', e);
  }
}

export async function fetchGroups(
  config: AppConfig,
): Promise<GroupsResponse | null> {
  try {
    const res = await fetch(url(config, '/api/groups'), { headers: headers(config) });
    if (!res.ok) {
      console.error('[Hereabouts] fetchGroups failed:', res.status, await res.text());
      return null;
    }
    return (await res.json()) as GroupsResponse;
  } catch (e) {
    console.error('[Hereabouts] fetchGroups error:', e);
    return null;
  }
}

export async function joinGroup(
  config: AppConfig,
  token: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      url(config, `/join/${token}/accept`),
      { method: 'POST', headers: headers(config) },
    );
    if (!res.ok) console.error('[Hereabouts] joinGroup failed:', res.status);
    return res.ok;
  } catch (e) {
    console.error('[Hereabouts] joinGroup error:', e);
    return false;
  }
}

export async function createGroup(
  config: AppConfig,
  name: string,
): Promise<Group | null> {
  try {
    const res = await fetch(
      url(config, `/groups?name=${encodeURIComponent(name)}`),
      { method: 'POST', headers: headers(config) },
    );
    if (!res.ok) {
      console.error('[Hereabouts] createGroup failed:', res.status, await res.text());
      return null;
    }
    return (await res.json()) as Group;
  } catch (e) {
    console.error('[Hereabouts] createGroup error:', e);
    return null;
  }
}

export async function setGroupVisibility(
  config: AppConfig,
  groupId: number,
  visible: boolean,
): Promise<boolean> {
  try {
    const res = await fetch(
      url(config, `/group/${groupId}/visibility?visible=${visible ? '1' : '0'}`),
      { method: 'POST', headers: headers(config) },
    );
    if (!res.ok) console.error('[Hereabouts] setGroupVisibility failed:', res.status);
    return res.ok;
  } catch (e) {
    console.error('[Hereabouts] setGroupVisibility error:', e);
    return false;
  }
}

export async function removeGroupMember(
  config: AppConfig,
  groupId: number,
  userId: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      url(config, `/group/${groupId}/members/${encodeURIComponent(userId)}/remove`),
      { method: 'POST', headers: headers(config) },
    );
    if (!res.ok) console.error('[Hereabouts] removeGroupMember failed:', res.status);
    return res.ok;
  } catch (e) {
    console.error('[Hereabouts] removeGroupMember error:', e);
    return false;
  }
}

export async function deleteGroup(
  config: AppConfig,
  groupId: number,
): Promise<boolean> {
  try {
    const res = await fetch(
      url(config, `/group/${groupId}/delete`),
      { method: 'POST', headers: headers(config) },
    );
    if (!res.ok) console.error('[Hereabouts] deleteGroup failed:', res.status);
    return res.ok;
  } catch (e) {
    console.error('[Hereabouts] deleteGroup error:', e);
    return false;
  }
}

/** Leaves a group the user doesn't own (the owner deletes it instead). */
export async function leaveGroup(
  config: AppConfig,
  groupId: number,
): Promise<boolean> {
  try {
    const res = await fetch(
      url(config, `/group/${groupId}/leave`),
      { method: 'POST', headers: headers(config) },
    );
    if (!res.ok) console.error('[Hereabouts] leaveGroup failed:', res.status);
    return res.ok;
  } catch (e) {
    console.error('[Hereabouts] leaveGroup error:', e);
    return false;
  }
}

export async function fetchMembers(
  config: AppConfig,
  groupId: number,
): Promise<Member[]> {
  try {
    const res = await fetch(
      url(config, `/group/${groupId}/positions`),
      { headers: headers(config) },
    );
    if (!res.ok) {
      console.error('[Hereabouts] fetchMembers failed:', res.status, await res.text());
      return [];
    }
    return (await res.json()) as Member[];
  } catch (e) {
    console.error('[Hereabouts] fetchMembers error:', e);
    return [];
  }
}

export async function fetchShares(config: AppConfig): Promise<Share[]> {
  try {
    const res = await fetch(url(config, '/shares'), { headers: headers(config) });
    if (!res.ok) {
      console.error('[Hereabouts] fetchShares failed:', res.status, await res.text());
      return [];
    }
    return (await res.json()) as Share[];
  } catch (e) {
    console.error('[Hereabouts] fetchShares error:', e);
    return [];
  }
}

export async function createShare(
  config: AppConfig,
  durationMinutes: number,
): Promise<Share | null> {
  try {
    const res = await fetch(
      url(config, `/share?duration=${durationMinutes}`),
      { method: 'POST', headers: headers(config) },
    );
    if (!res.ok) {
      console.error('[Hereabouts] createShare failed:', res.status, await res.text());
      return null;
    }
    return (await res.json()) as Share;
  } catch (e) {
    console.error('[Hereabouts] createShare error:', e);
    return null;
  }
}

export async function revokeShare(
  config: AppConfig,
  id: number,
): Promise<boolean> {
  try {
    const res = await fetch(url(config, `/share/${id}/revoke`), {
      method: 'POST',
      headers: headers(config),
    });
    if (!res.ok) console.error('[Hereabouts] revokeShare failed:', res.status);
    return res.ok;
  } catch (e) {
    console.error('[Hereabouts] revokeShare error:', e);
    return false;
  }
}
