# Changelog

## 0.1.5 – unreleased

### Added
- Link previews in chat apps (WhatsApp, Signal, Telegram, ...): group invites and share links each get their own title, text and image
- "Open in the Hereabouts app" on the invite page on Android, which opens the companion app (it asks before joining)
- Nextcloud notifications when someone joins a group (member or guest), sent to everyone else in it; clicking one opens the group
- Members can leave a group they don't own ("Leave group" in the group settings, web and companion app)

### Changed
- Invite button for each group directly in the group list (web: copies the link; app: opens the Android share menu)
- Companion app: share links and invites are sent with the Android share menu, which also offers "Copy"; a new share link opens it right away
- Simpler, consistent icons: ✕ for removing people and stopping links (instead of a bin), three dots for a group's settings (instead of a gear); the app's emoji buttons are now regular icons
- Stopping a share link asks first
- Group map, guest page and share-link page now use the same full-screen live map
- Redesigned guest sign-up form on the invite page
- People who stop sending updates count as not sharing after 15 minutes: guests drop out of the group, members stay but their position is hidden

### Fixed
- The group owner can now remove guests (the remove button did nothing for them); a removed guest's open page stops sharing

## 0.1.0 – 2026-03-20

### Added
- Timed share links (15 min / 1 hr / 4 hr / no expiry) with live map viewer
- Automatic cleanup of expired share links
