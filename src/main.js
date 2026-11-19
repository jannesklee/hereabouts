import { createApp } from 'vue'
import { loadState } from '@nextcloud/initial-state'
import App from './App.vue'
import { registerServiceWorker } from './utils/registerSW.js'

document.addEventListener('DOMContentLoaded', () => {
	const app = createApp(App)
	app.mixin({ methods: { t, n } })
	app.mount('#hereabouts-app')

	const swUrl = loadState('hereabouts', 'hereabouts-state').swUrl
	registerServiceWorker(swUrl)
})
