import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';
import { sendPosition, sendGuestPosition, type GuestSendResult } from './api';
import { type AppConfig, type GuestLink, normalizeConfig, updateStoredGuestLinks } from './config';

export const LOCATION_TASK = 'hereabouts-background-location';

interface LocationTaskData {
  locations: Location.LocationObject[];
}

// Must be defined at module level (top-level call, outside React components).
// This file is imported in App.tsx before any rendering.
TaskManager.defineTask(
  LOCATION_TASK,
  async ({
    data,
    error,
  }: TaskManager.TaskManagerTaskBody<LocationTaskData>) => {
    if (error) {
      console.error('[Hereabouts] Location task error:', error.message);
      return;
    }
    const { locations } = data;
    if (!locations?.length) return;

    const loc = locations[locations.length - 1];

    try {
      const raw = await SecureStore.getItemAsync('hereabouts_config');
      if (!raw) return;
      const config = normalizeConfig(JSON.parse(raw) as Omit<AppConfig, 'isValid'>);
      if (!config.isValid) return;

      const lat = loc.coords.latitude;
      const lon = loc.coords.longitude;
      const acc = loc.coords.accuracy ?? null;
      const alt = loc.coords.altitude ?? null;
      const speed = loc.coords.speed ?? null;
      const heading = loc.coords.heading ?? null;

      if (config.mode === 'nextcloud') {
        await sendPosition(config, lat, lon, acc, alt, speed, heading);
      } else {
        const links = config.guestLinks.filter((link) => link.enabled);
        const results = await Promise.all(
          links.map((link) => sendGuestPosition(link, lat, lon, acc, alt, speed, heading)),
        );
        await handleGuestResults(links, results);
      }
    } catch (e) {
      console.error('[Hereabouts] Failed to send position:', e);
    }
  },
);

export async function startSharing(): Promise<void> {
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: 5000,   // aim for 5-second updates
    distanceInterval: 0,  // update regardless of movement
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.Other,
    showsBackgroundLocationIndicator: true, // iOS blue pill
    foregroundService: {
      notificationTitle: 'Hereabouts',
      notificationBody: 'Sharing your location…',
      notificationColor: '#0082c9',
    },
  });
}

export async function stopSharing(): Promise<void> {
  const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  if (running) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
}

export function isSharing(): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
}

/**
 * Switches off guest links the server ended (owner removed this guest, or
 * deleted the group) instead of sending into them every 5s forever, and
 * stops location updates when no link is left. Also ends the rejoin request
 * once the server accepted it, so a later removal isn't silently undone.
 */
async function handleGuestResults(links: GuestLink[], results: GuestSendResult[]): Promise<void> {
  const ended = new Map<string, 'removed' | 'gone'>();
  const rejoined = new Set<string>();
  links.forEach((link, i) => {
    const result = results[i];
    if (result === 'removed' || result === 'gone') ended.set(link.token, result);
    else if (result === 'ok' && link.rejoin) rejoined.add(link.token);
  });
  if (ended.size === 0 && rejoined.size === 0) return;

  const updated = await updateStoredGuestLinks((stored) =>
    stored.map((l) => {
      const reason = ended.get(l.token);
      if (reason) return { ...l, enabled: false, ended: reason, rejoin: undefined };
      if (rejoined.has(l.token)) return { ...l, rejoin: undefined };
      return l;
    }),
  );
  if (ended.size > 0 && updated && !updated.guestLinks.some((l) => l.enabled)) {
    await stopSharing();
  }
}
