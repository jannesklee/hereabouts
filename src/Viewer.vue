<!--
  The share-link page (templates/viewer.php): one person's live location for
  anyone with the link, no account needed. Same map as the group and guest
  views (components/LiveMap.vue), with that person as the only member.
-->
<template>
	<div id="ls-viewer-wrap">
		<LiveMap
			:members="members"
			:title="state.ownerDisplayName"
			:status="statusText"
			:detail="expiryLabel" />

		<div v-if="expired" class="ls-viewer-overlay">
			<div class="ls-viewer-card">
				<div class="ls-viewer-badge">
					<LinkVariantOffIcon :size="32" />
				</div>
				<h2>This link is no longer active</h2>
				<p>{{ state.ownerDisplayName }}'s location isn't shared here anymore.</p>
			</div>
		</div>
	</div>
</template>

<script>
import { loadState } from '@nextcloud/initial-state'
import LinkVariantOffIcon from 'vue-material-design-icons/LinkVariantOff.vue'
import LiveMap from './components/LiveMap.vue'
import { formatRemaining } from './utils/remaining.js'
import { isStale } from './utils/stale.js'

const POLL_MS = 10000

function now() {
	return Math.floor(Date.now() / 1000)
}

export default {
	name: 'HereaboutsViewer',

	components: { LinkVariantOffIcon, LiveMap },

	data() {
		return {
			state: loadState('hereabouts', 'hereabouts-viewer-state'),
			// Last answer of the position endpoint; null until the first one
			// arrives, and again once the link has ended.
			position: null,
			expired: false,
			nowTs: now(),
		}
	},

	computed: {
		// The shared person as a positions-API entry (see CLAUDE.md), so the
		// map shows them like a group member: marker, popup and chip.
		members() {
			const p = this.position
			if (!p) return []
			const hasPosition = p.hasPosition === true
			return [{
				type: 'user',
				userId: 'owner',
				displayName: this.state.ownerDisplayName,
				avatarUrl: this.state.ownerAvatarUrl || null,
				isMe: false,
				lat: hasPosition ? p.lat : null,
				lon: hasPosition ? p.lon : null,
				acc: hasPosition ? p.acc : null,
				updatedAt: hasPosition ? p.updatedAt : null,
				hasPosition,
			}]
		},

		statusText() {
			if (this.expired) return 'Link no longer active'
			const p = this.position
			if (!p) return 'Loading…'
			if (!p.hasPosition) return 'Not sharing right now'
			if (!isStale(p.updatedAt, this.nowTs)) return 'Sharing live'
			const age = this.nowTs - p.updatedAt
			return age < 3600
				? `Last seen ${Math.floor(age / 60)} min ago`
				: `Last seen ${Math.floor(age / 3600)}h ago`
		},

		expiryLabel() {
			if (this.expired || !this.state.expiresAt) return null
			const left = formatRemaining(this.state.expiresAt - this.nowTs)
			return left ? `link expires in ${left}` : null
		},
	},

	mounted() {
		this.fetchPosition()
		this.pollTimer = setInterval(this.fetchPosition, POLL_MS)
		this.clockTimer = setInterval(() => {
			this.nowTs = now()
			if (this.state.expiresAt && this.nowTs >= this.state.expiresAt) this.end()
		}, 30000)
	},

	beforeUnmount() {
		clearInterval(this.pollTimer)
		clearInterval(this.clockTimer)
	},

	methods: {
		async fetchPosition() {
			if (this.expired) return
			try {
				const res = await fetch(this.state.positionUrl)
				// 410: expired, 404: the owner deleted the link
				if (res.status === 410 || res.status === 404) {
					this.end()
					return
				}
				if (!res.ok) return
				const data = await res.json()
				this.nowTs = now()
				this.position = data
			} catch (e) {
				// Keep the last known position on a transient failure
				console.warn('Failed to fetch position', e)
			}
		},

		// Stop polling and take the person off the map: an ended link
		// shouldn't keep showing where they were.
		end() {
			this.expired = true
			this.position = null
			clearInterval(this.pollTimer)
		},
	},
}
</script>

<style>
/* Fixed below Nextcloud's header: the public page's #content box would
   otherwise size and pad the map. Map styles are in components/LiveMap.vue. */
#ls-viewer-wrap {
	position: fixed;
	top: var(--header-height, 50px);
	left: 0;
	right: 0;
	bottom: 0;
	background: var(--color-background-dark, #e5e7eb);
}

.ls-viewer-overlay {
	position: absolute;
	inset: 0;
	z-index: 5;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 16px;
	background: rgba(0, 0, 0, .4);
}

.ls-viewer-card {
	width: 100%;
	max-width: 360px;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 12px;
	padding: 32px;
	box-sizing: border-box;
	text-align: center;
	background: var(--color-main-background, #fff);
	border-radius: var(--border-radius-container-large, 16px);
	box-shadow: 0 8px 32px rgba(0, 0, 0, .18);
}

.ls-viewer-badge {
	width: 64px;
	height: 64px;
	border-radius: 50%;
	display: flex;
	align-items: center;
	justify-content: center;
	background: var(--color-background-dark, #f0f0f0);
	color: var(--color-text-maxcontrast, #767676);
}

.ls-viewer-card h2 {
	margin: 0;
	font-size: 20px;
	font-weight: 700;
	line-height: 1.3;
	color: var(--color-main-text, #222);
}

.ls-viewer-card p {
	margin: 0;
	font-size: 14px;
	line-height: 1.5;
	color: var(--color-text-maxcontrast, #767676);
}
</style>
