<!--
  A guest's live map on the invite page (templates/join.php), shown while they
  share. Same map as for logged-in users (components/LiveMap.vue); the top
  bar adds when sharing stops and a "Stop sharing" button. join.js runs the
  rest of the guest flow (name, duration, GPS) and mounts this while sharing.
-->
<template>
	<LiveMap
		:members="members"
		:title="groupName"
		:status="sharing.status"
		:detail="expiryLabel">
		<template #actions>
			<button type="button" class="ls-map-topbar-action" @click="$emit('stop')">
				Stop sharing
			</button>
		</template>
	</LiveMap>
</template>

<script>
import LiveMap from './components/LiveMap.vue'
import { formatRemaining } from './utils/remaining.js'

const POLL_MS = 10000

function now() {
	return Math.floor(Date.now() / 1000)
}

export default {
	name: 'GuestLive',

	components: { LiveMap },

	props: {
		groupName: { type: String, default: '' },
		positionsUrl: { type: String, required: true },
		// The guest's name: the server marks their own entry as isMe by it.
		name: { type: String, required: true },
		// Reactive state updated by join.js:
		//   status    - shown instead of "2 of 3 sharing" (e.g. waiting for GPS)
		//   expiresAt - Unix time sharing stops, null for "until I stop"
		//   sends     - successful position updates so far
		sharing: { type: Object, required: true },
	},

	// removed: the group owner removed this guest (join.js shows that view)
	emits: ['stop', 'removed'],

	data() {
		return {
			members: [],
			nowTs: now(),
			// The server only shows the others while it lists this guest as
			// sharing: not before their first position arrives, nor after 15
			// minutes without one (e.g. the phone slept).
			refused: false,
		}
	},

	computed: {
		expiryLabel() {
			if (!this.sharing.expiresAt) return null
			const left = formatRemaining(this.sharing.expiresAt - this.nowTs)
			return left ? `stops in ${left}` : null
		},
	},

	watch: {
		// Show yourself (and the others) as soon as the first position is in,
		// or the server takes this guest back after a pause, instead of
		// waiting for the next poll.
		'sharing.sends'(sends) {
			if (sends === 1 || this.refused) this.fetchPositions()
		},
	},

	mounted() {
		this.fetchPositions()
		this.pollTimer = setInterval(this.fetchPositions, POLL_MS)
		this.clockTimer = setInterval(() => { this.nowTs = now() }, 30000)
	},

	beforeUnmount() {
		clearInterval(this.pollTimer)
		clearInterval(this.clockTimer)
	},

	methods: {
		async fetchPositions() {
			const params = new URLSearchParams({ name: this.name })
			try {
				const response = await fetch(this.positionsUrl + '?' + params.toString())
				if (response.status === 403) {
					const body = await response.json().catch(() => ({}))
					// Only after an accepted update: a guest who was removed and
					// starts again is still "removed" until their first update
					// (sent with rejoin) lands.
					if (body.error === 'removed' && this.sharing.sends > 0) {
						this.$emit('removed')
						return
					}
					// not_sharing: don't keep showing the others' last positions
					this.refused = true
					this.members = []
					return
				}
				if (response.ok) {
					this.refused = false
					this.members = await response.json()
				}
			} catch {
				// Keep the last known positions on a transient failure
			}
		},
	},
}
</script>
