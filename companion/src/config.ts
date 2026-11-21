import * as SecureStore from 'expo-secure-store';

const CONFIG_KEY = 'hereabouts_config';

export type AuthMode = 'nextcloud' | 'guest';

// One joined group in guest mode. A guest can hold several of these at once
// (one per invite link they've pasted in), each with its own display name
// and share duration, sent to independently on every location update.
export interface GuestLink {
  token: string;
  server: string;
  name: string;
  // The group's own name (e.g. "Mom's Location"), fetched from the server at
  // join time - optional because configs saved before this field existed
  // won't have it; UI code falls back to a placeholder when absent.
  groupName?: string;
  duration: number; // minutes; 0 = no expiry
  enabled: boolean;
  // Set by the background task when the server refuses this link: the group
  // owner removed this guest ('removed') or deleted the group ('gone'). The
  // link stays in the list, switched off, so the app can say what happened,
  // until the user takes it off the list or joins again.
  ended?: 'removed' | 'gone';
  // Joined again after being removed: updates ask the server to lift the
  // removal (rejoin=1, like the web join form) until one is accepted.
  rejoin?: boolean;
}

export interface AppConfig {
  mode: AuthMode;
  serverUrl: string;
  // Nextcloud mode
  username: string;
  appPassword: string;
  // Guest mode
  guestLinks: GuestLink[];
  // Derived
  isValid: boolean;
}

function isValid(c: Omit<AppConfig, 'isValid'>): boolean {
  if (c.mode === 'nextcloud') {
    return !!(c.serverUrl && c.username && c.appPassword);
  }
  return c.guestLinks.length > 0;
}

// Older stored configs held a single guestToken/guestName/guestDuration
// instead of guestLinks; default to an empty list so a stale on-device
// config doesn't crash a raw JSON.parse of SecureStore's contents (both
// here and in locationTask.ts, which reads the store directly).
export function normalizeConfig(parsed: Omit<AppConfig, 'isValid'>): AppConfig {
  const guestLinks = Array.isArray(parsed.guestLinks) ? parsed.guestLinks : [];
  return { ...parsed, guestLinks, isValid: isValid({ ...parsed, guestLinks }) };
}

export async function loadConfig(): Promise<AppConfig | null> {
  const raw = await SecureStore.getItemAsync(CONFIG_KEY);
  if (!raw) return null;
  return normalizeConfig(JSON.parse(raw) as Omit<AppConfig, 'isValid'>);
}

export async function saveConfig(
  c: Omit<AppConfig, 'isValid'>,
): Promise<AppConfig> {
  const config: AppConfig = { ...c, isValid: isValid(c) };
  await SecureStore.setItemAsync(CONFIG_KEY, JSON.stringify(config));
  return config;
}

// The background location task changes the stored config too (guest links
// the server ended). The open app listens, so its copy doesn't go stale.
type ConfigListener = (config: AppConfig) => void;
const configListeners = new Set<ConfigListener>();

export function onStoredConfigChange(listener: ConfigListener): () => void {
  configListeners.add(listener);
  return () => {
    configListeners.delete(listener);
  };
}

/**
 * Changes the stored guest links from outside the app's screens (the
 * background task). Reads the config fresh, so changes the app saved in the
 * meantime aren't lost, and tells the open app.
 */
export async function updateStoredGuestLinks(
  change: (links: GuestLink[]) => GuestLink[],
): Promise<AppConfig | null> {
  const current = await loadConfig();
  if (!current) return null;
  const updated = await saveConfig({ ...current, guestLinks: change(current.guestLinks) });
  configListeners.forEach((listener) => listener(updated));
  return updated;
}

export function basicAuthHeader(config: AppConfig): string {
  // btoa is available globally in React Native's JS runtime
  return 'Basic ' + btoa(`${config.username}:${config.appPassword}`);
}

export function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** Parse a join URL like https://cloud.example.com/apps/hereabouts/join/{token} */
export function parseInviteUrl(
  url: string,
): { server: string; token: string } | null {
  try {
    const u = new URL(url.trim());
    const parts = u.pathname.split('/').filter(Boolean);
    const joinIdx = parts.indexOf('join');
    if (joinIdx < 0 || joinIdx + 1 >= parts.length) return null;
    // Keep the path Nextcloud is installed under (https://example.com/nextcloud)
    // and drop index.php, which api.ts adds back to every request.
    let prefix = parts.slice(0, joinIdx);
    if (prefix.slice(-2).join('/') === 'apps/hereabouts') prefix = prefix.slice(0, -2);
    if (prefix[prefix.length - 1] === 'index.php') prefix = prefix.slice(0, -1);
    return {
      server: [`${u.protocol}//${u.host}`, ...prefix].join('/'),
      token: parts[joinIdx + 1],
    };
  } catch {
    return null;
  }
}
