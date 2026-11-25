import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  ScrollView,
  Share as ShareSheet,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import {
  type AppConfig,
  type GuestLink,
  normalizeUrl,
  onStoredConfigChange,
  parseInviteUrl,
  saveConfig,
} from './config';
import {
  fetchGroups,
  fetchMembers,
  fetchShares,
  fetchGroupInfo,
  fetchGuestPositions,
  createGroup,
  joinGroup,
  setGroupVisibility,
  removeGroupMember,
  deleteGroup,
  leaveGroup,
  createShare,
  revokeShare,
  stopGuestLink,
  type Group,
  type Member,
  type Share,
} from './api';
import { startSharing, stopSharing, isSharing } from './locationTask';
import { loadNicknames, setNickname, type Nicknames } from './nicknames';
import GroupMapScreen from './GroupMapScreen';
import { formatLastSeen } from './format';

interface Props {
  config: AppConfig;
  onConfigChange: (config: AppConfig) => void;
  onReconfigure: () => void;
  // Invite link the app was opened with (see App.tsx), and the callback to
  // mark it as dealt with.
  incomingInvite?: string | null;
  onInviteHandled?: () => void;
}

interface GroupWithMembers extends Group {
  members: Member[];
}

const DURATIONS = [
  { minutes: 15, label: '15m' },
  { minutes: 60, label: '1h' },
  { minutes: 240, label: '4h' },
  { minutes: 0, label: '∞' },
] as const;

