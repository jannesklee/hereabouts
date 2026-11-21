<template>
	<NcContent app-name="hereabouts">
		<NcAppNavigation>
			<template #list>
				<!-- Share location (Mode 2) -->
				<div class="ls-nav-section">
					<h3 class="ls-nav-heading">Share my location</h3>
					<div class="ls-duration-row">
						<button
							v-for="opt in durationOptions"
							:key="opt.minutes"
							class="ls-dur-btn"
							:class="{ 'ls-dur-btn--active': shareMinutes === opt.minutes }"
							@click="shareMinutes = opt.minutes">
							{{ opt.label }}
						</button>
					</div>
					<NcButton
						variant="primary"
						:disabled="creatingShare"
						style="width:100%;margin-top:8px;"
						@click="createShare">
						Create share link
					</NcButton>
				</div>

				<!-- Active shares -->
				<div v-if="shares.length" class="ls-nav-section">
					<h3 class="ls-nav-heading">Active links</h3>
					<ul class="ls-share-list">
						<li v-for="share in shares" :key="share.id" class="ls-share-item">
							<div class="ls-share-url-row">
								<input
									class="ls-invite-input"
									readonly
									:value="share.url"
									@focus="$event.target.select()" />
								<NcButton
									variant="tertiary"
									:aria-label="copiedId === share.id ? 'Copied!' : 'Copy link'"
									@click="copyShare(share)">
									<template #icon>
										<CheckIcon v-if="copiedId === share.id" :size="18" />
										<ContentCopyIcon v-else :size="18" />
									</template>
								</NcButton>
								<NcButton
									variant="tertiary"
									aria-label="Revoke link"
									@click="revokeShare(share.id)">
									<template #icon>
										<DeleteIcon :size="18" />
									</template>
								</NcButton>
							</div>
							<p class="ls-share-expiry">
								{{ formatExpiry(share.expiresAt) }}
							</p>
						</li>
					</ul>
				</div>

				<!-- Groups overview (Mode 1) -->
				<div class="ls-nav-section">
					<h3 class="ls-nav-heading">Groups</h3>
					<p class="ls-share-expiry" style="margin-bottom:6px;">
						Everyone in a group can see each other's location.
					</p>

					<div v-for="group in groups" :key="group.id" class="ls-group-overview-row">
						<button
							class="ls-group-name-link"
							:class="{ 'ls-group-name-link--active': group.id === openGroupId }"
							@click="openGroupId = group.id">
							{{ group.name }} <span class="ls-chevron">›</span>
						</button>
						<label class="ls-group-visible">
							<input
								type="checkbox"
								:checked="group.visible"
								@change="toggleGroupVisibility(group)" />
							Visible here
						</label>
					</div>

					<div class="ls-new-group-row">
						<input
							v-model="joinInviteUrl"
							class="ls-invite-input"
							placeholder="Paste invite link to join"
							@keyup.enter="joinGroup" />
						<NcButton
							variant="tertiary"
							:disabled="joiningGroup || !joinInviteUrl.trim()"
							@click="joinGroup">
							Join
						</NcButton>
					</div>

					<div class="ls-new-group-row">
						<input
							v-model="newGroupName"
							class="ls-invite-input"
							placeholder="New group name"
							@keyup.enter="createGroup" />
						<NcButton
							variant="tertiary"
							:disabled="creatingGroup || !newGroupName.trim()"
							@click="createGroup">
							+ Create
						</NcButton>
					</div>
				</div>
			</template>
		</NcAppNavigation>

		<NcAppContent>
			<!-- The same live map as the guest page (components/LiveMap.vue);
				with a group open, back and settings buttons in its top bar. -->
			<LiveMap
				:members="mapMembers"
				:title="openGroup ? openGroup.name : 'All groups'"
				:fit-key="openGroupId"
				:member-groups="memberGroupsByUser"
				after-toggle
				@open-group="openGroupId = $event">
				<template v-if="openGroup" #leading>
					<NcButton variant="tertiary" aria-label="Back to all groups" @click="openGroupId = null">
						<template #icon>
							<ArrowLeftIcon :size="20" />
						</template>
					</NcButton>
				</template>
				<template v-if="openGroup" #actions>
					<NcButton variant="tertiary" aria-label="Group settings" @click="settingsOpen = true">
						<template #icon>
							<CogIcon :size="20" />
						</template>
					</NcButton>
				</template>
			</LiveMap>

			<!-- Group settings -->
			<NcModal
				v-if="settingsOpen && openGroup"
				name="Group settings"
				size="small"
				@close="settingsOpen = false">
				<div class="ls-settings">
					<h2 class="ls-settings-title">
						{{ openGroup.name }}
					</h2>

					<NcCheckboxRadioSwitch
						type="switch"
						:model-value="openGroup.visible"
						@update:model-value="toggleGroupVisibility(openGroup)">
						Share my location here
					</NcCheckboxRadioSwitch>

					<h3 class="ls-nav-heading ls-settings-heading">
						Invite link
					</h3>
					<div class="ls-share-url-row">
						<input
							class="ls-invite-input"
							readonly
							:value="openGroup.inviteUrl"
							@focus="$event.target.select()">
						<NcButton
							variant="tertiary"
							:aria-label="copiedGroupId === openGroup.id ? 'Copied!' : 'Copy invite link'"
							@click="copyGroupInvite(openGroup)">
							<template #icon>
								<CheckIcon v-if="copiedGroupId === openGroup.id" :size="18" />
								<ContentCopyIcon v-else :size="18" />
							</template>
						</NcButton>
					</div>

					<h3 class="ls-nav-heading ls-settings-heading">
						Members
					</h3>
					<ul class="ls-member-list">
						<li v-for="member in openGroup.members" :key="member.userId" class="ls-member-item">
							<img
								v-if="member.avatarUrl"
								class="ls-member-avatar"
								:src="member.avatarUrl"
								:alt="member.displayName">
							<span v-else class="ls-member-avatar ls-member-avatar--initial">
								{{ member.displayName.charAt(0).toUpperCase() }}
							</span>
							<span class="ls-member-name">
								{{ member.displayName }}
								<span v-if="member.isMe"> (you)</span>
							</span>
							<span
								class="ls-member-status"
								:class="memberStatusClass(member)"
								:title="memberStatusTitle(member)" />
							<NcButton
								v-if="openGroup.isOwner && !member.isMe"
								variant="tertiary"
								:aria-label="'Remove ' + member.displayName"
								:title="'Remove ' + member.displayName"
								@click="removeGroupMember(openGroup, member)">
								<template #icon>
									<DeleteIcon :size="16" />
								</template>
							</NcButton>
						</li>
					</ul>

					<button
						v-if="openGroup.isOwner"
						class="ls-delete-group-btn"
						@click="deleteGroup(openGroup)">
						Delete group
					</button>
				</div>
			</NcModal>
		</NcAppContent>
	</NcContent>
