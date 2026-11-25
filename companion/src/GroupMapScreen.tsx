// Full-screen map of one group, like a messenger's live location view: the
// map takes the whole screen, with a small floating bar on top (back, group
// name, settings), map buttons on the right, and a strip of member chips at
// the bottom. Tapping a chip or marker follows that person; tapping it again
// zooms back out to everyone. Group settings open in a sheet.
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GroupMap from './GroupMap';
import type { Member } from './api';
import { formatLastSeen } from './format';

const PRIMARY = '#0082c9';

interface Props {
  title: string;
  members: Member[];
  loaded: boolean;
  // Shown instead of the map, e.g. while a guest's own location hasn't
  // reached the server yet (it shows them the others only after that)
  notice?: string;
  onBack: () => void;
  // Contents of the settings sheet. Without it there's no settings button.
  settings?: React.ReactNode;
}

export default function GroupMapScreen({ title, members, loaded, notice, onBack, settings }: Props) {
  const insets = useSafeAreaInsets();
  const [focusedUserId, setFocusedUserId] = useState<string | null>(null);
  const [fitRequest, setFitRequest] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [panelHeight, setPanelHeight] = useState(96 + insets.bottom);

  // Android back button leaves the map (the open sheet handles it itself).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  // You first, then people who are sharing, then the rest.
  const sorted = useMemo(
    () =>
      [...members].sort(
        (a, b) =>
          Number(b.isMe) - Number(a.isMe) ||
          Number(b.hasPosition) - Number(a.hasPosition) ||
          a.displayName.localeCompare(b.displayName),
      ),
    [members],
  );
  const me = members.find((m) => m.isMe && m.hasPosition);
  const sharingCount = members.filter((m) => m.hasPosition).length;

  function showEveryone() {
    setFocusedUserId(null);
    setFitRequest((n) => n + 1);
  }

  function toggleFocus(userId: string) {
    if (focusedUserId === userId) showEveryone();
    else setFocusedUserId(userId);
  }

  const topBarBottom = insets.top + 8 + 52;
  const padding = { top: topBarBottom, right: 56, bottom: panelHeight, left: 0 };

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />

      {loaded && notice ? (
        <View style={styles.loading}>
          <Text style={styles.notice}>{notice}</Text>
        </View>
      ) : loaded ? (
        <GroupMap
          members={members}
          focusedUserId={focusedUserId}
          onSelectMember={toggleFocus}
          fitRequest={fitRequest}
          padding={padding}
        />
      ) : (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={PRIMARY} />
        </View>
      )}

      {/* Keeps the status bar readable over the map. */}
      <View style={[styles.statusScrim, { height: insets.top }]} />

      {/* Top bar: back, group name, settings */}
      <View style={[styles.topBar, { top: insets.top + 8 }]}>
        <TouchableOpacity style={styles.topBarBtn} onPress={onBack} accessibilityLabel="Back to groups">
          <MaterialIcons name="arrow-back" size={24} color="#111" />
        </TouchableOpacity>
        <View style={styles.topBarText}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {!notice && (
            <Text style={styles.subtitle} numberOfLines={1}>
              {sharingCount === 0
                ? 'Nobody sharing right now'
                : `${sharingCount} of ${members.length} sharing`}
            </Text>
          )}
        </View>
        {settings && (
          <TouchableOpacity
            style={styles.topBarBtn}
            onPress={() => setSettingsOpen(true)}
            accessibilityLabel="Group settings"
          >
            <MaterialIcons name="more-vert" size={24} color="#374151" />
          </TouchableOpacity>
        )}
      </View>

      {/* Map buttons, just above the member strip */}
      {sharingCount > 0 && (
        <View style={[styles.mapButtons, { bottom: panelHeight + 12 }]}>
          <TouchableOpacity
            style={styles.mapBtn}
            onPress={showEveryone}
            accessibilityLabel="Show everyone"
          >
            <MaterialIcons name="zoom-out-map" size={22} color="#374151" />
          </TouchableOpacity>
          {me && (
            <TouchableOpacity
              style={styles.mapBtn}
              onPress={() => setFocusedUserId(me.userId)}
              accessibilityLabel="Show me"
            >
              <MaterialIcons
                name="my-location"
                size={22}
                color={focusedUserId === me.userId ? PRIMARY : '#374151'}
              />
            </TouchableOpacity>
          )}
        </View>
      )}

      <Text style={[styles.attribution, { bottom: panelHeight + 4 }]}>
        © OpenStreetMap contributors
      </Text>

      {/* Member strip */}
      <View
        style={[styles.panel, { paddingBottom: insets.bottom + 10 }]}
        onLayout={(e) => setPanelHeight(e.nativeEvent.layout.height)}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          {sorted.map((m) => (
            <MemberChip
              key={`${m.type}:${m.userId}`}
              member={m}
              selected={m.userId === focusedUserId}
              onPress={m.hasPosition ? () => toggleFocus(m.userId) : undefined}
            />
          ))}
          {loaded && !notice && sorted.length === 0 && (
            <Text style={styles.noMembers}>No one in this group yet</Text>
          )}
        </ScrollView>
      </View>

      {settings && (
        <Modal
          visible={settingsOpen}
          transparent
          animationType="slide"
          statusBarTranslucent
          onRequestClose={() => setSettingsOpen(false)}
        >
          <KeyboardAvoidingView
            style={styles.sheetWrap}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <Pressable style={styles.backdrop} onPress={() => setSettingsOpen(false)} />
            <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>Group settings</Text>
                <TouchableOpacity onPress={() => setSettingsOpen(false)} accessibilityLabel="Close">
                  <MaterialIcons name="close" size={24} color="#6b7280" />
                </TouchableOpacity>
              </View>
              <ScrollView keyboardShouldPersistTaps="handled">{settings}</ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      )}
    </View>
  );
}

