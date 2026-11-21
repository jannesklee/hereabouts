import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  Camera,
  type CameraRef,
  type LngLatBounds,
  Map,
  Marker,
} from '@maplibre/maplibre-react-native';
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Member } from './api';

// Same raw-tile OSM style as the web app (src/App.vue / src/Viewer.vue) -
// no API key, no third-party service, direct to tile.openstreetmap.org.
// OSM's tile policy requires visible attribution; GroupMapScreen shows it.
const MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

const PRIMARY = '#0082c9';

// Never zoom in further than about 1 km across when fitting, so one person
// (or two in the same house) still shows the streets around them.
const MIN_SPAN_DEG = 0.01;

export interface MapPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface Props {
  members: Member[];
  // Fly to this member and keep them centred as they move. Cleared (null) to
  // leave the camera where it is.
  focusedUserId?: string | null;
  onSelectMember?: (userId: string) => void;
  // Bump to zoom out to everyone again (the screen's "everyone" button).
  fitRequest?: number;
  // Space covered by the screen's overlays, so markers stay visible.
  padding: MapPadding;
}

type Positioned = Member & { lat: number; lon: number };

function boundsFor(points: Positioned[]): LngLatBounds {
  let west = Math.min(...points.map((p) => p.lon));
  let east = Math.max(...points.map((p) => p.lon));
  let south = Math.min(...points.map((p) => p.lat));
  let north = Math.max(...points.map((p) => p.lat));
  if (east - west < MIN_SPAN_DEG) {
    const mid = (east + west) / 2;
    west = mid - MIN_SPAN_DEG / 2;
    east = mid + MIN_SPAN_DEG / 2;
  }
  if (north - south < MIN_SPAN_DEG) {
    const mid = (north + south) / 2;
    south = mid - MIN_SPAN_DEG / 2;
    north = mid + MIN_SPAN_DEG / 2;
  }
  return [west, south, east, north];
}

export default function GroupMap({
  members,
  focusedUserId,
  onSelectMember,
  fitRequest = 0,
  padding,
}: Props) {
  const cameraRef = useRef<CameraRef>(null);

  const positioned = useMemo(
    () =>
      members.filter(
        (m): m is Positioned => m.hasPosition && m.lat !== null && m.lon !== null,
      ),
    [members],
  );
  const positionedRef = useRef(positioned);
  positionedRef.current = positioned;

  // Room around the markers on top of the overlay padding.
  const fitPadding = {
    top: padding.top + 40,
    right: padding.right + 40,
    bottom: padding.bottom + 40,
    left: padding.left + 40,
  };

  // The map opens showing everyone. After that the camera only moves when the
  // user asks (everyone button, tapping a person), never on a position update,
  // so zooming around isn't interrupted every few seconds.
  useEffect(() => {
    const points = positionedRef.current;
    if (fitRequest === 0 || !cameraRef.current || points.length === 0) return;
    cameraRef.current.fitBounds(boundsFor(points), { padding: fitPadding, duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitRequest]);

  // Following a person: fly to them once, then keep them centred as they move.
  const focused = focusedUserId ? positioned.find((m) => m.userId === focusedUserId) : null;
  const followingRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focused || !cameraRef.current) {
      followingRef.current = null;
      return;
    }
    const center: [number, number] = [focused.lon, focused.lat];
    if (followingRef.current !== focused.userId) {
      cameraRef.current.flyTo({ center, zoom: 15, padding, duration: 700 });
    } else {
      cameraRef.current.easeTo({ center, padding, duration: 500 });
    }
    followingRef.current = focused.userId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused?.userId, focused?.lat, focused?.lon]);

  if (positioned.length === 0) {
    return (
      <View style={[styles.map, styles.empty]}>
        <Text style={styles.emptyText}>Nobody in this group is sharing right now</Text>
      </View>
    );
  }

  return (
    <Map
      style={styles.map}
      mapStyle={MAP_STYLE}
      logo={false}
      attribution={false}
      compassPosition={{ top: padding.top + 8, right: 12 }}
    >
      <Camera
        ref={cameraRef}
        maxZoom={19}
        initialViewState={{ bounds: boundsFor(positioned), padding: fitPadding }}
      />
      {/* The selected person's marker must be on top when people are in the
          same place (e.g. a family at home). The native map stacks markers in
          the order they were added, so a new key re-adds it as the topmost. */}
      {[...positioned]
        .sort((a, b) => Number(a.userId === focusedUserId) - Number(b.userId === focusedUserId))
        .map((m) => (
          <Marker
            key={m.userId === focusedUserId ? `${m.userId}:selected` : m.userId}
            id={m.userId}
            lngLat={[m.lon, m.lat]}
            onPress={() => onSelectMember?.(m.userId)}
          >
            <View
              style={[
                styles.marker,
                m.isMe && styles.markerMe,
                m.userId === focusedUserId && styles.markerFocused,
              ]}
            >
              <Text style={styles.markerText}>{m.displayName.charAt(0).toUpperCase()}</Text>
            </View>
          </Marker>
        ))}
    </Map>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
  empty: {
    backgroundColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyText: { fontSize: 14, color: '#6b7280', textAlign: 'center' },
  marker: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: '#fff',
    backgroundColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
  },
  markerMe: { borderColor: '#bfe3f7', borderWidth: 3 },
  markerFocused: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderColor: '#f59e0b',
    borderWidth: 3,
  },
  markerText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