</template>

<script>
import { loadState } from '@nextcloud/initial-state'
import axios from '@nextcloud/axios'
import { generateUrl } from '@nextcloud/router'
import { emit } from '@nextcloud/event-bus'
import {
	NcContent,
	NcAppNavigation,
	NcAppContent,
	NcButton,
	NcCheckboxRadioSwitch,
	NcModal,
} from '@nextcloud/vue'
import ArrowLeftIcon from 'vue-material-design-icons/ArrowLeft.vue'
import CheckIcon from 'vue-material-design-icons/Check.vue'
import CogIcon from 'vue-material-design-icons/Cog.vue'
import ContentCopyIcon from 'vue-material-design-icons/ContentCopy.vue'
import DeleteIcon from 'vue-material-design-icons/Delete.vue'
import LiveMap from './components/LiveMap.vue'
import { isStale } from './utils/stale.js'

export default {
	name: 'HereaboutsApp',

	components: {
		NcContent,
		NcAppNavigation,
		NcAppContent,
		NcButton,
		NcCheckboxRadioSwitch,
		NcModal,
		ArrowLeftIcon,
		CheckIcon,
		CogIcon,
		ContentCopyIcon,
		DeleteIcon,
		LiveMap,
	},

	data() {
		return {
			state: loadState('hereabouts', 'hereabouts-state'),
			watchId: null,
			pollInterval: null,
			heartbeatInterval: null,
			members: [],
			// userId -> [{ id, name }] for every one of *my* groups that member is
			// visible via - always the full cross-group picture, independent of
			// which single group (if any) is currently narrowing the map.
			memberGroupsByUser: {},
			nowTs: Math.floor(Date.now() / 1000),
			settingsOpen: false,
			statusInterval: null,
			lastPosition: null,
			wakeLock: null,
			// groups (Mode 1)
			groups: [],
			openGroupId: null,
			newGroupName: '',
			creatingGroup: false,
			copiedGroupId: null,
			joinInviteUrl: '',
			joiningGroup: false,
			// share management (Mode 2)
			shares: [],
			shareMinutes: 60,
			creatingShare: false,
			copiedId: null,
		}
	},

	mounted() {
		this.$nextTick(() => {
			this.watchId = navigator.geolocation.watchPosition(
				(pos) => this.sendPosition(pos),
				(err) => console.warn('Geolocation error', err),
				{ enableHighAccuracy: true, maximumAge: 30000, timeout: 15000 },
			)

			// Heartbeat: re-send last known position every 30s in case watchPosition
			// stops firing (stationary device, browser throttling, etc.)
			this.heartbeatInterval = setInterval(() => {
				if (this.lastPosition) this.sendPosition(this.lastPosition)
			}, 30000)

			this.acquireWakeLock()
			document.addEventListener('visibilitychange', this.onVisibilityChange)

			this.fetchGroups().then(() => {
				this.openGroupFromUrl()
				this.fetchPositions()
			})
			this.pollInterval = setInterval(() => {
				this.fetchGroups().then(() => this.fetchPositions())
				this.fetchShares()
			}, 15000)
			this.statusInterval = setInterval(() => {
				this.nowTs = Math.floor(Date.now() / 1000)
			}, 30000)
			this.fetchShares()
		})
	},

	beforeUnmount() {
		if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId)
		if (this.pollInterval !== null) clearInterval(this.pollInterval)
		if (this.heartbeatInterval !== null) clearInterval(this.heartbeatInterval)
		if (this.statusInterval !== null) clearInterval(this.statusInterval)
		document.removeEventListener('visibilitychange', this.onVisibilityChange)
		this.releaseWakeLock()
	},

	methods: {
		sendPosition(pos) {
			this.lastPosition = pos
			axios.post(this.state.updateUrl, {
				lat: pos.coords.latitude,
				lon: pos.coords.longitude,
				accuracy: pos.coords.accuracy ?? null,
				altitude: pos.coords.altitude ?? null,
				speed: pos.coords.speed ?? null,
				bearing: pos.coords.heading ?? null,
			}).catch((e) => console.error('Failed to update position', e))
		},

		async acquireWakeLock() {
			if (!('wakeLock' in navigator)) return
			try {
				this.wakeLock = await navigator.wakeLock.request('screen')
			} catch (e) {
				console.warn('Wake lock not granted', e)
			}
		},

		releaseWakeLock() {
			if (this.wakeLock) {
				this.wakeLock.release()
				this.wakeLock = null
			}
		},

		// Re-acquire wake lock when tab becomes visible again (it is released automatically
		// when the tab goes to the background)
		onVisibilityChange() {
			if (document.visibilityState === 'visible') {
				this.acquireWakeLock()
				// Also send an immediate heartbeat so we don't wait up to 30s
				if (this.lastPosition) this.sendPosition(this.lastPosition)
			}
		},

		// Notifications ("Anna joined Family") link to ?group=<id>: open that
		// group's map, then drop the parameter so a reload shows the overview.
		openGroupFromUrl() {
			const url = new URL(window.location.href)
			const id = Number(url.searchParams.get('group'))
			if (!id) return
			if (this.groups.some((g) => g.id === id)) this.openGroupId = id
			url.searchParams.delete('group')
			window.history.replaceState(null, '', url.toString())
		},

		async fetchGroups() {
			try {
				const { data } = await axios.get(this.state.groupsUrl)
				// The groups API has no members; keep the last known ones until
				// fetchPositions() refreshes them, so the open group's map and
				// settings don't empty out for a moment every 15s.
				const previous = new Map(this.groups.map((g) => [g.id, g.members]))
				this.groups = data.groups.map((g) => ({ ...g, members: previous.get(g.id) ?? [] }))
			} catch (e) {
				console.error('Failed to fetch groups', e)
			}
		},

		async joinGroup() {
			const raw = this.joinInviteUrl.trim()
			if (!raw) return
			let token = null
			try {
				const u = new URL(raw)
				const parts = u.pathname.split('/').filter(Boolean)
				const idx = parts.indexOf('join')
				if (idx >= 0 && idx + 1 < parts.length) token = parts[idx + 1]
			} catch (e) {
				// not a valid URL
			}
			if (!token) {
				alert('Paste the full invite link you received.')
				return
			}
			this.joiningGroup = true
			try {
				await axios.post(generateUrl('/apps/hereabouts/join/' + token + '/accept'))
				this.joinInviteUrl = ''
				await this.fetchGroups()
				await this.fetchPositions()
			} catch (e) {
				console.error('Failed to join group', e)
				alert("Couldn't join. Check the link and try again.")
			} finally {
				this.joiningGroup = false
			}
		},

		async createGroup() {
			const name = this.newGroupName.trim()
			if (!name) return
			this.creatingGroup = true
			try {
				const { data } = await axios.post(
					generateUrl('/apps/hereabouts/groups') + '?name=' + encodeURIComponent(name),
				)
				data.members = []
				this.groups.push(data)
				this.newGroupName = ''
			} catch (e) {
				console.error('Failed to create group', e)
			} finally {
				this.creatingGroup = false
			}
		},

		async toggleGroupVisibility(group) {
			const next = !group.visible
			try {
				await axios.post(
					generateUrl('/apps/hereabouts/group/' + group.id + '/visibility') + '?visible=' + (next ? '1' : '0'),
				)
				group.visible = next
				this.fetchPositions()
			} catch (e) {
				console.error('Failed to update group visibility', e)
			}
		},

		// Works for guests too (userId "guest_<id>"): their open invite page
		// stops sharing. Either can come back through the invite link.
		async removeGroupMember(group, member) {
			if (!confirm(`Remove ${member.displayName} from "${group.name}"? They can join again with the invite link.`)) return
			try {
				await axios.post(
					generateUrl('/apps/hereabouts/group/' + group.id + '/members/' + encodeURIComponent(member.userId) + '/remove'),
				)
				group.members = group.members.filter((m) => m.userId !== member.userId)
			} catch (e) {
				console.error('Failed to remove group member', e)
			}
		},

		async deleteGroup(group) {
			if (!confirm(`Delete "${group.name}"? Everyone in it will lose access, including you.`)) return
			try {
				await axios.post(generateUrl('/apps/hereabouts/group/' + group.id + '/delete'))
				this.groups = this.groups.filter((g) => g.id !== group.id)
				this.openGroupId = null
			} catch (e) {
				console.error('Failed to delete group', e)
			}
		},

		async copyGroupInvite(group) {
			try {
				await navigator.clipboard.writeText(group.inviteUrl)
			} catch {
				// fallback: not needed for modern browsers
			}
			this.copiedGroupId = group.id
			setTimeout(() => { this.copiedGroupId = null }, 2000)
		},

		// Merges each group's own member/guest list (kept on group.members for the
		// per-group sidebar view) into one flat, deduplicated list for the map —
		// the same person can be visible via more than one group.
		async fetchPositions() {
			try {
				const results = await Promise.all(
					this.groups.map((g) => axios.get(g.positionsUrl).then((r) => r.data).catch(() => [])),
				)
				const merged = new Map()
				const groupsByUser = {}
				this.groups.forEach((group, i) => {
					group.members = results[i]
					for (const m of results[i]) {
						const existing = merged.get(m.userId)
						if (!existing || (!existing.hasPosition && m.hasPosition)) {
							merged.set(m.userId, m)
						}
						if (!groupsByUser[m.userId]) groupsByUser[m.userId] = []
						groupsByUser[m.userId].push({ id: group.id, name: group.name })
					}
				})
				this.memberGroupsByUser = groupsByUser
				const data = Array.from(merged.values())
				this.members = data
			} catch (e) {
				console.error('Failed to fetch positions', e)
			}
		},

		memberStatusClass(member) {
			if (!member.hasPosition) return 'ls-member-status--inactive'
			if (isStale(member.updatedAt, this.nowTs)) return 'ls-member-status--stale'
			return 'ls-member-status--active'
		},

		memberStatusTitle(member) {
			if (!member.hasPosition) return 'Not sharing'
			if (isStale(member.updatedAt, this.nowTs)) {
				const mins = Math.round((this.nowTs - member.updatedAt) / 60)
				return `Last update ${mins} min ago`
			}
			return 'Sharing location'
		},

		async fetchShares() {
			try {
				const { data } = await axios.get(generateUrl('/apps/hereabouts/shares'))
				this.shares = data
			} catch (e) {
				console.error('Failed to fetch shares', e)
			}
		},

		async createShare() {
			this.creatingShare = true
			try {
				const { data } = await axios.post(
					generateUrl('/apps/hereabouts/share') + '?duration=' + this.shareMinutes,
				)
				this.shares.unshift(data)
				this.copyShare(data)
			} catch (e) {
				console.error('Failed to create share', e)
			} finally {
				this.creatingShare = false
			}
		},

		async revokeShare(id) {
			try {
				await axios.post(generateUrl('/apps/hereabouts/share/' + id + '/revoke'))
				this.shares = this.shares.filter((s) => s.id !== id)
			} catch (e) {
				console.error('Failed to revoke share', e)
			}
		},

		async copyShare(share) {
			try {
				await navigator.clipboard.writeText(share.url)
			} catch {
				// fallback: not needed for modern browsers
			}
			this.copiedId = share.id
			setTimeout(() => { this.copiedId = null }, 2000)
		},

		formatExpiry(expiresAt) {
			if (!expiresAt) return 'No expiry'
			const diff = expiresAt - Math.floor(Date.now() / 1000)
			if (diff <= 0) return 'Expired'
			const h = Math.floor(diff / 3600)
			const m = Math.floor((diff % 3600) / 60)
			return h > 0 ? `Expires in ${h}h ${m}m` : `Expires in ${m + 1} min`
		},
	},

	computed: {
		openGroup() {
			return this.groups.find((g) => g.id === this.openGroupId) || null
		},

		// The map shows just one group's people while its detail view is open,
		// and everyone across all groups (deduplicated) otherwise.
		mapMembers() {
			return this.openGroup ? (this.openGroup.members ?? []) : this.members
		},

		durationOptions() {
			return [
				{ minutes: 15, label: '15 min' },
				{ minutes: 60, label: '1 hr' },
				{ minutes: 240, label: '4 hr' },
				{ minutes: 0, label: '∞' },
			]
		},
	},

	watch: {
		// Opening a group gives its map the whole content area: the sidebar
		// (a drawer covering the map on phones) closes and comes back when
		// leaving the group. LiveMap frames the group itself (fit-key).
		openGroupId(id) {
			this.settingsOpen = false
			emit('toggle-navigation', { open: id === null })
		},
	},
}
</script>