function MemberChip({
  member,
  selected,
  onPress,
}: {
  member: Member;
  selected: boolean;
  onPress?: () => void;
}) {
  const firstName = member.isMe ? 'You' : member.displayName.split(' ')[0];
  return (
    <TouchableOpacity
      style={[styles.chip, selected && styles.chipSelected]}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={0.7}
      accessibilityLabel={`Show ${member.displayName} on the map`}
    >
      <View style={[styles.chipAvatar, !member.hasPosition && styles.chipAvatarIdle]}>
        <Text style={styles.chipAvatarText}>{member.displayName.charAt(0).toUpperCase()}</Text>
      </View>
      <View>
        <Text style={styles.chipName} numberOfLines={1}>
          {firstName}
        </Text>
        <Text style={styles.chipTime} numberOfLines={1}>
          {member.hasPosition ? formatLastSeen(member.updatedAt) : 'Not sharing'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const shadow = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.18,
  shadowRadius: 4,
  elevation: 4,
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#e5e7eb' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  notice: { fontSize: 15, color: '#4b5563', textAlign: 'center', paddingHorizontal: 32 },
  statusScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(255,255,255,0.8)',
  },

  topBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    ...shadow,
  },
  topBarBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  topBarText: { flex: 1, minWidth: 0, paddingHorizontal: 4 },
  title: { fontSize: 16, fontWeight: '700', color: '#111' },
  subtitle: { fontSize: 12, color: '#6b7280' },

  mapButtons: { position: 'absolute', right: 12, gap: 10 },
  mapBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow,
  },

  attribution: {
    position: 'absolute',
    left: 6,
    fontSize: 10,
    color: '#374151',
    backgroundColor: 'rgba(255,255,255,0.7)',
    paddingHorizontal: 4,
    borderRadius: 3,
  },

  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 12,
    ...shadow,
  },
  chips: { paddingHorizontal: 12, gap: 8, alignItems: 'center' },
  noMembers: { fontSize: 14, color: '#9ca3af', paddingVertical: 12, paddingHorizontal: 4 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingLeft: 6,
    paddingRight: 14,
    borderRadius: 26,
    backgroundColor: '#f3f4f6',
    borderWidth: 2,
    borderColor: 'transparent',
    maxWidth: 180,
  },
  chipSelected: { backgroundColor: '#e6f3fa', borderColor: '#f59e0b' },
  chipAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipAvatarIdle: { backgroundColor: '#cbd5e1' },
  chipAvatarText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  chipName: { fontSize: 14, fontWeight: '600', color: '#111' },
  chipTime: { fontSize: 11, color: '#6b7280' },

  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    maxHeight: '85%',
    backgroundColor: '#fff',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: '#111' },
});
