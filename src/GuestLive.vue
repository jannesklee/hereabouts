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

	emits: ['stop'],

	data() {
		return {
			members: [],
			nowTs: now(),
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
		// Show yourself on the map as soon as the first position is in,
		// instead of waiting for the next poll.
		'sharing.sends'(sends) {
			if (sends === 1) this.fetchPositions()
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
				if (response.ok) this.members = await response.json()
			} catch {
				// Keep the last known positions on a transient failure
			}
		},
	},
}
</script>
