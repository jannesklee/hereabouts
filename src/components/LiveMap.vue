<!--
  The live map used by every map page (logged-in groups in App.vue, guests in
  GuestLive.vue), so they look and behave the same: the map fills the space,
  with a floating top bar (live dot, title, "2 of 3 sharing"), map buttons on
  the right, and a strip of member chips at the bottom. Clicking a chip or
  marker follows that person; clicking again frames everyone. Pages add their
  own buttons to the top bar through the "leading" and "actions" slots.
-->
<template>
	<div class="ls-map-wrap">
		<div ref="mapEl" class="ls-map-canvas" />

		<div class="ls-map-topbar" :class="{ 'ls-map-topbar--after-toggle': afterToggle }">
			<slot name="leading" />
			<span
				class="ls-live-dot"
				:class="{ 'ls-live-dot--on': meSharing }"
				role="img"
				:title="meSharing ? 'You are sharing your location here' : 'You are not sharing your location here'"
				:aria-label="meSharing ? 'You are sharing your location here' : 'You are not sharing your location here'" />
			<div class="ls-map-topbar-text">
				<span class="ls-map-title">{{ title }}</span>
				<span class="ls-map-subtitle">{{ subtitle }}</span>
			</div>
			<slot name="actions" />
		</div>

		<!-- Map buttons, above the member chips -->
		<div v-if="positionedMembers.length" class="ls-map-buttons">
			<button
				type="button"
				class="ls-map-btn ls-map-btn--zoom"
				title="Zoom in"
				aria-label="Zoom in"
				@click="zoomIn">
				<PlusIcon :size="20" />
			</button>
			<button
				type="button"
				class="ls-map-btn ls-map-btn--zoom"
				title="Zoom out"
				aria-label="Zoom out"
				@click="zoomOut">
				<MinusIcon :size="20" />
			</button>
			<button
				type="button"
				class="ls-map-btn"
				title="Show everyone"
				aria-label="Show everyone"
				@click="showEveryone">
				<ArrowExpandAllIcon :size="20" />
			</button>
			<button
				v-if="me"
				type="button"
				class="ls-map-btn"
				:class="{ 'ls-map-btn--active': focusedUserId === me.userId }"
				title="Show me"
				aria-label="Show me"
				@click="toggleFocus(me.userId)">
				<CrosshairsGpsIcon :size="20" />
			</button>
		</div>

		<span class="ls-map-attribution">
			© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors
		</span>

		<!-- Member chips: click to follow someone, click again for everyone -->
		<div v-if="sortedMembers.length" class="ls-map-chips">
			<button
				v-for="member in sortedMembers"
				:key="member.userId"
				type="button"
				class="ls-chip"
				:class="{ 'ls-chip--selected': member.userId === focusedUserId }"
				:disabled="!member.hasPosition"
				:title="member.hasPosition ? 'Show ' + member.displayName + ' on the map' : member.displayName + ' is not sharing'"
				@click="toggleFocus(member.userId)">
				<img
					v-if="member.avatarUrl"
					class="ls-chip-avatar"
					:class="{ 'ls-chip-avatar--idle': !member.hasPosition }"
					:src="member.avatarUrl"
					alt="">
				<span
					v-else
					class="ls-chip-avatar ls-chip-avatar--initial"
					:class="{ 'ls-chip-avatar--idle': !member.hasPosition }">
					{{ member.displayName.charAt(0).toUpperCase() }}
				</span>
				<span class="ls-chip-text">
					<span class="ls-chip-name">{{ member.isMe ? 'You' : member.displayName.split(' ')[0] }}</span>
					<span class="ls-chip-time">{{ lastSeenLabel(member) }}</span>
				</span>
			</button>
		</div>
	</div>
</template>

<script>
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import ArrowExpandAllIcon from 'vue-material-design-icons/ArrowExpandAll.vue'
import CrosshairsGpsIcon from 'vue-material-design-icons/CrosshairsGps.vue'
import MinusIcon from 'vue-material-design-icons/Minus.vue'
import PlusIcon from 'vue-material-design-icons/Plus.vue'
import { isStale } from '../utils/stale.js'

// Raw OSM tiles, no API key or third-party service. OSM's tile policy requires
// visible attribution, shown as an overlay above the member chips.
const MAP_STYLE = {
	version: 8,
	sources: {
		osm: {
			type: 'raster',
			tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
			tileSize: 256,
			attribution: '© OpenStreetMap contributors',
		},
	},
	layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
}