export default function HomeScreen({
  config,
  onConfigChange,
  onReconfigure,
  incomingInvite,
  onInviteHandled,
}: Props) {
  const [sharing, setSharing] = useState(false);
  const [statusChecked, setStatusChecked] = useState(false);
  const [groups, setGroups] = useState<GroupWithMembers[]>([]);
  const [groupsFailed, setGroupsFailed] = useState(false);
  // True once the server has answered at least once, so an empty list means
  // "no groups" rather than "still loading".
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [openGroupId, setOpenGroupId] = useState<number | null>(null);
  const [openGuestToken, setOpenGuestToken] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [joinInviteUrl, setJoinInviteUrl] = useState('');
  const [joiningGroup, setJoiningGroup] = useState(false);
  const [nicknames, setNicknames] = useState<Nicknames>({});
  const [shares, setShares] = useState<Share[]>([]);
  const [shareMinutes, setShareMinutes] = useState(60);
  const [creatingShare, setCreatingShare] = useState(false);
  const [newGuestUrl, setNewGuestUrl] = useState('');
  const [newGuestName, setNewGuestName] = useState('');
  const [newGuestDuration, setNewGuestDuration] = useState(60);
  const [joiningGuestLink, setJoiningGuestLink] = useState(false);
  // Guest mode: who is in each joined group, for the status line in the list,
  // or 'not_sharing' while the server doesn't show this guest the others.
  const [guestMembers, setGuestMembers] = useState<Record<string, Member[] | 'not_sharing'>>({});
  // Group to open once the group list has it (after joining from an invite)
  const [openWhenLoadedToken, setOpenWhenLoadedToken] = useState<string | null>(null);
  const guestNameInputRef = useRef<TextInput>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const groupsRef = useRef<GroupWithMembers[]>([]);

  // Keep ref in sync so the poll interval can access it without a stale closure
  groupsRef.current = groups;

  useEffect(() => {
    if (!openWhenLoadedToken) return;
    const group = groups.find((g) => g.token === openWhenLoadedToken);
    if (group) {
      setOpenGroupId(group.id);
      setOpenWhenLoadedToken(null);
    }
  }, [groups, openWhenLoadedToken]);

  // Opened from an invite link ("Open in the Hereabouts app" on the invite
  // page). Nothing happens without the user confirming: with an account the
  // app asks before joining, as a guest it fills in the join form.
  useEffect(() => {
    if (!incomingInvite) return;
    onInviteHandled?.();
    handleIncomingInvite(incomingInvite);
  }, [incomingInvite]);

  async function handleIncomingInvite(invite: string) {
    const parsed = parseInviteUrl(invite);
    if (!parsed) return;
    setOpenGroupId(null);
    setOpenGuestToken(null);

    if (config.mode === 'guest') {
      // An ended link (removed, group deleted) gets the join form instead
      if (config.guestLinks.some((l) => l.token === parsed.token && !l.ended)) {
        setOpenGuestToken(parsed.token);
        return;
      }
      setNewGuestUrl(invite);
      // After the list has rendered again
      setTimeout(() => guestNameInputRef.current?.focus(), 300);
      return;
    }

    // Account mode: invites only work on the server the app is logged in to
    if (normalizeUrl(parsed.server).toLowerCase() !== normalizeUrl(config.serverUrl).toLowerCase()) {
      Alert.alert(
        'Invite for another server',
        `This invite is for ${parsed.server}, but Hereabouts is logged in to ${config.serverUrl}. You can join it as a guest in the browser instead.`,
        [
          { text: 'Open in browser', onPress: () => Linking.openURL(invite) },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
      return;
    }

    const existing = groupsRef.current.find((g) => g.token === parsed.token);
    if (existing) {
      setOpenGroupId(existing.id);
      return;
    }

    const info = await fetchGroupInfo(parsed.server, parsed.token);
    Alert.alert(
      info ? `Join "${info.name}"?` : 'Join this group?',
      `${info ? `${info.ownerDisplayName} invited you. ` : ''}You'll see everyone in the group on the map. Whether you share your own location there is up to you.`,
      [
        {
          text: 'Join',
          onPress: async () => {
            const ok = await joinGroup(config, parsed.token);
            if (!ok) {
              Alert.alert("Couldn't join", 'Check your connection and try again.');
              return;
            }
            setOpenWhenLoadedToken(parsed.token);
            loadGroups();
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }

  const loadGroups = useCallback(async () => {
    const resp = await fetchGroups(config);
    if (!resp) {
      if (groupsRef.current.length === 0) setGroupsFailed(true);
      return;
    }
    setGroupsFailed(false);
    const withMembers = await Promise.all(
      resp.groups.map(async (g) => ({ ...g, members: await fetchMembers(config, g.id) })),
    );
    setGroups(withMembers);
    setGroupsLoaded(true);
  }, [config]);

  const refreshShares = useCallback(async () => {
    if (config.mode === 'nextcloud') {
      const data = await fetchShares(config);
      setShares(data);
    }
  }, [config]);

  useEffect(() => {
    isSharing().then((active) => {
      setSharing(active);
      setStatusChecked(true);
    });

    if (config.mode === 'nextcloud') {
      loadGroups();
      fetchShares(config).then(setShares);
      loadNicknames().then(setNicknames);
    }

    pollRef.current = setInterval(() => {
      if (config.mode === 'nextcloud') loadGroups();
      refreshShares();
    }, 15000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // The background task switches off guest links the server ended (the owner
  // removed this guest, or deleted the group), and stops location updates
  // when none is left.
  useEffect(
    () =>
      onStoredConfigChange((updated) => {
        onConfigChange(updated);
        if (updated.mode === 'guest' && !updated.guestLinks.some((l) => l.enabled)) {
          setSharing(false);
        }
      }),
    [onConfigChange],
  );

  const guestLinksKey = config.guestLinks
    .map((l) => `${l.server}|${l.token}|${l.name}|${l.enabled}|${l.ended ?? ''}`)
    .join(',');
  useEffect(() => {
    if (config.mode !== 'guest') return;
    let cancelled = false;
    // Guests only see the others while they share there, so links with the
    // switch off aren't asked (their row says to turn it on).
    async function loadGuestMembers() {
      const entries = await Promise.all(
        config.guestLinks
          .filter((l) => l.enabled && !l.ended)
          .map(async (l) => [l.token, await fetchGuestPositions(l)] as const),
      );
      if (cancelled) return;
      // A failed request keeps what the row showed before
      setGuestMembers((prev) => {
        const next: Record<string, Member[] | 'not_sharing'> = {};
        for (const [token, result] of entries) {
          const value = result ?? prev[token];
          if (value !== undefined) next[token] = value;
        }
        return next;
      });
    }
    loadGuestMembers();
    const id = setInterval(loadGuestMembers, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [config.mode, guestLinksKey]);

  // Backfills groupName on links saved before that field existed (or where
  // the lookup failed at join time), so old configs pick up group labels
  // without the user having to rejoin.
  useEffect(() => {
    if (config.mode !== 'guest') return;
    const missing = config.guestLinks.filter((l) => !l.groupName);
    if (missing.length === 0) return;
    (async () => {
      const infos = await Promise.all(
        missing.map((l) => fetchGroupInfo(l.server, l.token)),
      );
      const updated = config.guestLinks.map((l) => {
        const i = missing.findIndex((m) => m.token === l.token);
        return i >= 0 && infos[i] ? { ...l, groupName: infos[i]!.name } : l;
      });
      await persistGuestLinks(updated);
    })();
  }, [config.mode, config.guestLinks.length]);

  // Requests location permission and starts the background task if it isn't
  // already running. Called as a side effect of the action that actually
  // needs sharing on (making a group visible, creating a share link) -
  // there's no separate master switch to flip first.
  async function ensureSharing(): Promise<boolean> {
    if (sharing) return true;

    const { status: fg } =
      await Location.requestForegroundPermissionsAsync();
    if (fg !== 'granted') {
      Alert.alert(
        'Permission needed',
        'Location permission is required to share your position.',
      );
      return false;
    }

    const { status: bg } =
      await Location.requestBackgroundPermissionsAsync();
    if (bg !== 'granted') {
      Alert.alert(
        'Background location needed',
        'Allow "Always" location access so Hereabouts keeps sharing when the screen is off.',
        [
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
      return false;
    }

    await startSharing();
    setSharing(true);
    return true;
  }

  // Stops the background task once nothing needs it any more: no group
  // you're visible in, and no active share link.
  function maybeStopSharing(nextGroups: GroupWithMembers[], nextShares: Share[]) {
    const stillNeeded = nextGroups.some((g) => g.visible) || nextShares.length > 0;
    if (!stillNeeded && sharing) {
      stopSharing();
      setSharing(false);
    }
  }

  async function persistGuestLinks(links: GuestLink[]) {
    const updated = await saveConfig({ ...config, guestLinks: links });
    onConfigChange(updated);
    return updated;
  }

  async function handleAddGuestLink() {
    const parsed = parseInviteUrl(newGuestUrl.trim());
    if (!parsed) {
      Alert.alert('Invalid link', 'Paste the full invite link you received.');
      return;
    }
    const name = newGuestName.trim();
    if (!name) return;
    const existing = config.guestLinks.find((l) => l.token === parsed.token);
    if (existing && !existing.ended) {
      Alert.alert('Already joined', "You're already sharing to this group.");
      return;
    }

    setJoiningGuestLink(true);
    const info = await fetchGroupInfo(parsed.server, parsed.token);
    const ok = await ensureSharing();
    setJoiningGuestLink(false);
    if (!ok) return;

    const link: GuestLink = {
      token: parsed.token,
      server: parsed.server,
      name,
      groupName: info?.name,
      duration: newGuestDuration,
      enabled: true,
      // Joining again on purpose after the owner removed you, like the web
      // join form: the server lets you back in
      ...(existing?.ended === 'removed' ? { rejoin: true } : {}),
    };
    await persistGuestLinks([
      ...config.guestLinks.filter((l) => l.token !== parsed.token),
      link,
    ]);
    setNewGuestUrl('');
    setNewGuestName('');
  }

  async function handleToggleGuestLink(link: GuestLink) {
    const next = !link.enabled;
    if (next) {
      const ok = await ensureSharing();
      if (!ok) return;
    } else {
      await stopGuestLink(link);
    }
    const updatedLinks = config.guestLinks.map((l) =>
      l.token === link.token ? { ...l, enabled: next } : l,
    );
    await persistGuestLinks(updatedLinks);
    if (!next && !updatedLinks.some((l) => l.enabled) && sharing) {
      await stopSharing();
      setSharing(false);
    }
  }

  function handleRemoveGuestLink(link: GuestLink) {
    // Already not sharing there: just take it off the list
    if (link.ended) {
      persistGuestLinks(config.guestLinks.filter((l) => l.token !== link.token));
      return;
    }
    Alert.alert(
      'Leave group',
      `Stop sharing your location to "${link.name}"?`,
      [
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            await stopGuestLink(link);
            const updatedLinks = config.guestLinks.filter((l) => l.token !== link.token);
            await persistGuestLinks(updatedLinks);
            if (!updatedLinks.some((l) => l.enabled) && sharing) {
              await stopSharing();
              setSharing(false);
            }
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }

  // Android's share menu: chat apps, and "Copy" for anything else. Only the
  // link is sent; chat apps show its preview (PageController::addLinkPreview).
  function handleInvite(group: GroupWithMembers) {
    ShareSheet.share(
      { message: group.inviteUrl },
      { dialogTitle: `Invite people to "${displayName(group)}"` },
    ).catch((e) => console.error('[Hereabouts] invite share failed:', e));
  }

  async function handleToggleGroupVisibility(group: GroupWithMembers) {
    const next = !group.visible;
    if (next) {
      const ok = await ensureSharing();
      if (!ok) return;
    }
    const ok = await setGroupVisibility(config, group.id, next);
    if (!ok) return;
    const updated = groups.map((g) => (g.id === group.id ? { ...g, visible: next } : g));
    setGroups(updated);
    if (!next) maybeStopSharing(updated, shares);
    const members = await fetchMembers(config, group.id);
    setGroups((prev) => prev.map((g) => (g.id === group.id ? { ...g, members } : g)));
  }

  async function handleCreateGroup() {
    const name = newGroupName.trim();
    if (!name) return;
    setCreatingGroup(true);
    const group = await createGroup(config, name);
    setCreatingGroup(false);
    if (!group) return;
    setGroups((prev) => [...prev, { ...group, members: [] }]);
    setNewGroupName('');
  }

  async function handleJoinGroup() {
    const parsed = parseInviteUrl(joinInviteUrl.trim());
    if (!parsed) {
      Alert.alert('Invalid link', 'Paste the full invite link you received.');
      return;
    }
    setJoiningGroup(true);
    const ok = await joinGroup(config, parsed.token);
    setJoiningGroup(false);
    if (!ok) {
      Alert.alert("Couldn't join", 'Check the link and try again.');
      return;
    }
    setJoinInviteUrl('');
    loadGroups();
  }

  function displayName(group: { id: number; name: string }): string {
    return nicknames[group.id] ?? group.name;
  }

  async function handleSetNickname(groupId: number, nickname: string) {
    const next = await setNickname(groupId, nickname);
    setNicknames(next);
  }

  async function handleRemoveMember(group: GroupWithMembers, userId: string) {
    const ok = await removeGroupMember(config, group.id, userId);
    if (!ok) return;
    setGroups((prev) =>
      prev.map((g) =>
        g.id === group.id
          ? { ...g, members: g.members.filter((m) => m.userId !== userId) }
          : g,
      ),
    );
  }

  async function handleDeleteGroup(group: GroupWithMembers) {
    Alert.alert(
      'Delete group',
      `Delete "${group.name}"? Everyone in it will lose access, including you.`,
      [
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const ok = await deleteGroup(config, group.id);
            if (!ok) return;
            const updated = groups.filter((g) => g.id !== group.id);
            setGroups(updated);
            setOpenGroupId(null);
            maybeStopSharing(updated, shares);
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }

  async function handleLeaveGroup(group: GroupWithMembers) {
    Alert.alert(
      'Leave group',
      `Leave "${group.name}"? You won't see the others anymore, and they won't see you. You can join again with the invite link.`,
      [
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            const ok = await leaveGroup(config, group.id);
            if (!ok) {
              Alert.alert('Could not leave the group', 'Check your connection and try again.');
              return;
            }
            const updated = groups.filter((g) => g.id !== group.id);
            setGroups(updated);
            setOpenGroupId(null);
            maybeStopSharing(updated, shares);
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }

  async function handleCreateShare() {
    const ok = await ensureSharing();
    if (!ok) return;
    setCreatingShare(true);
    const share = await createShare(config, shareMinutes);
    setCreatingShare(false);
    if (!share) return;
    setShares((prev) => [share, ...prev]);
    handleShareLink(share);
  }

  function handleShareLink(share: Share) {
    ShareSheet.share(
      { message: share.url },
      { dialogTitle: 'Share your location' },
    ).catch((e) => console.error('[Hereabouts] link share failed:', e));
  }

  function handleRevoke(share: Share) {
    Alert.alert(
      'Stop this link?',
      'Anyone who has the link can no longer see where you are.',
      [
        {
          text: 'Stop',
          style: 'destructive',
          onPress: async () => {
            const ok = await revokeShare(config, share.id);
            if (!ok) return;
            const updated = shares.filter((s) => s.id !== share.id);
            setShares(updated);
            maybeStopSharing(groups, updated);
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }

  const openGroup = groups.find((g) => g.id === openGroupId) ?? null;
  // Closes the map by itself when the owner removes you while it's open
  const openGuestLink =
    config.guestLinks.find((l) => l.token === openGuestToken && !l.ended) ?? null;
  const guestLinkCounts = {
    enabled: config.guestLinks.filter((l) => l.enabled).length,
    joined: config.guestLinks.filter((l) => !l.ended).length,
  };

  if (openGroup) {
    return (
      <GroupMapScreen
        title={displayName(openGroup)}
        members={openGroup.members}
        loaded
        onBack={() => setOpenGroupId(null)}
        settings={
          <GroupSettings
            group={openGroup}
            nickname={nicknames[openGroup.id] ?? ''}
            onInvite={() => handleInvite(openGroup)}
            onToggleSharing={() => handleToggleGroupVisibility(openGroup)}
            onRemoveMember={(userId) => handleRemoveMember(openGroup, userId)}
            onDeleteGroup={() => handleDeleteGroup(openGroup)}
            onLeaveGroup={() => handleLeaveGroup(openGroup)}
            onSetNickname={(value) => handleSetNickname(openGroup.id, value)}
          />
        }
      />
    );
  }

  if (openGuestLink) {
    return <GuestMapScreen link={openGuestLink} onBack={() => setOpenGuestToken(null)} />;
  }

  return (
    <SafeAreaView style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <Image
          source={require('../assets/adaptive-icon-foreground.png')}
          style={styles.headerIcon}
        />
        <Text style={styles.headerTitle}>Hereabouts</Text>
        <TouchableOpacity
          style={styles.settingsBtn}
          accessibilityLabel="Settings"
          onPress={() => {
            Alert.alert(
              'Edit settings',
              'Sharing will stop while you edit your connection settings.',
              [
                {
                  text: 'Continue',
                  onPress: async () => {
                    await stopSharing();
                    onReconfigure();
                  },
                },
                { text: 'Cancel', style: 'cancel' },
              ],
            );
          }}
        >
          <MaterialIcons name="settings" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* ── Sharing status (read-only; derived from groups + share links) ── */}
        <View style={styles.card}>
          <View style={styles.sharingRow}>
            <View
              style={[
                styles.statusDot,
                sharing ? styles.dotGreen : styles.dotGrey,
              ]}
            />
            <View style={styles.sharingTexts}>
              <Text style={styles.sharingTitle}>
                {sharing ? 'Sharing location' : 'Not sharing'}
              </Text>
              <Text style={styles.sharingSubtitle}>
                {config.mode === 'guest'
                  ? sharing
                    ? `Sharing to ${guestLinkCounts.enabled} of ${guestLinkCounts.joined} group${guestLinkCounts.joined === 1 ? '' : 's'}, updating every ~5 s`
                    : 'Join a group below to start sharing'
                  : sharing
                  ? 'Visible via an active group or share link'
                  : 'Turn on a group or create a share link to start'}
              </Text>
            </View>
            {config.mode === 'guest' && !statusChecked && (
              <ActivityIndicator color={PRIMARY} />
            )}
          </View>
        </View>

        {/* ── Joined groups (guest mode) ── */}
        {config.mode === 'guest' && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Groups</Text>
            <Text style={styles.sectionNote}>
              Paste another invite link to share your location in more than one group.
            </Text>

            {config.guestLinks.length === 0 && (
              <Text style={styles.emptyNote}>No groups yet</Text>
            )}

            {config.guestLinks.map((link, i) => {
              const loaded = guestMembers[link.token];
              // Guests only see the others while they share there
              const lockedNote = link.ended
                ? undefined
                : !link.enabled
                ? 'Turn on sharing to see the others'
                : loaded === 'not_sharing'
                ? 'Waiting for your location…'
                : undefined;
              return (
                <GroupRow
                  key={link.token}
                  title={link.groupName || 'Unnamed group'}
                  members={link.ended || lockedNote ? [] : Array.isArray(loaded) ? loaded : null}
                  shareLabel={`Share my location as ${link.name}`}
                  shareValue={link.enabled}
                  onShareChange={() => handleToggleGuestLink(link)}
                  onOpen={() => setOpenGuestToken(link.token)}
                  onLeave={() => handleRemoveGuestLink(link)}
                  endedNote={
                    link.ended === 'removed'
                      ? 'The group owner removed you'
                      : link.ended === 'gone'
                      ? 'This group was deleted'
                      : undefined
                  }
                  lockedNote={lockedNote}
                  bordered={i > 0}
                />
              );
            })}

            <View style={[styles.newGroupRow, { marginTop: config.guestLinks.length ? 16 : 12 }]}>
              <TextInput
                style={styles.newGroupInput}
                value={newGuestUrl}
                onChangeText={setNewGuestUrl}
                placeholder="Paste invite link to join"
                placeholderTextColor="#aaa"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <View style={styles.newGroupRow}>
              <TextInput
                ref={guestNameInputRef}
                style={styles.newGroupInput}
                value={newGuestName}
                onChangeText={setNewGuestName}
                placeholder="Your name in this group"
                placeholderTextColor="#aaa"
              />
            </View>
            <View style={styles.durationRow}>
              {DURATIONS.map(({ minutes, label }) => (
                <TouchableOpacity
                  key={minutes}
                  style={[
                    styles.durBtn,
                    newGuestDuration === minutes && styles.durBtnActive,
                  ]}
                  onPress={() => setNewGuestDuration(minutes)}
                >
                  <Text
                    style={[
                      styles.durBtnText,
                      newGuestDuration === minutes && styles.durBtnTextActive,
                    ]}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={[
                styles.createBtn,
                (!newGuestUrl.trim() || !newGuestName.trim() || joiningGuestLink) &&
                  styles.createBtnDisabled,
              ]}
              onPress={handleAddGuestLink}
              disabled={!newGuestUrl.trim() || !newGuestName.trim() || joiningGuestLink}
            >
              {joiningGuestLink ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.createBtnText}>+ Join group</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* ── Share links (authenticated only) ── */}
        {config.mode === 'nextcloud' && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Share my location</Text>
            <Text style={styles.sectionNote}>
              A temporary link anyone can open to watch, no account needed.
            </Text>

            <View style={styles.durationRow}>
              {DURATIONS.map(({ minutes, label }) => (
                <TouchableOpacity
                  key={minutes}
                  style={[
                    styles.durBtn,
                    shareMinutes === minutes && styles.durBtnActive,
                  ]}
                  onPress={() => setShareMinutes(minutes)}
                >
                  <Text
                    style={[
                      styles.durBtnText,
                      shareMinutes === minutes && styles.durBtnTextActive,
                    ]}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.createBtn, creatingShare && styles.createBtnDisabled]}
              onPress={handleCreateShare}
              disabled={creatingShare}
            >
              {creatingShare ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.createBtnText}>+ Create share link</Text>
              )}
            </TouchableOpacity>

            {shares.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { marginTop: 20 }]}>
                  Active links
                </Text>
                {shares.map((share) => (
                  <ShareRow
                    key={share.id}
                    share={share}
                    onShare={() => handleShareLink(share)}
                    onRevoke={() => handleRevoke(share)}
                  />
                ))}
              </>
            )}
          </View>
        )}

        {/* ── Groups overview (authenticated only) ── */}
        {config.mode === 'nextcloud' && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Groups</Text>
            <Text style={styles.sectionNote}>
              Everyone in a group can see each other's location.
            </Text>

            {groups.length === 0 &&
              (groupsLoaded ? (
                <View style={styles.emptyGroups}>
                  <Text style={styles.emptyGroupsTitle}>No groups yet</Text>
                  <Text style={styles.emptyGroupsText}>
                    Create a group and send invite links, or paste an invite link from someone else.
                  </Text>
                </View>
              ) : groupsFailed ? (
                <View style={styles.retryBlock}>
                  <Text style={styles.retryNote}>Couldn't reach the server.</Text>
                  <TouchableOpacity style={styles.retryBtn} onPress={loadGroups}>
                    <Text style={styles.retryBtnText}>Retry</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <Text style={styles.emptyNote}>Loading…</Text>
              ))}

            {groups.map((group, i) => (
              <GroupRow
                key={group.id}
                title={displayName(group)}
                members={group.members}
                shareLabel="Share my location here"
                shareValue={group.visible}
                onShareChange={() => handleToggleGroupVisibility(group)}
                onOpen={() => setOpenGroupId(group.id)}
                onInvite={() => handleInvite(group)}
                bordered={i > 0}
              />
            ))}

            <View style={styles.newGroupRow}>
              <TextInput
                style={styles.newGroupInput}
                value={joinInviteUrl}
                onChangeText={setJoinInviteUrl}
                placeholder="Paste invite link to join"
                placeholderTextColor="#aaa"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={[
                  styles.newGroupBtn,
                  (!joinInviteUrl.trim() || joiningGroup) && styles.createBtnDisabled,
                ]}
                onPress={handleJoinGroup}
                disabled={!joinInviteUrl.trim() || joiningGroup}
              >
                {joiningGroup ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.newGroupBtnText}>Join</Text>
                )}
              </TouchableOpacity>
            </View>

            <View style={styles.newGroupRow}>
              <TextInput
                style={styles.newGroupInput}
                value={newGroupName}
                onChangeText={setNewGroupName}
                placeholder="New group name"
                placeholderTextColor="#aaa"
              />
              <TouchableOpacity
                style={[
                  styles.newGroupBtn,
                  (!newGroupName.trim() || creatingGroup) && styles.createBtnDisabled,
                ]}
                onPress={handleCreateGroup}
                disabled={!newGroupName.trim() || creatingGroup}
              >
                {creatingGroup ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.newGroupBtnText}>+ Create</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── GroupSettings ────────────────────────────────────────────────────────────
// Contents of the settings sheet behind the map's settings button.

function GroupSettings({
  group,
  nickname,
  onInvite,
  onToggleSharing,
  onRemoveMember,
  onDeleteGroup,
  onLeaveGroup,
  onSetNickname,
}: {
  group: GroupWithMembers;
  nickname: string;
  onInvite: () => void;
  onToggleSharing: () => void;
  onRemoveMember: (userId: string) => void;
  onDeleteGroup: () => void;
  onLeaveGroup: () => void;
  onSetNickname: (value: string) => void;
}) {
  const [nicknameDraft, setNicknameDraft] = useState(nickname);

  // Save when the field loses focus or on Enter, and when the sheet closes
  // (which unmounts this without necessarily blurring the field first).
  const latest = useRef({ draft: nicknameDraft, saved: nickname, onSetNickname });
  latest.current.draft = nicknameDraft;
  latest.current.onSetNickname = onSetNickname;
  function saveNickname() {
    const { draft, saved } = latest.current;
    if (draft.trim() === saved) return;
    latest.current.saved = draft.trim();
    latest.current.onSetNickname(draft);
  }
  useEffect(() => saveNickname, []);

  return (
    <View style={styles.settingsBody}>
      <View style={styles.settingsSwitchRow}>
        <Text style={styles.settingsSwitchLabel}>Share my location here</Text>
        <Switch
          value={group.visible}
          onValueChange={onToggleSharing}
          trackColor={{ true: PRIMARY, false: '#d1d5db' }}
          thumbColor="#fff"
        />
      </View>

      <Text style={styles.settingsLabel}>Your name for this group</Text>
      <TextInput
        style={styles.nicknameInput}
        value={nicknameDraft}
        onChangeText={setNicknameDraft}
        onEndEditing={saveNickname}
        onSubmitEditing={saveNickname}
        placeholder={group.name}
        placeholderTextColor="#aaa"
        returnKeyType="done"
      />
      <Text style={styles.settingsHint}>Only visible to you.</Text>

      <Text style={styles.settingsLabel}>Invite link</Text>
      <View style={styles.shareRow}>
        <View style={styles.shareInfo}>
          <Text style={styles.shareUrl} numberOfLines={1}>
            {group.inviteUrl}
          </Text>
        </View>
        <TouchableOpacity style={styles.iconBtn} onPress={onInvite} accessibilityLabel="Send invite link">
          <MaterialIcons name="share" size={22} color={PRIMARY} />
        </TouchableOpacity>
      </View>

      <Text style={styles.settingsLabel}>Members</Text>
      {group.members.map((m) => (
        <MemberRow
          key={m.userId}
          member={m}
          onRemove={group.isOwner && !m.isMe ? () => onRemoveMember(m.userId) : undefined}
        />
      ))}

      {group.isOwner ? (
        <TouchableOpacity style={styles.deleteGroupBtn} onPress={onDeleteGroup}>
          <Text style={styles.deleteGroupBtnText}>Delete group</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={styles.deleteGroupBtn} onPress={onLeaveGroup}>
          <Text style={styles.deleteGroupBtnText}>Leave group</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── GuestMapScreen ───────────────────────────────────────────────────────────
// Guest-mode counterpart: a guest link has no settings (no ownership, nickname
// or invite to copy), so it's just the map. Polls every 10s while open,
// matching the web guest join page's join.js.

function GuestMapScreen({ link, onBack }: { link: GuestLink; onBack: () => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loaded, setLoaded] = useState(false);
  // The server shows the others only while it has a recent position from
  // this guest: e.g. not yet after switching on, or after the phone had no
  // location for 15 minutes.
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      const data = await fetchGuestPositions(link);
      if (cancelled) return;
      if (data === 'not_sharing') {
        setMembers([]);
        setWaiting(true);
      } else if (data !== null) {
        setMembers(data);
        setWaiting(false);
      }
      // A failed request keeps the last map
      setLoaded(true);
    }
    poll();
    const id = setInterval(poll, 10000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [link.token, link.server, link.name]);

  return (
    <GroupMapScreen
      title={link.groupName || 'Unnamed group'}
      members={members}
      loaded={loaded}
      notice={
        waiting
          ? "Waiting for your location. You'll see the others as soon as it has been sent."
          : undefined
      }
      onBack={onBack}
    />
  );
}

// ── GroupRow ─────────────────────────────────────────────────────────────────
// One group in the home screen's list. The whole upper part opens the group's
// map; the member initials and the "Map" pill are there to make that obvious.
// Sharing into the group is a separate line below, so the switch doesn't
// compete with the tap target.

function GroupRow({
  title,
  members,
  shareLabel,
  shareValue,
  onShareChange,
  onOpen,
  onInvite,
  onLeave,
  endedNote,
  lockedNote,
  bordered,
}: {
  title: string;
  members: Member[] | null; // null = not loaded yet
  shareLabel: string;
  shareValue: boolean;
  onShareChange: () => void;
  onOpen: () => void;
  onInvite?: () => void;
  onLeave?: () => void;
  // Guest link the server ended ("The group owner removed you"): no map, no
  // switch, just the note and ✕ to take it off the list
  endedNote?: string;
  // Guest link whose map can't be opened yet ("Turn on sharing to see the
  // others"): the note replaces the member summary, the switch stays
  lockedNote?: string;
  bordered: boolean;
}) {
  const ended = endedNote !== undefined;
  const noMap = ended || lockedNote !== undefined;
  return (
    <View style={[styles.groupBlock, bordered && styles.groupBlockBorder]}>
      {/* The invite button sits outside the Pressable: TalkBack treats a
          Pressable as one element, so a button inside it couldn't be reached. */}
      <View style={styles.groupTop}>
        <Pressable
          onPress={onOpen}
          disabled={noMap}
          android_ripple={noMap ? undefined : { color: '#dbeafe' }}
          style={({ pressed }) => [
            styles.groupMain,
            onInvite && styles.groupMainWithInvite,
            pressed && styles.groupMainPressed,
          ]}
          accessibilityRole={noMap ? undefined : 'button'}
          accessibilityLabel={noMap ? `${title}: ${endedNote ?? lockedNote}` : `Open the map of ${title}`}
        >
          <AvatarStack members={members ?? []} />
          <View style={styles.groupText}>
            <Text style={styles.groupName} numberOfLines={1}>
              {title}
            </Text>
            <Text style={[styles.groupStatus, ended && styles.groupStatusEnded]} numberOfLines={1}>
              {endedNote ?? lockedNote ?? groupStatus(members)}
            </Text>
          </View>
          {!noMap && (
            <View style={styles.mapPill}>
              <MaterialIcons name="map" size={16} color={PRIMARY} />
              <Text style={styles.mapPillText}>Map</Text>
            </View>
          )}
        </Pressable>
        {onInvite && (
          <TouchableOpacity
            style={styles.invitePill}
            onPress={onInvite}
            accessibilityRole="button"
            accessibilityLabel={`Invite people to ${title}`}
          >
            <MaterialIcons name="person-add-alt" size={18} color={PRIMARY} />
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.groupShareRow}>
        <Text style={styles.groupShareLabel} numberOfLines={1}>
          {ended ? 'Your location is no longer shared here' : shareLabel}
        </Text>
        {!ended && (
          <Switch
            value={shareValue}
            onValueChange={onShareChange}
            trackColor={{ true: PRIMARY, false: '#d1d5db' }}
            thumbColor="#fff"
          />
        )}
        {onLeave && (
          <TouchableOpacity
            style={styles.memberRemoveBtn}
            onPress={onLeave}
            accessibilityLabel={ended ? `Remove ${title} from the list` : `Leave ${title}`}
          >
            <MaterialIcons name="close" size={20} color={DANGER} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// Group picture made of initials circles, like the markers on the map: blue
// for people who are sharing, grey for the rest. One member fills the square;
// with more, two smaller circles overlap diagonally, the second one showing
// "+N" when there are more than two. Always the same size, so names line up.
function AvatarStack({ members }: { members: Member[] }) {
  const sorted = [...members].sort((a, b) => Number(b.hasPosition) - Number(a.hasPosition));
  const initial = (m: Member) => m.displayName.charAt(0).toUpperCase();
  const idle = (m: Member) => !m.hasPosition && styles.stackAvatarIdle;

  if (sorted.length <= 1) {
    const m = sorted[0];
    return (
      <View style={styles.avatarStack}>
        <View style={[styles.stackAvatar, styles.stackAvatarSingle, m ? idle(m) : styles.stackAvatarEmpty]}>
          {m ? (
            <Text style={styles.stackAvatarText}>{initial(m)}</Text>
          ) : (
            <MaterialIcons name="group" size={20} color="#9ca3af" />
          )}
        </View>
      </View>
    );
  }

  const [first, second] = sorted;
  const extra = sorted.length - 1;
  return (
    <View style={styles.avatarStack}>
      <View style={[styles.stackAvatar, styles.stackAvatarBack, idle(first)]}>
        <Text style={styles.stackAvatarText}>{initial(first)}</Text>
      </View>
      {sorted.length === 2 ? (
        <View style={[styles.stackAvatar, styles.stackAvatarFront, idle(second)]}>
          <Text style={styles.stackAvatarText}>{initial(second)}</Text>
        </View>
      ) : (
        <View style={[styles.stackAvatar, styles.stackAvatarFront, styles.stackAvatarMore]}>
          <Text style={styles.stackAvatarMoreText}>+{extra}</Text>
        </View>
      )}
    </View>
  );
}

function groupStatus(members: Member[] | null): string {
  if (members === null) return 'Loading…';
  if (members.length === 0) return 'No one here yet';
  if (members.every((m) => m.isMe)) return 'Just you so far';
  const sharing = members.filter((m) => m.hasPosition);
  if (sharing.length === 0) return `${members.length} members · nobody sharing`;
  const latest = Math.max(...sharing.map((m) => m.updatedAt ?? 0));
  return `${sharing.length} of ${members.length} sharing · ${formatLastSeen(latest || null).toLowerCase()}`;
}

// ── ShareRow ─────────────────────────────────────────────────────────────────

function ShareRow({
  share,
  onShare,
  onRevoke,
}: {
  share: Share;
  onShare: () => void;
  onRevoke: () => void;
}) {
  return (
    <View style={styles.shareRow}>
      <View style={styles.shareInfo}>
        <Text style={styles.shareUrl} numberOfLines={1}>
          {share.url}
        </Text>
        <Text style={styles.shareExpiry}>{formatExpiry(share.expiresAt)}</Text>
      </View>
      <TouchableOpacity style={styles.iconBtn} onPress={onShare} accessibilityLabel="Send link">
        <MaterialIcons name="share" size={22} color={PRIMARY} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.iconBtn} onPress={onRevoke} accessibilityLabel="Stop this link">
        <MaterialIcons name="close" size={22} color={DANGER} />
      </TouchableOpacity>
    </View>
  );
}

// ── MemberRow ─────────────────────────────────────────────────────────────────

function MemberRow({
  member,
  onRemove,
  selected,
  onSelect,
}: {
  member: Member;
  onRemove?: () => void;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const nowSec = Math.floor(Date.now() / 1000);
  const stale =
    member.updatedAt !== null && nowSec - member.updatedAt > 300;
  const dotColor = !member.hasPosition
    ? '#d1d5db'
    : stale
    ? '#f59e0b'
    : '#22c55e';

  return (
    <TouchableOpacity
      style={[styles.memberRow, selected && styles.memberRowSelected]}
      onPress={member.hasPosition ? onSelect : undefined}
      activeOpacity={member.hasPosition ? 0.6 : 1}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>
          {member.displayName.charAt(0).toUpperCase()}
        </Text>
      </View>
      <View style={styles.memberInfo}>
        <Text style={styles.memberName}>
          {member.displayName}
          {member.isMe ? ' (you)' : ''}
        </Text>
        <Text style={styles.memberSeen}>
          {member.hasPosition
            ? formatLastSeen(member.updatedAt)
            : 'Not sharing'}
        </Text>
      </View>
      <View style={[styles.memberDot, { backgroundColor: dotColor }]} />
      {onRemove && (
        <TouchableOpacity
          style={styles.memberRemoveBtn}
          accessibilityLabel={`Remove ${member.displayName}`}
          onPress={() =>
            Alert.alert(
              'Remove member',
              `Remove ${member.displayName} from this group?`,
              [
                { text: 'Remove', style: 'destructive', onPress: onRemove },
                { text: 'Cancel', style: 'cancel' },
              ],
            )
          }
        >
          <MaterialIcons name="close" size={20} color={DANGER} />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatExpiry(expiresAt: number | null): string {
  if (!expiresAt) return 'No expiry';
  const diff = expiresAt - Math.floor(Date.now() / 1000);
  if (diff <= 0) return 'Expired';
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  return h > 0 ? `Expires in ${h}h ${m}m` : `Expires in ${m + 1} min`;
}


// ── Styles ────────────────────────────────────────────────────────────────────

const PRIMARY = '#0082c9';
// Removing people, stopping links, leaving and deleting groups
const DANGER = '#dc2626';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f0f4f8' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PRIMARY,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
  headerIcon: { width: 28, height: 28 },
  headerTitle: { flex: 1, fontSize: 20, fontWeight: '700', color: '#fff' },
  settingsBtn: {
    padding: 12,
    margin: -12,
    borderRadius: 24,
  },

  scroll: { padding: 16, gap: 14, paddingBottom: 48 },

  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },

  sharingRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  dotGreen: { backgroundColor: '#22c55e' },
  dotGrey: { backgroundColor: '#d1d5db' },
  sharingTexts: { flex: 1 },
  sharingTitle: { fontSize: 16, fontWeight: '600', color: '#111' },
  sharingSubtitle: { fontSize: 13, color: '#6b7280', marginTop: 2 },

  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    color: '#9ca3af',
    marginBottom: 12,
  },
  sectionNote: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: -8,
    marginBottom: 14,
  },

  groupBlock: { paddingVertical: 6 },
  groupBlockBorder: { borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  groupMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 6,
    marginHorizontal: -6,
    borderRadius: 10,
    overflow: 'hidden',
  },
  groupMainPressed: { backgroundColor: '#eff6ff' },
  groupTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // No negative margin on the right, or the press highlight would run under
  // the invite button
  groupMainWithInvite: { marginRight: 0 },
  invitePill: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e6f3fa',
  },
  groupText: { flex: 1, minWidth: 0 },
  groupName: { fontSize: 15, fontWeight: '600', color: '#111' },
  groupStatus: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  groupStatusEnded: { color: DANGER, fontWeight: '600' },
  mapPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#e6f3fa',
  },
  mapPillText: { fontSize: 13, fontWeight: '700', color: PRIMARY },
  groupShareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 54,
  },
  groupShareLabel: { flex: 1, fontSize: 13, color: '#4b5563' },
  avatarStack: { width: 44, height: 44 },
  stackAvatar: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: PRIMARY,
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stackAvatarSingle: { width: 40, height: 40, borderRadius: 20, top: 2, left: 2, borderWidth: 0 },
  stackAvatarBack: { top: 0, left: 0 },
  stackAvatarFront: { bottom: 0, right: 0 },
  stackAvatarIdle: { backgroundColor: '#cbd5e1' },
  stackAvatarEmpty: { backgroundColor: '#f3f4f6' },
  stackAvatarMore: { backgroundColor: '#e5e7eb' },
  stackAvatarText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  stackAvatarMoreText: { color: '#4b5563', fontWeight: '700', fontSize: 11 },

  settingsBody: { paddingBottom: 8 },
  settingsSwitchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  settingsSwitchLabel: { fontSize: 15, color: '#111' },
  settingsLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    color: '#9ca3af',
    marginTop: 18,
    marginBottom: 4,
  },
  settingsHint: { fontSize: 12, color: '#9ca3af', marginTop: 4 },

  nicknameInput: {
    backgroundColor: '#fafafa',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: '#111',
    marginTop: 4,
  },

  newGroupRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  newGroupInput: {
    flex: 1,
    backgroundColor: '#fafafa',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
    color: '#111',
  },
  newGroupBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newGroupBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },

  durationRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  durBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#d1d5db',
    alignItems: 'center',
    backgroundColor: '#fafafa',
  },
  durBtnActive: { borderColor: PRIMARY, backgroundColor: PRIMARY },
  durBtnText: { fontSize: 13, fontWeight: '600', color: '#4b5563' },
  durBtnTextActive: { color: '#fff' },

  createBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  createBtnDisabled: { backgroundColor: '#9ca3af' },
  createBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },

  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    gap: 4,
  },
  shareInfo: { flex: 1, minWidth: 0 },
  shareUrl: { fontSize: 13, color: PRIMARY, fontWeight: '500' },
  shareExpiry: { fontSize: 11, color: '#9ca3af', marginTop: 2 },
  iconBtn: { padding: 8 },

  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: 10,
  },
  memberRowSelected: {
    backgroundColor: '#eef6fc',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 14, fontWeight: '500', color: '#111' },
  memberSeen: { fontSize: 12, color: '#9ca3af', marginTop: 1 },
  memberDot: { width: 8, height: 8, borderRadius: 4 },
  memberRemoveBtn: { paddingLeft: 10, paddingVertical: 4 },

  deleteGroupBtn: { alignItems: 'center', marginTop: 16, paddingVertical: 6 },
  deleteGroupBtnText: { fontSize: 13, fontWeight: '600', color: '#dc2626' },

  emptyNote: { fontSize: 14, color: '#9ca3af', textAlign: 'center', paddingVertical: 8 },
  emptyGroups: { alignItems: 'center', gap: 4, paddingVertical: 8, paddingHorizontal: 8 },
  emptyGroupsTitle: { fontSize: 15, fontWeight: '600', color: '#374151' },
  emptyGroupsText: { fontSize: 13, color: '#6b7280', textAlign: 'center', lineHeight: 18 },

  retryBlock: { alignItems: 'center', paddingVertical: 8, gap: 10 },
  retryNote: { fontSize: 14, color: '#dc2626' },
  retryBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: PRIMARY,
  },
  retryBtnText: { fontSize: 13, fontWeight: '600', color: PRIMARY },
});
