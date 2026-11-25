/* eslint-disable */
import { createApp, reactive } from 'vue'
import GuestLive from './GuestLive.vue'

;(function () {
	'use strict'

	var FAKE_CITIES = [
		{ name: 'Berlin', lat: 52.5200, lon: 13.4050 },
		{ name: 'Tokyo', lat: 35.6762, lon: 139.6503 },
		{ name: 'New York', lat: 40.7128, lon: -74.0060 },
		{ name: 'Sydney', lat: -33.8688, lon: 151.2093 },
		{ name: 'Cape Town', lat: -33.9249, lon: 18.4241 },
		{ name: 'Mumbai', lat: 19.0760, lon: 72.8777 },
		{ name: 'São Paulo', lat: -23.5505, lon: -46.6333 },
		{ name: 'Oslo', lat: 59.9139, lon: 10.7522 },
	]

	document.addEventListener('DOMContentLoaded', function () {
		var container = document.getElementById('hereabouts-join')
		if (!container) return

		if ('serviceWorker' in navigator && container.dataset.swUrl) {
			window.addEventListener('load', function () {
				navigator.serviceWorker.register(container.dataset.swUrl)
					.catch(function (err) { console.warn('SW registration failed:', err) })
			})
		}

		setupAppLink()
		if (container.dataset.userId) {
			setupUserInviteFlow(container)
		} else {
			setupGuestFlow(container)
		}
	})

	// "Open in the Hereabouts app", on Android only. An intent:// link opens
	// the companion app (hereabouts://join?url=<this invite>) if it's
	// installed; otherwise the browser comes back here with ?app=missing and
	// the page says so. Other platforms have no app to open.
	function setupAppLink() {
		var link = document.getElementById('ls-open-app')
		var missing = document.getElementById('ls-app-missing')
		if (!link || !/Android/i.test(navigator.userAgent)) return

		var inviteUrl = window.location.origin + window.location.pathname
		if (new URLSearchParams(window.location.search).get('app') === 'missing') {
			if (missing) missing.hidden = false
			return
		}
		link.href = 'intent://join?url=' + encodeURIComponent(inviteUrl)
			+ '#Intent;scheme=hereabouts;package=com.hereabouts.companion;'
			+ 'S.browser_fallback_url=' + encodeURIComponent(inviteUrl + '?app=missing') + ';end'
		link.hidden = false
	}

	// Logged-in Nextcloud user: joining a group is a single, immediate action.
	// No name to enter (already known), no duration to pick (visibility is a
	// separate, ongoing choice made later from the main app).
	function setupUserInviteFlow(container) {
		var ACCEPT_URL = container.dataset.acceptUrl
		var MAIN_URL = container.dataset.mainUrl || null

		var inviteView = document.getElementById('ls-user-invite-view')
		var joinedView = document.getElementById('ls-user-joined-view')
		var errorView = document.getElementById('ls-user-error-view')
		var joinBtn = document.getElementById('ls-join-group-btn')
		var retryBtn = document.getElementById('ls-user-retry-btn')

		function showView(view) {
			[inviteView, joinedView, errorView].forEach(function (v) {
				if (v) v.style.display = 'none'
			})
			if (view) view.style.display = 'flex'
		}

		function join() {
			if (joinBtn) { joinBtn.disabled = true; joinBtn.textContent = 'Joining…' }
			fetch(ACCEPT_URL, { method: 'POST' })
				.then(function (r) {
					if (!r.ok) throw new Error('accept failed')
					return r.json()
				})
				.then(function () {
					showView(joinedView)
					if (MAIN_URL) {
						setTimeout(function () { window.location.href = MAIN_URL }, 1200)
					}
				})
				.catch(function () {
					showView(errorView)
					if (joinBtn) { joinBtn.disabled = false; joinBtn.textContent = 'Join group' }
				})
		}

		if (joinBtn) joinBtn.addEventListener('click', join)
		if (retryBtn) retryBtn.addEventListener('click', join)
	}

	// Guest: time-boxed sharing under a chosen name, no Nextcloud account.
	// While sharing, the page shows the same live map as logged-in users get
	// (GuestLive.vue -> components/LiveMap.vue).
	function setupGuestFlow(container) {
		var GUEST_UPDATE_URL = container.dataset.guestUpdateUrl
		var GUEST_POSITIONS_URL = container.dataset.guestPositionsUrl
		var GROUP_NAME = container.dataset.groupName || ''

		var formView = document.getElementById('ls-form-view')
		var sharingView = document.getElementById('ls-sharing-view')
		var stoppedView = document.getElementById('ls-stopped-view')
		var errorView = document.getElementById('ls-error-view')
		var removedView = document.getElementById('ls-removed-view')
		var nameInput = document.getElementById('ls-name-input')
		var startBtn = document.getElementById('ls-start-btn')
		var fakeBtn = document.getElementById('ls-fake-btn')
		var durationBtns = Array.prototype.slice.call(document.querySelectorAll('.ls-duration-btn'))
		var restartBtn = document.getElementById('ls-restart-btn')
		var retryBtn = document.getElementById('ls-retry-btn')
		var errorText = document.getElementById('ls-error-text')
		var nameError = document.getElementById('ls-name-error')
		var durationHint = document.getElementById('ls-duration-hint')

		var selectedMinutes = 60
		var watchId = null
		var fakeMode = false
		var expiresAt = null
		var countdownTimer = null
		var fakeCity = null
		var fakeLat, fakeLon
		var currentName = null
		var liveApp = null
		var hintTimer = null
		// Last GPS fix, re-sent every HEARTBEAT_MS: the browser only reports
		// a position when it changes, and the server drops guests it hasn't
		// heard from for 15 minutes (Application::INACTIVE_AFTER).
		var HEARTBEAT_MS = 30000
		var lastFix = null
		var heartbeatTimer = null
		// Sent with the first update after pressing Start, so a guest the owner
		// removed can deliberately join again (PositionController::guestUpdate)
		var rejoinNext = false
		// Read by the live map's top bar (GuestLive.vue)
		var sharing = reactive({ status: null, expiresAt: null, sends: 0 })

		durationBtns.forEach(function (btn) {
			btn.addEventListener('click', function () {
				selectedMinutes = parseInt(btn.dataset.minutes, 10)
				updateDurationButtons()
			})
		})
		updateDurationButtons()
		startHintClock()

		function updateDurationButtons() {
			durationBtns.forEach(function (btn) {
				var active = parseInt(btn.dataset.minutes, 10) === selectedMinutes
				btn.setAttribute('aria-pressed', active ? 'true' : 'false')
			})
			updateDurationHint()
		}

		// "Stops at 15:42" under the duration choices, so the guest knows the
		// actual end time rather than doing the maths.
		function updateDurationHint() {
			if (!durationHint) return
			if (selectedMinutes <= 0) {
				durationHint.textContent = 'Keeps sharing until you tap “Stop sharing”.'
				return
			}
			var end = new Date(Date.now() + selectedMinutes * 60000)
			var time = end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
			var tomorrow = end.toDateString() !== new Date(Date.now()).toDateString()
			durationHint.textContent = 'Stops automatically at ' + time + (tomorrow ? ' tomorrow' : '') + '.'
		}

		// Keep that end time current while the form is open.
		function startHintClock() {
			if (hintTimer === null && durationHint) hintTimer = setInterval(updateDurationHint, 30000)
		}

		function stopHintClock() {
			if (hintTimer !== null) { clearInterval(hintTimer); hintTimer = null }
		}

		function showView(view) {
			[formView, sharingView, stoppedView, errorView, removedView].forEach(function (v) {
				if (v) v.style.display = 'none'
			})
			if (view) view.style.display = 'flex'
			if (view === formView) {
				updateDurationHint()
				startHintClock()
			} else {
				stopHintClock()
			}
		}

		function setNameError(show) {
			if (nameInput) nameInput.setAttribute('aria-invalid', show ? 'true' : 'false')
			if (nameError) nameError.hidden = !show
		}

		function sendPosition(guestUpdateUrl, name, lat, lon, alt, acc) {
			var params = new URLSearchParams({ name: name, lat: lat, lon: lon })
			if (alt !== undefined && alt !== null) params.append('alt', alt)
			if (acc !== undefined && acc !== null) params.append('acc', acc)
			if (selectedMinutes > 0) params.append('duration', selectedMinutes)
			params.append('timestamp', Math.floor(Date.now() / 1000))
			if (rejoinNext) params.append('rejoin', '1')

			fetch(guestUpdateUrl + '?' + params.toString(), { method: 'POST' })
				.then(function (r) {
					// Answer to a request from a sharing session that has ended
					if (name !== currentName) return
					if (r.status === 403) {
						return r.json().catch(function () { return {} }).then(function (body) {
							if (body && body.error === 'removed') {
								wasRemoved()
								return
							}
							throw new Error('HTTP 403')
						})
					}
					if (!r.ok) throw new Error('HTTP ' + r.status)
					rejoinNext = false
					sharing.status = null
					sharing.sends++
				})
				.catch(function () {
					if (name === currentName) sharing.status = 'Failed to send. Retrying…'
				})
		}

		// The owner removed this guest: stop everything. No stop request, the
		// server already knows.
		function wasRemoved() {
			stopSharing(false, true)
			showView(removedView)
		}

		// Sharing ends by itself at the chosen time (the top bar shows how long
		// is left).
		function checkExpiry() {
			if (expiresAt && Math.floor(Date.now() / 1000) >= expiresAt) {
				stopSharing(false)
				showView(stoppedView)
			}
		}

		// The sharing view must be visible before mounting: MapLibre sizes
		// itself to its container.
		function showLiveMap() {
			var el = document.getElementById('ls-guest-live-map')
			if (liveApp || !el || !GUEST_POSITIONS_URL) return
			liveApp = createApp(GuestLive, {
				groupName: GROUP_NAME,
				positionsUrl: GUEST_POSITIONS_URL,
				name: currentName,
				sharing: sharing,
				onStop: function () { stopSharing(true) },
				onRemoved: wasRemoved,
			})
			liveApp.mount(el)
		}

		function hideLiveMap() {
			if (liveApp) {
				liveApp.unmount()
				liveApp = null
			}
		}

		function stopSharing(showStopped, silent) {
			hideLiveMap()
			if (watchId !== null) {
				fakeMode ? clearInterval(watchId) : navigator.geolocation.clearWatch(watchId)
				watchId = null
			}
			fakeMode = false
			fakeCity = null
			lastFix = null
			if (heartbeatTimer !== null) { clearInterval(heartbeatTimer); heartbeatTimer = null }
			if (countdownTimer !== null) { clearInterval(countdownTimer); countdownTimer = null }
			if (silent) currentName = null
			if (currentName) {
				var params = new URLSearchParams({ name: currentName, stop: '1' })
				fetch(GUEST_UPDATE_URL + '?' + params.toString(), { method: 'POST' })
					.catch(function () { /* best-effort */ })
				currentName = null
			}
			if (showStopped) showView(stoppedView)
		}

		function startSharingWithUrl(guestUpdateUrl, name, useFake) {
			currentName = name
			expiresAt = selectedMinutes > 0
				? Math.floor(Date.now() / 1000) + selectedMinutes * 60
				: null
			sharing.status = useFake ? 'Starting fake location…' : 'Waiting for GPS fix…'
			sharing.expiresAt = expiresAt
			sharing.sends = 0
			rejoinNext = true

			showView(sharingView)
			showLiveMap()

			if (useFake) {
				fakeCity = FAKE_CITIES[Math.floor(Math.random() * FAKE_CITIES.length)]
				fakeLat = fakeCity.lat + (Math.random() - 0.5) * 0.01
				fakeLon = fakeCity.lon + (Math.random() - 0.5) * 0.01
				fakeMode = true
				var sendFake = function () {
					fakeLat += (Math.random() - 0.5) * 0.001
					fakeLon += (Math.random() - 0.5) * 0.001
					sendPosition(guestUpdateUrl, name, fakeLat.toFixed(6), fakeLon.toFixed(6), 50, 10)
				}
				sendFake()
				watchId = setInterval(sendFake, 10000)
			} else {
				watchId = navigator.geolocation.watchPosition(
					function (pos) {
						lastFix = { lat: pos.coords.latitude, lon: pos.coords.longitude, alt: pos.coords.altitude, acc: pos.coords.accuracy }
						sendPosition(guestUpdateUrl, name, lastFix.lat, lastFix.lon, lastFix.alt, lastFix.acc)
					},
					function (err) {
						stopSharing(false)
						if (errorText) errorText.textContent = 'Could not get location: ' + err.message
						showView(errorView)
					},
					{ enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 }
				)
				heartbeatTimer = setInterval(function () {
					if (lastFix) sendPosition(guestUpdateUrl, name, lastFix.lat, lastFix.lon, lastFix.alt, lastFix.acc)
				}, HEARTBEAT_MS)
			}

			if (expiresAt) {
				countdownTimer = setInterval(checkExpiry, 30000)
			}
		}

		function beginSharing(useFake) {
			var name = nameInput ? nameInput.value.trim() : ''
			if (!name) {
				setNameError(true)
				if (nameInput) nameInput.focus()
				return
			}
			setNameError(false)
			startSharingWithUrl(GUEST_UPDATE_URL, name, useFake)
		}

		if (startBtn) startBtn.addEventListener('click', function () { beginSharing(false) })
		if (fakeBtn) fakeBtn.addEventListener('click', function () { beginSharing(true) })
		if (restartBtn) restartBtn.addEventListener('click', function () { showView(formView) })
		if (retryBtn) retryBtn.addEventListener('click', function () { showView(formView) })
		if (nameInput) {
			nameInput.addEventListener('input', function () { if (nameInput.value.trim()) setNameError(false) })
			nameInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') beginSharing(false) })
		}
	}
}())