// Room taken by the overlays (top bar, member chips, map buttons), so fitted
// or followed markers don't end up underneath them.
const MAP_PADDING = { top: 80, bottom: 96, left: 32, right: 72 }

function now() {
	return Math.floor(Date.now() / 1000)
}

export default {
	name: 'LiveMap',

	components: {
		ArrowExpandAllIcon,
		CrosshairsGpsIcon,
		MinusIcon,
		PlusIcon,
	},

	props: {
		// Positions API entries (see CLAUDE.md), including people without a
		// position - they get a greyed-out chip.
		members: { type: Array, required: true },
		title: { type: String, default: '' },
		// Shown instead of the "2 of 3 sharing" summary, e.g. "Waiting for GPS fix…"
		status: { type: String, default: null },
		// Shown after the summary, e.g. "stops in 55 min"
		detail: { type: String, default: null },
		// Changing this (e.g. opening another group) drops the focus and frames
		// everyone again.
		fitKey: { type: [String, Number], default: null },
		// Leave room for Nextcloud's sidebar toggle in the top-left corner.
		afterToggle: { type: Boolean, default: false },
		// userId -> [{ id, name }]: groups listed in a person's popup, each
		// emitting open-group when clicked.
		memberGroups: { type: Object, default: () => ({}) },
	},

	emits: ['open-group'],

	data() {
		return {
			// Set by clicking a chip or marker: flies to them and keeps
			// following them across updates until toggled off.
			focusedUserId: null,
			nowTs: now(),
		}
	},

	computed: {
		positionedMembers() {
			return this.members.filter((m) => m.hasPosition && m.lat !== null && m.lon !== null)
		},

		me() {
			return this.positionedMembers.find((m) => m.isMe) || null
		},

		meSharing() {
			return this.me !== null && !isStale(this.me.updatedAt, this.nowTs)
		},

		// You first, then people who are sharing, then the rest.
		sortedMembers() {
			return [...this.members].sort((a, b) =>
				Number(b.isMe) - Number(a.isMe)
				|| Number(b.hasPosition) - Number(a.hasPosition)
				|| a.displayName.localeCompare(b.displayName))
		},

		subtitle() {
			const sharing = this.positionedMembers.length
			let summary
			if (this.members.length === 0) summary = 'No one here yet'
			else if (sharing === 0) summary = 'Nobody sharing right now'
			else summary = `${sharing} of ${this.members.length} sharing`
			return [this.status || summary, this.detail].filter(Boolean).join(' · ')
		},
	},

	watch: {
		members() {
			this.updateMarkers()
		},

		fitKey() {
			this.focusedUserId = null
			this.updateMarkers()
			this.fitEveryone(true)
		},
	},

	created() {
		// Not reactive on purpose: MapLibre objects don't belong in Vue proxies.
		this.map = null
		this.markers = {}
		// The map frames everyone once when positions first arrive; after that
		// it only moves when asked (or to follow focusedUserId).
		this.didInitialFit = false
		this.clockTimer = null
	},

	mounted() {
		this.map = new maplibregl.Map({
			container: this.$refs.mapEl,
			style: MAP_STYLE,
			center: [0, 20],
			zoom: 2,
			attributionControl: false,
		})
		this.updateMarkers()
		// Keeps "5 min ago" and the greyed-out stale markers current between updates
		this.clockTimer = setInterval(() => {
			this.nowTs = now()
			this.refreshMarkerClasses()
		}, 30000)
	},

	beforeUnmount() {
		clearInterval(this.clockTimer)
		Object.values(this.markers).forEach((m) => m.remove())
		this.markers = {}
		if (this.map) this.map.remove()
		this.map = null
	},

	methods: {
		updateMarkers() {
			if (!this.map) return
			this.nowTs = now()
			const seen = new Set()

			for (const member of this.positionedMembers) {
				const userId = member.userId
				seen.add(userId)
				const marker = this.markers[userId]
				if (marker) {
					marker.setLngLat([member.lon, member.lat])
					marker.getPopup()?.setDOMContent(this.buildPopupContent(member))
				} else {
					const el = this.createMarkerEl(member)
					el.addEventListener('click', () => this.toggleFocus(userId))
					this.markers[userId] = new maplibregl.Marker({ element: el })
						.setLngLat([member.lon, member.lat])
						.setPopup(new maplibregl.Popup({ offset: 28, maxWidth: 'none' })
							.setDOMContent(this.buildPopupContent(member)))
						.addTo(this.map)
				}
			}

			for (const userId of Object.keys(this.markers)) {
				if (!seen.has(userId)) {
					this.markers[userId].remove()
					delete this.markers[userId]
				}
			}

			if (this.focusedUserId && !seen.has(this.focusedUserId)) {
				this.focusedUserId = null
			}
			this.refreshMarkerClasses()

			if (!this.didInitialFit && seen.size > 0) {
				this.didInitialFit = true
				this.fitEveryone(false)
			} else {
				this.followFocused()
			}
		},

		refreshMarkerClasses() {
			for (const member of this.positionedMembers) {
				const marker = this.markers[member.userId]
				if (!marker) continue
				const el = marker.getElement()
				el.classList.toggle('ls-marker--stale', isStale(member.updatedAt, this.nowTs))
				el.classList.toggle('ls-marker--focused', member.userId === this.focusedUserId)
			}
		},

		fitEveryone(animate = true) {
			const positioned = this.positionedMembers
			if (!this.map || positioned.length === 0) return
			const bounds = new maplibregl.LngLatBounds()
			positioned.forEach((m) => bounds.extend([m.lon, m.lat]))
			this.map.fitBounds(bounds, {
				padding: MAP_PADDING,
				maxZoom: 15,
				duration: animate ? 800 : 0,
			})
		},

		showEveryone() {
			this.focusedUserId = null
			this.refreshMarkerClasses()
			this.fitEveryone(true)
		},

		// Ignored for people without a position - there's nowhere to go.
		toggleFocus(userId) {
			const member = this.positionedMembers.find((m) => m.userId === userId)
			if (!member || !this.map) return
			if (this.focusedUserId === userId) {
				this.showEveryone()
				return
			}
			this.focusedUserId = userId
			this.refreshMarkerClasses()
			this.map.flyTo({
				center: [member.lon, member.lat],
				zoom: Math.max(this.map.getZoom(), 15),
				padding: MAP_PADDING,
			})
		},

		// Keep the followed person centred as their position updates.
		followFocused() {
			if (!this.focusedUserId || !this.map) return
			const focused = this.positionedMembers.find((m) => m.userId === this.focusedUserId)
			if (focused) {
				this.map.easeTo({ center: [focused.lon, focused.lat], padding: MAP_PADDING, duration: 600 })
			}
		},

		zoomIn() {
			this.map?.zoomIn()
		},

		zoomOut() {
			this.map?.zoomOut()
		},

		lastSeenLabel(member) {
			if (!member.hasPosition) return 'Not sharing'
			if (!member.updatedAt) return ''
			const age = this.nowTs - member.updatedAt
			if (age < 60) return 'Just now'
			if (age < 3600) return `${Math.floor(age / 60)} min ago`
			return `${Math.floor(age / 3600)}h ago`
		},

		createMarkerEl(member) {
			const el = document.createElement('div')
			el.className = 'ls-marker' + (member.isMe ? ' ls-marker--me' : '')
			if (member.avatarUrl) {
				const img = document.createElement('img')
				img.src = member.avatarUrl
				img.alt = member.displayName
				el.appendChild(img)
			} else {
				el.textContent = member.displayName.charAt(0).toUpperCase()
			}
			return el
		},

		// Built as real DOM nodes (not an HTML string) so the group chips can
		// carry click listeners. Rebuilt on every update to keep the time,
		// accuracy and group list current.
		buildPopupContent(member) {
			const wrap = document.createElement('div')
			wrap.className = 'ls-popup'

			const row = document.createElement('div')
			row.className = 'ls-popup-row'

			if (member.avatarUrl) {
				const img = document.createElement('img')
				img.className = 'ls-popup-avatar'
				img.src = member.avatarUrl
				img.alt = member.displayName
				row.appendChild(img)
			} else {
				const initial = document.createElement('span')
				initial.className = 'ls-popup-avatar ls-popup-avatar--initial'
				initial.textContent = member.displayName.charAt(0).toUpperCase()
				row.appendChild(initial)
			}

			const info = document.createElement('div')
			info.className = 'ls-popup-info'

			const name = document.createElement('span')
			name.className = 'ls-popup-name'
			name.textContent = member.displayName + (member.isMe ? ' (you)' : '')
			info.appendChild(name)

			if (member.updatedAt) {
				const updated = document.createElement('span')
				updated.className = 'ls-popup-meta'
				updated.textContent = `Updated ${new Date(member.updatedAt * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
				info.appendChild(updated)
			}
			if (member.acc) {
				const acc = document.createElement('span')
				acc.className = 'ls-popup-meta'
				acc.textContent = `±${Math.round(member.acc)} m`
				info.appendChild(acc)
			}

			row.appendChild(info)
			wrap.appendChild(row)

			const groups = this.memberGroups[member.userId] ?? []
			if (groups.length > 0) {
				const groupRow = document.createElement('div')
				groupRow.className = 'ls-popup-groups'
				groups.forEach((g) => {
					const chip = document.createElement('button')
					chip.type = 'button'
					chip.className = 'ls-popup-group-chip'
					chip.textContent = g.name
					chip.addEventListener('click', (event) => {
						// Don't let the click reach the marker (toggles focus)
						event.stopPropagation()
						this.markers[member.userId]?.getPopup()?.remove()
						this.$emit('open-group', g.id)
					})
					groupRow.appendChild(chip)
				})
				wrap.appendChild(groupRow)
			}

			return wrap
		},
	},
}
</script>

<style>
/* Not scoped: markers and popups are plain DOM nodes created by MapLibre. */
.ls-map-wrap {
	position: relative;
	width: 100%;
	height: 100%;
	overflow: hidden;
}

.ls-map-canvas {
	position: absolute;
	inset: 0;
}

.ls-map-topbar,
.ls-map-btn,
.ls-map-chips {
	background: var(--color-main-background, #fff);
	box-shadow: 0 2px 8px var(--color-box-shadow, rgba(0, 0, 0, .25));
}

.ls-map-topbar {
	position: absolute;
	top: 8px;
	left: 12px;
	right: 12px;
	max-width: 520px;
	min-height: 52px;
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 4px;
	border-radius: var(--border-radius-pill, 26px);
	box-sizing: border-box;
	z-index: 2;
}

/* Nextcloud's sidebar toggle sits in the content's top-left corner */
.ls-map-topbar--after-toggle {
	left: calc(var(--app-navigation-padding, 8px) * 2 + var(--default-clickable-area, 34px));
}

.ls-live-dot {
	position: relative;
	width: 10px;
	height: 10px;
	flex-shrink: 0;
	margin: 0 6px 0 10px;
	border-radius: 50%;
	background: #c8c8c8;
}

.ls-live-dot--on {
	background: #46ba61;
}

.ls-live-dot--on::after {
	content: '';
	position: absolute;
	inset: 0;
	border-radius: 50%;
	background: #46ba61;
	animation: ls-live-pulse 2s ease-out infinite;
}

@keyframes ls-live-pulse {
	0% { transform: scale(1); opacity: .6; }
	100% { transform: scale(3); opacity: 0; }
}

.ls-map-topbar-text {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	text-align: left;
	line-height: 1.25;
}

.ls-map-title {
	font-weight: 600;
	font-size: 15px;
	color: var(--color-main-text, #222);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.ls-map-subtitle {
	font-size: 12px;
	color: var(--color-text-maxcontrast, #767676);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

/* A text button in the top bar, e.g. the guest's "Stop sharing" */
.ls-map-topbar-action {
	flex-shrink: 0;
	margin: 0 4px 0 0;
	padding: 8px 14px;
	min-height: 0;
	border: none;
	border-radius: var(--border-radius-pill, 20px);
	background: var(--color-background-dark, #f0f0f0);
	color: var(--color-main-text, #222);
	font-size: 13px;
	font-weight: 600;
	cursor: pointer;
}

.ls-map-topbar-action:hover {
	background: var(--color-background-darker, #e5e7eb);
}

.ls-map-buttons {
	position: absolute;
	right: 12px;
	bottom: 96px;
	display: flex;
	flex-direction: column;
	gap: 8px;
	z-index: 2;
}

.ls-map-btn {
	width: 44px;
	height: 44px;
	min-height: 44px;
	margin: 0;
	padding: 0;
	border: none;
	border-radius: 50%;
	display: flex;
	align-items: center;
	justify-content: center;
	color: var(--color-main-text, #222);
	cursor: pointer;
}

.ls-map-btn:hover {
	background: var(--color-background-hover, #f5f5f5);
}

.ls-map-btn--active {
	color: var(--color-primary-element, #0082c9);
}

/* Touch screens zoom with pinch / double tap */
@media (pointer: coarse) {
	.ls-map-btn--zoom {
		display: none;
	}
}

.ls-map-attribution {
	position: absolute;
	right: 12px;
	bottom: 80px;
	z-index: 1;
	font-size: 10px;
	padding: 0 4px;
	border-radius: 3px;
	background: rgba(255, 255, 255, .7);
	color: #333;
}

.ls-map-attribution a {
	color: inherit;
	text-decoration: underline;
}

.ls-map-chips {
	position: absolute;
	left: 12px;
	bottom: 12px;
	width: fit-content;
	max-width: calc(100% - 24px);
	display: flex;
	gap: 8px;
	padding: 8px;
	overflow-x: auto;
	border-radius: var(--border-radius-container-large, 16px);
	box-sizing: border-box;
	z-index: 2;
}

.ls-chip {
	flex-shrink: 0;
	display: flex;
	align-items: center;
	gap: 8px;
	margin: 0;
	min-height: 0;
	padding: 4px 14px 4px 4px;
	border: 2px solid transparent;
	border-radius: var(--border-radius-pill, 24px);
	background: var(--color-background-dark, #f3f4f6);
	color: var(--color-main-text, #222);
	font: inherit;
	cursor: pointer;
	max-width: 200px;
}

.ls-chip:hover:not(:disabled) {
	background: var(--color-background-darker, #e5e7eb);
}

/* Nextcloud fades disabled buttons; the greyed-out avatar says enough */
.ls-chip:disabled {
	cursor: default;
	opacity: 1;
}

.ls-chip--selected {
	border-color: #f59e0b;
	background: var(--color-primary-element-light, #e6f3fa);
}

.ls-chip-avatar {
	width: 36px;
	height: 36px;
	border-radius: 50%;
	flex-shrink: 0;
	object-fit: cover;
}

.ls-chip-avatar--initial {
	display: flex;
	align-items: center;
	justify-content: center;
	background: var(--color-primary, #0082c9);
	color: #fff;
	font-weight: 600;
	font-size: 15px;
}

.ls-chip-avatar--idle {
	filter: grayscale(100%);
	opacity: .5;
}

.ls-chip-text {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	min-width: 0;
	line-height: 1.2;
}

.ls-chip-name {
	font-weight: 600;
	font-size: 14px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	max-width: 140px;
}

.ls-chip-time {
	font-size: 11px;
	color: var(--color-text-maxcontrast, #767676);
}

/* MapLibre popup reset: Nextcloud's global styles can collapse the content */
.maplibregl-popup-content {
	padding: 10px 14px !important;
	border-radius: 8px !important;
	box-shadow: 0 2px 8px rgba(0, 0, 0, .2) !important;
	font-size: inherit !important;
	line-height: inherit !important;
}

.ls-popup-row {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 4px 2px;
}

.ls-popup-avatar {
	width: 32px;
	height: 32px;
	border-radius: 50%;
	object-fit: cover;
	flex-shrink: 0;
}

.ls-popup-avatar--initial {
	background: var(--color-primary, #0082c9);
	color: #fff;
	font-size: 14px;
	font-weight: 600;
	display: flex;
	align-items: center;
	justify-content: center;
}

.ls-popup-info {
	display: flex;
	flex-direction: column;
	gap: 2px;
	min-width: 0;
}

.ls-popup-name {
	font-size: 13px;
	font-weight: 600;
	color: var(--color-main-text, #222);
	white-space: nowrap;
}

.ls-popup-meta {
	font-size: 11px;
	color: var(--color-text-maxcontrast, #767676);
}

.ls-popup-groups {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
	padding: 0 2px 2px;
	max-width: 220px;
}

.ls-popup-group-chip {
	font-size: 11px;
	font-weight: 600;
	padding: 3px 8px;
	border: none;
	border-radius: var(--border-radius-pill, 100px);
	background: var(--color-primary-light, #e3f0f9);
	color: var(--color-primary, #0082c9);
	cursor: pointer;
}

.ls-popup-group-chip:hover {
	background: var(--color-primary, #0082c9);
	color: var(--color-primary-text, #fff);
}

/* Map markers */
.ls-marker {
	width: 36px;
	height: 36px;
	border-radius: 50%;
	border: 2px solid #fff;
	box-shadow: 0 1px 4px rgba(0, 0, 0, .4);
	background: var(--color-primary, #0082c9);
	color: #fff;
	font-size: 15px;
	font-weight: 600;
	display: flex;
	align-items: center;
	justify-content: center;
	cursor: pointer;
	overflow: hidden;
}

.ls-marker--me {
	border-color: var(--color-primary, #0082c9);
	border-width: 3px;
}

.ls-marker--stale {
	filter: grayscale(100%);
	opacity: .5;
	transition: filter .4s, opacity .4s;
}

.ls-marker--focused {
	/* On top when people are in the same place (e.g. a family at home) */
	z-index: 2;
	border-color: #f59e0b;
	border-width: 3px;
	width: 42px;
	height: 42px;
}

.ls-marker img {
	width: 100%;
	height: 100%;
	object-fit: cover;
}
</style>