<style>
/* Ensure Vue root fills Nextcloud's content area so height:100% chain works */
#hereabouts-app {
	height: 100%;
}

/* Group settings dialog */
.ls-settings {
	padding: 20px;
}

.ls-settings-title {
	font-size: 18px;
	font-weight: 600;
	margin: 0 0 12px;
}

.ls-settings-heading {
	margin-top: 18px;
}

/* Sidebar sections */
.ls-nav-section {
	padding: 12px 16px;
	border-bottom: 1px solid var(--color-border, #ededed);
}

.ls-nav-heading {
	font-size: 11px;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.05em;
	color: var(--color-text-maxcontrast, #767676);
	margin: 0 0 8px;
}

/* Duration picker */
.ls-duration-row {
	display: grid;
	grid-template-columns: repeat(4, 1fr);
	gap: 6px;
}

.ls-duration-row .ls-dur-btn {
	padding: 7px 2px;
	font-size: 12px;
	font-weight: 600;
	border: 2px solid var(--color-border, #ddd);
	border-radius: var(--border-radius, 3px);
	background: var(--color-main-background, #fff);
	color: var(--color-text-maxcontrast, #000000);
	cursor: pointer;
	transition: border-color 0.1s, color 0.1s;
}

.ls-duration-row .ls-dur-btn--active,
.ls-duration-row .ls-dur-btn:active {
	background-color: var(--color-primary, #0082c9) !important;
	color: var(--color-primary-text, #fff) !important;
	border-color: var(--color-primary, #0082c9);
}


/* Active share list */
.ls-share-list {
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: 10px;
}

.ls-share-item {
	display: flex;
	flex-direction: column;
	gap: 3px;
}

.ls-share-url-row {
	display: flex;
	align-items: center;
	gap: 2px;
}

.ls-invite-input {
	flex: 1;
	min-width: 0;
	font-size: 12px;
	padding: 4px 8px;
	border: 1px solid var(--color-border, #ededed);
	border-radius: var(--border-radius, 3px);
	background: var(--color-background-hover, #f5f5f5);
	color: var(--color-text-light, #222);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.ls-share-expiry {
	font-size: 11px;
	color: var(--color-text-maxcontrast, #767676);
	margin: 0;
	padding-left: 2px;
}

/* Groups */
.ls-group-overview-row {
	padding: 8px 0;
	border-top: 1px solid var(--color-border, #ededed);
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
}

.ls-group-overview-row:first-child {
	border-top: none;
	padding-top: 0;
}

.ls-group-name-link {
	display: flex;
	align-items: center;
	gap: 2px;
	background: none;
	border: none;
	padding: 0;
	font-size: 13px;
	font-weight: 600;
	color: var(--color-text-light, #222);
	cursor: pointer;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.ls-chevron {
	color: var(--color-text-maxcontrast, #767676);
}

.ls-group-name-link--active {
	color: var(--color-primary-element, #0082c9);
}

.ls-delete-group-btn {
	display: block;
	background: none;
	border: none;
	margin: 14px auto 0;
	padding: 4px;
	font-size: 12px;
	font-weight: 600;
	color: var(--color-error, #dc2626);
	cursor: pointer;
}

.ls-group-visible {
	display: flex;
	align-items: center;
	gap: 4px;
	font-size: 11px;
	color: var(--color-text-maxcontrast, #767676);
	white-space: nowrap;
}

.ls-new-group-row {
	display: flex;
	align-items: center;
	gap: 2px;
	margin-top: 4px;
}

/* Member list */
.ls-member-list {
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.ls-member-item {
	display: flex;
	align-items: center;
	gap: 8px;
	border-radius: var(--border-radius-element, 8px);
	padding: 2px 6px;
	margin: 0 -6px;
}

.ls-member-avatar {
	width: 32px;
	height: 32px;
	border-radius: 50%;
	flex-shrink: 0;
	object-fit: cover;
}

.ls-member-avatar--initial {
	background: var(--color-primary, #0082c9);
	color: #fff;
	font-size: 14px;
	font-weight: 600;
	display: flex;
	align-items: center;
	justify-content: center;
}

.ls-member-name {
	flex: 1;
	font-size: 13px;
	color: var(--color-text-light, #222);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.ls-member-status {
	width: 8px;
	height: 8px;
	border-radius: 50%;
	flex-shrink: 0;
}

.ls-member-status--active {
	background: #46ba61;
}

.ls-member-status--stale {
	background: var(--color-border-dark, #c8c8c8);
}

.ls-member-status--inactive {
	background: var(--color-border-dark, #c8c8c8);
}
</style>
