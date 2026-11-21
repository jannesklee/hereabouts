<?php
$appId = OCA\Hereabouts\AppInfo\Application::APP_ID;
\OCP\Util::addScript($appId, $appId . '-join');
\OCP\Util::addStyle($appId, $appId . '-join');

$guestUpdateUrl = $_['guest_update_url'];
$guestPositionsUrl = $_['guest_positions_url'];
$acceptUrl = $_['accept_url'];
$ownerDisplayName = $_['owner_display_name'];
$groupName = $_['group_name'];
$userId = $_['user_id'] ?? null;
$userDisplayName = $_['user_display_name'] ?? null;
$mainUrl = $_['main_url'] ?? null;
$debug = $_['debug'] ?? false;
$swUrl = $_['sw_url'] ?? '';

// Material Design Icons (same set as the Vue app's vue-material-design-icons)
$icon = static function (string $path): string {
	return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="' . $path . '"/></svg>';
};
$iconMarker = $icon('M12,11.5A2.5,2.5 0 0,1 9.5,9A2.5,2.5 0 0,1 12,6.5A2.5,2.5 0 0,1 14.5,9A2.5,2.5 0 0,1 12,11.5M12,2A7,7 0 0,0 5,9C5,14.25 12,22 12,22C12,22 19,14.25 19,9A7,7 0 0,0 12,2Z');
$iconMarkerOff = $icon('M16.37,16.1L11.75,11.47L11.64,11.36L3.27,3L2,4.27L5.18,7.45C5.06,7.95 5,8.46 5,9C5,14.25 12,22 12,22C12,22 13.67,20.15 15.37,17.65L18.73,21L20,19.72M12,6.5A2.5,2.5 0 0,1 14.5,9C14.5,9.73 14.17,10.39 13.67,10.85L17.3,14.5C18.28,12.62 19,10.68 19,9A7,7 0 0,0 12,2C10,2 8.24,2.82 6.96,4.14L10.15,7.33C10.61,6.82 11.26,6.5 12,6.5Z');
$iconGroup = $icon('M12,5.5A3.5,3.5 0 0,1 15.5,9A3.5,3.5 0 0,1 12,12.5A3.5,3.5 0 0,1 8.5,9A3.5,3.5 0 0,1 12,5.5M5,8C5.56,8 6.08,8.15 6.53,8.42C6.38,9.85 6.8,11.27 7.66,12.38C7.16,13.34 6.16,14 5,14A3,3 0 0,1 2,11A3,3 0 0,1 5,8M19,8A3,3 0 0,1 22,11A3,3 0 0,1 19,14C17.84,14 16.84,13.34 16.34,12.38C17.2,11.27 17.62,9.85 17.47,8.42C17.92,8.15 18.44,8 19,8M5.5,18.25C5.5,16.18 8.41,14.5 12,14.5C15.59,14.5 18.5,16.18 18.5,18.25V20H5.5V18.25M0,20V18.5C0,17.11 1.89,15.94 4.45,15.6C3.86,16.28 3.5,17.22 3.5,18.25V20H0M24,20H20.5V18.25C20.5,17.22 20.14,16.28 19.55,15.6C22.11,15.94 24,17.11 24,18.5V20Z');
$iconCheck = $icon('M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z');
$iconAlert = $icon('M11,15H13V17H11V15M11,7H13V13H11V7M12,2C6.47,2 2,6.5 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20Z');
$iconRemoved = $icon('M1.46,8.88L2.88,7.46L5,9.59L7.12,7.46L8.54,8.88L6.41,11L8.54,13.12L7.12,14.54L5,12.41L2.88,14.54L1.46,13.12L3.59,11L1.46,8.88M15,4A4,4 0 0,1 19,8A4,4 0 0,1 15,12A4,4 0 0,1 11,8A4,4 0 0,1 15,4M15,5.9A2.1,2.1 0 0,0 12.9,8A2.1,2.1 0 0,0 15,10.1C16.16,10.1 17.1,9.16 17.1,8C17.1,6.84 16.16,5.9 15,5.9M15,13C17.67,13 23,14.33 23,17V20H7V17C7,14.33 12.33,13 15,13M15,14.9C12,14.9 8.9,16.36 8.9,17V18.1H21.1V17C21.1,16.36 17.97,14.9 15,14.9Z');
$iconShield = $icon('M21,11C21,16.55 17.16,21.74 12,23C6.84,21.74 3,16.55 3,11V5L12,1L21,5V11M12,21C15.75,20 19,15.54 19,11.22V6.3L12,3.18L5,6.3V11.22C5,15.54 8.25,20 12,21M14.8,11V9.5C14.8,8.1 13.4,7 12,7C10.6,7 9.2,8.1 9.2,9.5V11C8.6,11 8,11.6 8,12.2V15.7C8,16.4 8.6,17 9.2,17H14.7C15.4,17 16,16.4 16,15.8V12.3C16,11.6 15.4,11 14.8,11M13.5,11H10.5V9.5C10.5,8.7 11.2,8.2 12,8.2C12.8,8.2 13.5,8.7 13.5,9.5V11Z');
?>
<div id="hereabouts-join"
	data-sw-url="<?= htmlspecialchars($swUrl, ENT_QUOTES) ?>"
	data-guest-update-url="<?= htmlspecialchars($guestUpdateUrl, ENT_QUOTES) ?>"
	data-guest-positions-url="<?= htmlspecialchars($guestPositionsUrl, ENT_QUOTES) ?>"
	data-accept-url="<?= htmlspecialchars($acceptUrl, ENT_QUOTES) ?>"
	data-group-name="<?= htmlspecialchars($groupName, ENT_QUOTES) ?>"
	<?php if ($userId !== null): ?>
	data-user-id="<?= htmlspecialchars($userId, ENT_QUOTES) ?>"
	data-user-display-name="<?= htmlspecialchars($userDisplayName ?? $userId, ENT_QUOTES) ?>"
	<?php endif; ?>
	<?php if ($mainUrl !== null): ?>
	data-main-url="<?= htmlspecialchars($mainUrl, ENT_QUOTES) ?>"
	<?php endif; ?>>

	<?php if ($userId !== null): ?>
	<!-- Logged-in Nextcloud user: joining a persistent group is a one-step
	     action, distinct from the guest's time-boxed sharing flow below. -->
	<div class="ls-join-card" id="ls-user-invite-view">
		<div class="ls-join-badge"><?php print_unescaped($iconGroup); ?></div>
		<div class="ls-join-heading">
			<p class="ls-join-eyebrow"><?= p($ownerDisplayName) ?> invited you to join</p>
			<h1><?= p($groupName) ?></h1>
		</div>
		<p class="ls-join-desc">You'll see everyone in this group on your map. Whether you share your own location is a separate choice you can make at any time.</p>
		<button id="ls-join-group-btn" type="button" class="ls-btn ls-btn--primary">Join group</button>
	</div>

	<div class="ls-join-card" id="ls-user-joined-view" style="display:none">
		<div class="ls-join-badge ls-join-badge--success"><?php print_unescaped($iconCheck); ?></div>
		<div class="ls-join-heading">
			<p class="ls-join-eyebrow">You joined</p>
			<h1><?= p($groupName) ?></h1>
		</div>
		<?php if ($mainUrl !== null): ?>
		<a href="<?= htmlspecialchars($mainUrl, ENT_QUOTES) ?>" class="ls-btn ls-btn--primary">Open Hereabouts</a>
		<?php endif; ?>
	</div>

	<div class="ls-join-card" id="ls-user-error-view" style="display:none">
		<div class="ls-join-badge ls-join-badge--error"><?php print_unescaped($iconAlert); ?></div>
		<div class="ls-join-heading">
			<h1>Something went wrong</h1>
		</div>
		<p class="ls-join-desc">Couldn't join the group. Check your connection and try again.</p>
		<button id="ls-user-retry-btn" type="button" class="ls-btn ls-btn--primary">Try again</button>
	</div>

	<?php else: ?>
	<!-- Guest: time-boxed sharing, no Nextcloud account -->
	<div class="ls-join-card" id="ls-form-view">
		<div class="ls-join-badge"><?php print_unescaped($iconMarker); ?></div>
		<div class="ls-join-heading">
			<p class="ls-join-eyebrow"><?= p($ownerDisplayName) ?> invited you to share locations in</p>
			<h1><?= p($groupName) ?></h1>
		</div>

		<div class="ls-field">
			<label class="ls-field-label" for="ls-name-input">Your name</label>
			<input type="text"
				id="ls-name-input"
				class="ls-input"
				placeholder="e.g. Alex"
				maxlength="48"
				autocomplete="name"
				autocorrect="off"
				autocapitalize="words"
				aria-describedby="ls-name-error" />
			<p class="ls-field-error" id="ls-name-error" hidden>Please enter a name, so the others know who you are.</p>
		</div>

		<div class="ls-field">
			<p class="ls-field-label" id="ls-duration-label">Share for</p>
			<div class="ls-choices" role="group" aria-labelledby="ls-duration-label" aria-describedby="ls-duration-hint">
				<button type="button" class="ls-choice ls-duration-btn" data-minutes="15">15 min</button>
				<button type="button" class="ls-choice ls-duration-btn" data-minutes="60">1 hour</button>
				<button type="button" class="ls-choice ls-duration-btn" data-minutes="240">4 hours</button>
				<button type="button" class="ls-choice ls-duration-btn" data-minutes="0">Until I stop</button>
			</div>
			<p class="ls-field-hint" id="ls-duration-hint"></p>
		</div>

		<div class="ls-join-actions">
			<button id="ls-start-btn" type="button" class="ls-btn ls-btn--primary">
				<?php print_unescaped($iconMarker); ?>
				Start sharing
			</button>
			<?php if ($debug): ?>
			<button id="ls-fake-btn" type="button" class="ls-btn ls-btn--secondary">Use fake location (testing)</button>
			<?php endif; ?>
		</div>

		<div class="ls-join-note">
			<?php print_unescaped($iconShield); ?>
			<p>Only people in this group can see where you are. Your browser will ask for permission first; keep this page open while you share.</p>
		</div>
	</div>

	<!-- While sharing: the same live map logged-in users get (GuestLive.vue,
	     mounted by join.js) -->
	<div class="ls-guest-live" id="ls-sharing-view" style="display:none">
		<div id="ls-guest-live-map"></div>
	</div>

	<div class="ls-join-card" id="ls-stopped-view" style="display:none">
		<div class="ls-join-badge ls-join-badge--muted"><?php print_unescaped($iconMarkerOff); ?></div>
		<div class="ls-join-heading">
			<h1>Sharing stopped</h1>
		</div>
		<p class="ls-join-desc">Your location is no longer shared with <?= p($groupName) ?>.</p>
		<button id="ls-restart-btn" type="button" class="ls-btn ls-btn--primary">Share again</button>
	</div>

	<div class="ls-join-card" id="ls-error-view" style="display:none">
		<div class="ls-join-badge ls-join-badge--error"><?php print_unescaped($iconAlert); ?></div>
		<div class="ls-join-heading">
			<h1>Something went wrong</h1>
		</div>
		<p class="ls-join-desc" id="ls-error-text"></p>
		<button id="ls-retry-btn" type="button" class="ls-btn ls-btn--primary">Try again</button>
	</div>

	<!-- The owner removed this guest (PositionController::guestUpdate answers
	     403 "removed"). No "share again" button on purpose. -->
	<div class="ls-join-card" id="ls-removed-view" style="display:none">
		<div class="ls-join-badge ls-join-badge--muted"><?php print_unescaped($iconRemoved); ?></div>
		<div class="ls-join-heading">
			<h1>You were removed</h1>
		</div>
		<p class="ls-join-desc"><?= p($ownerDisplayName) ?> removed you from <?= p($groupName) ?>. Your location is no longer shared.</p>
	</div>
	<?php endif; ?>
</div>

<style>
/* Everything is scoped under #hereabouts-join: Nextcloud's core CSS styles
   every bare <input> and <button> (fixed 34px height, margins, hover
   colours), and an ID selector is needed to win over those rules. */

/* Fixed below Nextcloud's header, like the live map (.ls-guest-live) and the
   share-link viewer: the public page's #content box is a flex row that would
   shrink the card to its content. Transparent, so the theme background
   behind the header continues behind the card. */
#hereabouts-join {
	position: fixed;
	top: var(--header-height, 50px);
	left: 0;
	right: 0;
	bottom: 0;
	overflow-y: auto;
	display: flex;
	flex-direction: column;
	align-items: center;
	padding: 24px 16px calc(24px + env(safe-area-inset-bottom, 0px));
	box-sizing: border-box;
}

#hereabouts-join .ls-join-card {
	/* auto margins centre the card vertically but let it scroll when taller
	   than the screen (justify-content: center would cut off the top) */
	margin: auto 0;
	width: 100%;
	max-width: 420px;
	display: flex;
	flex-direction: column;
	gap: 20px;
	padding: 32px;
	box-sizing: border-box;
	color: var(--color-main-text, #222);
	background: var(--color-main-background, #fff);
	border-radius: var(--border-radius-container-large, 16px);
	box-shadow: 0 8px 32px rgba(0, 0, 0, .18);
}
#hereabouts-join .ls-input,
#hereabouts-join .ls-choice,
#hereabouts-join .ls-btn { box-sizing: border-box; font-family: inherit; }

/* ── Header: icon, who invited you, group name ── */
#hereabouts-join .ls-join-badge {
	align-self: center;
	width: 64px;
	height: 64px;
	border-radius: 50%;
	display: flex;
	align-items: center;
	justify-content: center;
	background: var(--color-primary-element-light, #e5f2fa);
	color: var(--color-primary-element, #0082c9);
}
#hereabouts-join .ls-join-badge svg { width: 32px; height: 32px; fill: currentColor; }
#hereabouts-join .ls-join-badge--success {
	background: color-mix(in srgb, var(--color-success, #2d7b41) 15%, transparent);
	color: var(--color-success-text, var(--color-success, #2d7b41));
}
#hereabouts-join .ls-join-badge--error {
	background: color-mix(in srgb, var(--color-error, #db0606) 12%, transparent);
	color: var(--color-error-text, var(--color-error, #db0606));
}
#hereabouts-join .ls-join-badge--muted {
	background: var(--color-background-dark, #f0f0f0);
	color: var(--color-text-maxcontrast, #767676);
}

#hereabouts-join .ls-join-heading { display: flex; flex-direction: column; gap: 4px; text-align: center; }
#hereabouts-join .ls-join-eyebrow { margin: 0; font-size: 14px; color: var(--color-text-maxcontrast, #767676); }
#hereabouts-join .ls-join-heading h1 {
	margin: 0;
	font-size: 24px;
	font-weight: 700;
	line-height: 1.3;
	color: var(--color-main-text, #222);
	overflow-wrap: anywhere;
}
#hereabouts-join .ls-join-desc {
	margin: 0;
	font-size: 14px;
	line-height: 1.5;
	text-align: center;
	color: var(--color-text-maxcontrast, #767676);
}

/* ── Form fields ── */
#hereabouts-join .ls-field { display: flex; flex-direction: column; gap: 8px; }
#hereabouts-join .ls-field-label { margin: 0; font-size: 14px; font-weight: 600; color: var(--color-main-text, #222); }
#hereabouts-join .ls-field-hint { margin: 0; font-size: 13px; color: var(--color-text-maxcontrast, #767676); }
#hereabouts-join .ls-field-hint:empty { display: none; }
#hereabouts-join .ls-field-error { margin: 0; font-size: 13px; color: var(--color-error-text, var(--color-error, #db0606)); }
#hereabouts-join .ls-field-error[hidden] { display: none; }

#hereabouts-join .ls-input {
	width: 100%;
	height: 48px;
	margin: 0;
	padding: 0 16px;
	font-size: 16px; /* 16px+ keeps iOS from zooming in on focus */
	color: var(--color-main-text, #222);
	background: var(--color-main-background, #fff);
	border: 2px solid var(--color-border-maxcontrast, #949494);
	border-radius: var(--border-radius-element, 8px);
	outline: none;
	box-shadow: none;
	transition: border-color .15s;
}
#hereabouts-join .ls-input:hover { border-color: var(--color-main-text, #222); }
#hereabouts-join .ls-input:focus,
#hereabouts-join .ls-input:focus-visible { border-color: var(--color-primary-element, #0082c9); box-shadow: none; }
#hereabouts-join .ls-input[aria-invalid="true"] { border-color: var(--color-error, #db0606); }

/* Duration: 2×2 grid of pill chips, like the member chips on the map */
#hereabouts-join .ls-choices { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
#hereabouts-join .ls-choice {
	width: auto;
	min-height: 44px;
	height: auto;
	margin: 0;
	padding: 8px 12px;
	font-size: 14px;
	font-weight: 600;
	color: var(--color-main-text, #222);
	background: var(--color-main-background, #fff);
	border: 1px solid var(--color-border-dark, #dbdbdb);
	border-radius: var(--border-radius-pill, 22px);
	cursor: pointer;
	-webkit-tap-highlight-color: transparent;
	transition: background-color .15s, border-color .15s, color .15s;
}
#hereabouts-join .ls-choice:hover,
#hereabouts-join .ls-choice:focus { background: var(--color-background-hover, #f5f5f5); border-color: var(--color-border-dark, #dbdbdb); }
#hereabouts-join .ls-choice[aria-pressed="true"] {
	color: var(--color-primary-element-light-text, var(--color-primary-element, #0082c9));
	background: var(--color-primary-element-light, #e5f2fa);
	border-color: var(--color-primary-element, #0082c9);
	box-shadow: inset 0 0 0 1px var(--color-primary-element, #0082c9);
}
#hereabouts-join .ls-choice:focus-visible,
#hereabouts-join .ls-btn:focus-visible {
	outline: 2px solid var(--color-main-text, #222);
	outline-offset: 2px;
}

/* ── Buttons ── */
#hereabouts-join .ls-join-actions { display: flex; flex-direction: column; gap: 8px; }

#hereabouts-join .ls-btn {
	width: 100%;
	min-height: 48px;
	height: auto;
	margin: 0;
	padding: 12px 20px;
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 8px;
	font-size: 15px;
	font-weight: 600;
	text-decoration: none;
	border: none;
	border-radius: var(--border-radius-pill, 24px);
	cursor: pointer;
	-webkit-tap-highlight-color: transparent;
	transition: background-color .15s;
}
#hereabouts-join .ls-btn svg { width: 20px; height: 20px; fill: currentColor; flex-shrink: 0; }
#hereabouts-join .ls-btn--primary,
#hereabouts-join .ls-btn--primary:focus {
	color: var(--color-primary-element-text, #fff);
	background: var(--color-primary-element, #0082c9);
}
#hereabouts-join .ls-btn--primary:hover { background: var(--color-primary-element-hover, #0072b0); }
#hereabouts-join .ls-btn--secondary,
#hereabouts-join .ls-btn--secondary:focus {
	color: var(--color-primary-element-light-text, #00679e);
	background: var(--color-primary-element-light, #e5f2fa);
}
#hereabouts-join .ls-btn--secondary:hover { background: var(--color-primary-element-light-hover, #d8ebf6); }
#hereabouts-join .ls-btn:disabled { opacity: .6; cursor: default; }

/* ── Privacy note ── */
#hereabouts-join .ls-join-note {
	display: flex;
	gap: 10px;
	align-items: flex-start;
	padding-top: 16px;
	border-top: 1px solid var(--color-border, #ededed);
	color: var(--color-text-maxcontrast, #767676);
}
#hereabouts-join .ls-join-note svg { width: 18px; height: 18px; fill: currentColor; flex-shrink: 0; margin-top: 1px; }
#hereabouts-join .ls-join-note p { margin: 0; font-size: 13px; line-height: 1.5; }

/* ── While sharing: full-screen live map (styles in components/LiveMap.vue) ── */
#hereabouts-join .ls-guest-live {
	position: fixed;
	top: var(--header-height, 50px);
	left: 0;
	right: 0;
	bottom: 0;
	background: var(--color-background-dark, #e5e7eb);
}

#ls-guest-live-map {
	position: absolute;
	inset: 0;
}

@media (max-width: 480px) {
	#hereabouts-join { padding: 16px 12px calc(16px + env(safe-area-inset-bottom, 0px)); }
	#hereabouts-join .ls-join-card { padding: 24px 20px; gap: 18px; }
	#hereabouts-join .ls-join-heading h1 { font-size: 22px; }
}
</style>
