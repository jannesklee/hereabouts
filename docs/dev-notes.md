# Dev Notes: Known Issues & Fixes

Debugging notes that aren't obvious from the code itself, kept here so they don't have to be re-discovered. Add to this file as new non-obvious issues get root-caused. See `docs/manual-testing.md` for the step-by-step setup and test workflow these notes support.

## `debug=true` silently disables cache-busting on every JS/CSS URL - rebuilds look like they never took effect in the browser

After `npm run build`, a browser that already had a Hereabouts page open (join page, main app, viewer - any of them) can keep showing the pre-build version indefinitely on a normal reload, even though the server is serving the new files correctly (verified independently with `curl`). Root cause: `TemplateLayout::getVersionHashSuffix()` in Nextcloud core returns an **empty string** - no `?v=<hash>` query param at all - whenever `debug=true` (`lib/private/TemplateLayout.php`, checked directly in the container), specifically so Chrome DevTools' workspace source-mapping isn't confused by a changing URL. This dev container has `debug=true` set (per this file's own setup instructions), so it applies here.

Without that suffix, script/style URLs for this app's Vite entry bundles (`js/hereabouts-join.mjs`, `js/hereabouts-main.mjs`, `css/*.css` - the entry points aren't content-hashed, unlike their chunk dependencies, so `Util::addScript()`/`addStyle()` can reference them by stable basename) never change between builds. The server also sends `Cache-Control: max-age=15778463` (~6 months) on them. Combined, a browser that's ever loaded the page before has no reason to even send a conditional request - it just serves its disk cache, silently, on every subsequent normal reload (F5).

Fix for testing: hard-refresh (Ctrl+Shift+R / Cmd+Shift+R), or open DevTools → Network → "Disable cache" while the tab is open, or use a private/incognito window. Not a bug to fix in the app itself - `debug=false` (production) restores the normal per-version cache-busting behavior, so this is purely a local dev-workflow trap. Worth remembering any time a JS/CSS change "doesn't show up" despite a clean rebuild and no errors anywhere in the pipeline.

## Background job registration silently failed on every request, occasionally as a hard 503

`lib/AppInfo/Application.php`'s `register()` called `$context->registerBackgroundJob(CleanupExpiredGuests::class)` — but `IRegistrationContext` in this Nextcloud version (33.0.0.16, and per the API surface checked in `lib/public/AppFramework/Bootstrap/IRegistrationContext.php`) has no `registerBackgroundJob()` method at all. Background jobs in this version are registered **declaratively in `appinfo/info.xml`** instead (confirmed against core's `apps/files/appinfo/info.xml`, which uses a `<background-jobs><job>...</job></background-jobs>` block), not imperatively in the bootstrap class.

Effect: every single request to any hereabouts route threw `Error during app service registration: Call to undefined method ...::registerBackgroundJob()` — logged at error level on every page load (visible via `occ background-job:list` never showing `CleanupExpiredGuests` at all, and via a constant stream of identical entries in `data/nextcloud.log`). Nextcloud's `Coordinator` catches per-app registration errors so most requests still succeeded despite the log spam, but the failure was non-deterministic enough to occasionally surface as a genuine `503` on an otherwise-unrelated request (seen while testing the group-removal feature — the request itself was fine, the concurrent registration crash was not). The practical side effect: `CleanupExpiredGuests` (hourly cleanup of expired guests + share links) **never actually ran**, silently, since the app was first built.

Fix: removed the `registerBackgroundJob()` call from `Application.php` and added
```xml
<background-jobs>
    <job>OCA\Hereabouts\BackgroundJob\CleanupExpiredGuests</job>
</background-jobs>
```
to `appinfo/info.xml`. Verified via `occ app:disable hereabouts && occ app:enable hereabouts && occ maintenance:repair`, then confirming (a) `occ background-job:list | grep Hereabouts` shows the job, and (b) no new `nextcloud.log` entries appear across repeated requests.

If you see `Call to undefined method ...IRegistrationContext@anonymous::registerXxx()` for some *other* registration call in the future, the fix is the same shape: check whether that particular `registerXxx` actually exists on `IRegistrationContext` in the target Nextcloud version before assuming it's the right API — several registration types (background jobs among them) are declared in `info.xml` instead, depending on version.

## Actual Nextcloud theme CSS variable values (for styling standalone public pages like `templates/join.php`)

`grep`-ing static core CSS for `--border-radius`/`--font-size` definitions turns up nothing — they're generated server-side per request, not in a static file. To find real values, fetch the live theming endpoint instead: `curl http://localhost:8080/apps/theming/theme/default.css?plain=1`. On this dev instance (NC 33.0.0.16, default theme) the values that matter for `templates/join.php`/`src/Viewer.vue`-style standalone pages are:

- `--border-radius-large` is an alias for `--border-radius-element`, which is **8px**, not the `12px` fallback `templates/join.php` used to assume before the 2026-09-09 restyle. The fallback only matters if the page renders with no NC theme CSS loaded at all (shouldn't happen for `PublicTemplateResponse` pages), but keep fallbacks honest anyway.
- `--border-radius-container-large` is **16px** — this is what `src/Viewer.vue`'s hardcoded `border-radius: 16px` on `.ls-viewer-overlay-card` actually matches; use the var (with `16px` fallback) instead of hardcoding it in new code.
- `--font-size-small` is **13px**. There's no generic `--font-size-normal`; the app's own convention (see `App.vue`, `Viewer.vue`) is to hardcode body/label text in the 13-15px range in px, not rem — `rem`-based sizing in `join.php` was inconsistent with this and got converted.
- `--clickable-area-large` is **48px**, `--default-clickable-area` (what unstyled `NcButton` uses) is **34px**. A full-width `padding: 13px 16px` at `font-size: 15px` lands close to the 48px target, appropriate for a mobile-first guest CTA even though it's taller than the app's default in-app buttons.
- `--color-box-shadow` is `rgba(77, 77, 77, 0.5)` (no dedicated shadow-strength var) — used at reduced opacity via `box-shadow: 0 1px 10px var(--color-box-shadow, rgba(0,0,0,.1))` for the join-page card lift.

## Guest position updates intermittently 500'd on a guest's first-ever fix (`lib/Db/GuestMapper.php`)

`GuestMapper::upsert()` used the classic check-then-act pattern: `findByGroupAndName()` to look for an existing row, insert if `DoesNotExistException`, otherwise update. When a guest starts sharing for the first time, the browser's `navigator.geolocation.watchPosition` can fire two position callbacks in quick succession (common right after permission is granted — an initial low-accuracy fix immediately followed by a better one), and each one is a separate HTTP request to `PositionController::guestUpdate()`. If both requests' `findByGroupAndName()` calls run before either has inserted, both see no existing row and both call `insert()` — the second hits `oc_hereabouts_guests`' `(group_id, name)` unique constraint and the request 500s, visible in `nextcloud.log` as `SQLSTATE[23000]: Integrity constraint violation: 19 UNIQUE constraint failed: oc_hereabouts_guests.group_id, oc_hereabouts_guests.name`. Found live (not in testing) via a guest named "Jannes" hitting it repeatedly in the log.

Fix: catch `OCP\DB\Exception` around the `insert()` call, check `$e->getReason() === DbException::REASON_UNIQUE_CONSTRAINT_VIOLATION`, and on that specific reason retry as an update (the racing request's insert has landed by the time this one's insert fails, so the retry's `findByGroupAndName()` now succeeds). Re-throw anything else unchanged. Verified by firing 5 concurrent `POST /guest/{token}` requests for a brand-new guest name — all returned `200` after the fix (all 500'd before it).

Reminder while testing PHP changes against the dev container: opcache's `revalidate_freq` is 60s (see above), so a fresh edit can appear not to have taken effect for up to a minute. `docker exec hereabouts-dev apache2ctl graceful` forces an immediate reload instead of waiting.

## `templates/join.php` never loaded its own CSS bundle - `\OCP\Util::addStyle()` was missing

`templates/main.php` and `templates/viewer.php` both call `\OCP\Util::addScript($appId, '...')` *and* `\OCP\Util::addStyle($appId, '...')`. `templates/join.php` only ever called `addScript`. This went unnoticed for a long time because the join page's own visual styling all lives in an inline `<style>` block in the template itself, so nothing *looked* broken - but it meant the Vite-built `css/hereabouts-join.css` (which is just `@import './join-<hash>.chunk.css'` - see `@nextcloud/vite-config`'s "css-entry-points-plugin") was never linked into the page at all, and any real CSS imported from `join.js` silently never took effect.

This surfaced when a MapLibre map was added to the guest join view (2026-09): `join.js` gained `import 'maplibre-gl/dist/maplibre-gl.css'`, and the symptom was "the map tiles show up but the person markers don't" - the base map still renders because MapLibre positions the canvas via inline styles, but marker elements depend on `.maplibregl-marker { position: absolute; ... }` from that external stylesheet, which was never loaded.

General lesson: whenever a `templates/*.php` page's JS gains a real CSS dependency (a library import, not just inline `<style>` in the template), check that its template calls both `Util::addScript()` **and** `Util::addStyle()` with the same basename - confirm by checking the rendered page's `<head>` for a `<link rel="stylesheet" href=".../css/<name>.css">`, not just that the script tag is present.

## Companion app (React Native) — Android background location

The companion app (`companion/`, added in commit b6d14d0) had several stacked bugs blocking end-to-end testing on the Android emulator, on top of each other, each failing silently or with a misleading symptom. All are now fixed.

### The bugs, in the order they were found

1. **Emulator disk I/O**: default Quick Boot snapshot-save on an AVD can write hundreds of MB/s to disk continuously (worse on an encrypted root fs), causing system-wide slowness with low reported CPU usage (`vmstat` shows high `wa`, not obvious from a CPU-centric view like htop). Fix: launch the emulator with `-no-snapshot-save -no-snapshot-load`.
2. **Metro/dev-client connection**: `expo run:android`'s deep link points the dev client at the host's LAN IP (e.g. `192.168.2.174:8081`), which the emulator's NAT network can't hairpin back to. The app silently falls back to the Dev Launcher home screen with no error. Fix: `adb reverse tcp:8081 tcp:8081` + open `exp+hereabouts-companion://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081` instead. Note: the `adb reverse` mapping does not survive an emulator restart or the session being idle for a while — it silently drops and needs to be redone (check with `adb reverse --list`).
3. **Cleartext HTTP blocked**: no network security config existed, so Android's default policy blocked all plain-HTTP requests to the local dev Nextcloud (`http://10.0.2.2:8080`). Every function in `companion/src/api.ts` had an empty `catch` with no logging, so this failure was completely invisible (fixed permanently — see below).
4. **Nextcloud `trusted_domains`**: the dev container's `config.php` only trusted `localhost`, so even with cleartext allowed, Nextcloud served its "untrusted domain" HTML warning page instead of JSON. Fix: `docker exec --user www-data hereabouts-dev php occ config:system:set trusted_domains 2 --value="10.0.2.2"`. This is container state, not a code fix — needed again on a fresh container.
5. **The actual background-location bug**: `expo-location`'s Android background task schedules a *persisted* `JobScheduler` job (so it survives reboots), which throws `IllegalArgumentException: Requested job cannot be persisted without holding android.permission.RECEIVE_BOOT_COMPLETED permission` if that permission isn't declared. This crashed the location task's separate `LocationTaskService` process every time sharing was toggled on, invisibly (it's a different OS process from the main UI, so the toggle just showed "Sharing location" as if nothing were wrong). This was the real reason background sharing didn't work.
6. **Share links generated via the emulator were unreachable from the host browser**: Nextcloud's `IURLGenerator::getAbsoluteURL()` (used by `ShareController::create()`) builds absolute URLs from the Host header of whatever request created them — by design, for multi-domain/reverse-proxy setups. Since the companion app talks to Nextcloud via `10.0.2.2:8080` (emulator-only address), share links came back as `http://10.0.2.2:8080/apps/hereabouts/view/{token}`, which means nothing outside the emulator's network namespace. Not a Hereabouts bug — this ambiguity only exists because dev has two valid network paths to one server; production only ever has one hostname. Fix (container state, re-apply after a fresh container):
   ```
   docker exec --user www-data hereabouts-dev php occ config:system:set overwritehost --value="localhost:8080"
   docker exec --user www-data hereabouts-dev php occ config:system:set overwriteprotocol --value="http"
   ```

### Permanent fixes now in place

- `companion/app.json` → `android.permissions` includes `android.permission.RECEIVE_BOOT_COMPLETED`.
- `companion/plugins/withNetworkSecurityConfig.js` — local Expo config plugin (registered in `app.json`'s `plugins` array) that writes `network_security_config.xml` and wires `android:networkSecurityConfig` into the manifest on every `expo prebuild`. Cleartext is permitted only for `10.0.2.2`, `localhost`, `127.0.0.1` — scoped narrowly enough that it's safe to ship even in release builds, since no real Nextcloud instance resolves to those addresses.
- `companion/src/api.ts` — every API function now logs failures via `console.error` instead of swallowing them silently. Keep this pattern for any new API functions added here.

### The `localhost` vs `10.0.2.2` gotcha also applies to guest links, not just Nextcloud-login mode

Item 3 above documents cleartext-HTTP being blocked, and `manual-testing.md` §4 documents the `localhost`-typo trap for the Nextcloud-login server URL field — but the same trap exists independently for guest-mode invite links, and it fails silently in the exact same way (`console.error`'d `TypeError: Network request failed` on every `sendGuestPosition`/`fetchGroupInfo`/`fetchGuestPositions` call, nothing else visibly wrong in the UI beyond a persistent "Not sharing" status). Root-caused 2026-09-13: a guest link pasted from a URL copied out of a browser tab open to the host (`http://localhost:8080/apps/hereabouts/join/{token}`) resolves `localhost` to the *emulator's own loopback* once stored and used from inside the emulator — nothing listens there. `adb shell run-as <pkg> cat shared_prefs/SecureStore.xml` won't show the plaintext (it's encrypted at rest), so the fastest way to confirm this diagnosis is a temporary `console.log(JSON.stringify(config.guestLinks))` in `HomeScreen.tsx`, not guessing from the network layer down (raw `nc`/`ping` from `adb shell` to `10.0.2.2:8080` will succeed regardless, since that's testing OS-level routing, not what the app actually has stored).

Fix for a live device: remove the broken link (✕) and re-add it, pasting the `10.0.2.2:8080` form of the invite URL instead of whatever a browser on the host shows. There's no code fix for this one — it's inherent to guests always joining via a URL they were handed, and emulator networking being genuinely different from a real device's.

### Guest mode couldn't tell groups apart, and had no map — both fixed 2026-09-13

Two real gaps found from the user actually using guest mode (not synthetic testing): the "Groups" list in `HomeScreen.tsx` showed only the guest's own chosen display name per link (e.g. "Jane"), never which actual group that was for — confusing with more than one joined group, and indistinguishable from garden-variety broken state when the *group* name is what's actually informative. Separately, guest mode had no map at all; `GroupMap` (added 2026-09 for the companion app) was only ever wired into the Nextcloud-login mode's `GroupDetail`, and the guest-facing `GET /guest/{token}/positions` endpoint (added 2026-09 for the web join page) had no companion-app caller.

Fixed by adding `GroupController::info()` (`GET /join/{token}/info`, public) returning `{name, ownerDisplayName}` for a token — mirrors what `PageController::join` already resolves server-side for the web page, since the companion app never loads that page. `GuestLink` (`config.ts`) gained an optional `groupName` field, populated at join time and backfilled for pre-existing links missing it (a `useEffect` in `HomeScreen.tsx` that calls the new endpoint for any link without one). `api.ts` gained `fetchGroupInfo()` and `fetchGuestPositions()`; a new `GuestGroupDetail` component (guest-mode counterpart to `GroupDetail`) polls the latter every 10s while open and reuses the existing `GroupMap`.

Verified via a full `npx expo prebuild --platform android --clean` followed by `npx expo run:android` — the permission and network config both regenerate correctly with no manual steps.

One unrelated wrinkle turned up during that clean rebuild: **`configureCMakeDebug[arm64-v8a]` fails with `WARNING: A restricted method in java.lang.System has been called`** on a fresh (non-cached) CMake configure, on a JDK 21 host. This is a JDK 21+/AGP-CMake interaction bug (JEP 451 native-access warnings corrupting the CMake-server stdout/stdin protocol), unrelated to Hereabouts code. Fix: run the build with `JAVA_TOOL_OPTIONS="--enable-native-access=ALL-UNNAMED"` set, e.g. `JAVA_TOOL_OPTIONS="--enable-native-access=ALL-UNNAMED" npx expo run:android`. Only needed after a clean/from-scratch native build; cached rebuilds don't retrigger it.

7. **AVD default RAM (2048MB) is too small — the app gets silently OOM-killed mid-launch.** Symptom looks identical to the Metro/tunnel bug (#2): the deep link fires, the app briefly appears, then you're back on the launcher or the Dev Launcher error screen, with no exception logged for the app. The real cause is Android's `lowmemorykiller`:
   ```
   lowmemorykiller: Kill 'com.hereabouts.companion' (<pid>), uid 10228, oom_score_adj 0 to free ...; reason: min watermark is breached and swap is low
   ```
   visible via `adb logcat -d | grep -i lowmemorykiller`, timed right around when `libexpo-modules-core.so` loads (`nativeloader: Load ... libexpo-modules-core.so`). Confirm with `adb shell cat /proc/meminfo` showing `MemFree` in the tens-of-MB range. The stock `Pixel_4` AVD (`~/.android/avd/Pixel_4.avd/config.ini`) ships `hw.ramSize=2048`, which isn't enough headroom for the dev client + Hermes + native module init, even though the host itself may have plenty of free RAM — this is an AVD config ceiling, not a host constraint. Fix: bump `hw.ramSize=4096` (or higher) in that `config.ini`, then cold-boot the emulator (cheap with `-no-snapshot-save -no-snapshot-load`, which this project already uses).

   Before chasing the tunnel/Metro setup again on a fresh app-launch failure, check logcat for `lowmemorykiller` first — it's the faster diagnosis.

### Android emulator dev workflow reminders

- Nextcloud dev container: `docker compose -f docker-compose.dev.yml up -d` (see main `CLAUDE.md`).
- Launch the AVD with snapshotting disabled: `emulator -avd Pixel_4 -netdelay none -netspeed full -no-snapshot-save -no-snapshot-load`. Check first that one isn't already running from an earlier session (`pgrep -fl "qemu-system.*Pixel_4"`) — a second launch against the same AVD fails with `FATAL: Running multiple emulators with the same AVD is an experimental feature`. Stop the old one cleanly with `adb emu kill` before relaunching (needed, for example, after editing `config.ini` — the running instance won't pick up the change).
- Fake GPS on the emulator: `adb emu geo fix <lon> <lat>`.
- After every fresh emulator boot or `expo run:android` reinstall, re-run `adb reverse tcp:8081 tcp:8081` before trying to connect the dev client.
- `adb reverse` + the dev-client deep link (`adb shell am start -a android.intent.action.VIEW -d "exp+hereabouts-companion://..."`) only gets you connected if a Metro bundler is actually running and reachable at `127.0.0.1:8081` inside the emulator. `npx expo run:android` starts one for you; if you're reconnecting to an already-installed build without running that (e.g. after `npx expo start` was never started, or died), the deep link will land on `DevLauncherErrorActivity` and look exactly like a broken tunnel. Check first with `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8081/status` on the host (expect `200`); if not, `cd companion && npx expo start` before retrying the deep link.
- Right after a fresh boot, `adb shell am start ...` can fail with `cmd: Can't find service: activity` even though `getprop sys.boot_completed` already reads `1` — the activity-manager service registers a few seconds after that property flips. Not a real error; wait a few seconds and retry. (`adb shell uptime` under ~1 min is a good sign this is what's happening.)
- Rapid `am force-stop` + relaunch cycles (e.g. while scripting the app via `adb`) can trigger transient crashes unrelated to app code: seen once as a `NullPointerException` in `SharedPreferences.getAll()` on `ExpoLocation.startLocationUpdatesAsync`, and once inside React Native's own dev-inspector WebSocket handling (`CxxInspectorPackagerConnection$WebSocketDelegate.didReceiveMessage`). Both self-resolved after one clean force-stop + relaunch with a few seconds to settle — treat as dev-tooling flakiness from reconnecting to Metro too quickly, not a real bug, unless it recurs consistently.

## OpenStreetMap tiles blocked with "Referer is required by tile usage policy"

Nextcloud hardcodes `Referrer-Policy: no-referrer` directly in `lib/base.php` via a raw `header()` call during bootstrap — it's not exposed through the normal per-response header API, so it **can't be overridden from app code** via `Response::addHeader()` (confirmed: adding the header on the `TemplateResponse`/`PublicTemplateResponse` in `PageController` had zero effect, since Nextcloud's own call happens later in the pipeline regardless of where in app code you try to set it).

Effect: the browser sends no `Referer` header at all when fetching OSM tiles, which OpenStreetMap's tile usage policy explicitly rejects (see `osm.wiki/Blocked`). This affects **every** Hereabouts deployment, not just local dev — any Nextcloud instance has this default.

Fix: a `<meta name="referrer">` element in the page itself *can* relax this for the document's own outgoing requests, even though the HTTP header can't be touched. `lib/Controller/PageController.php` now adds one via `\OCP\Util::addHeader('meta', ['name' => 'referrer', 'content' => 'strict-origin-when-cross-origin'])` alongside the existing `theme-color` meta tag, on all three map-bearing pages (`index`, `join`, `view`). Verified in the rendered HTML output (note: PHP opcache's `revalidate_freq` — 60s in the dev container — means a PHP edit isn't guaranteed to take effect for up to a minute).

The longer-term, more complete fix (already flagged in `CLAUDE.md`'s roadmap) is proxying tiles through Nextcloud instead of hitting `tile.openstreetmap.org` directly from the browser — better for privacy (family members' IPs aren't correlated with location tile requests by a third party) and removes this whole class of issue. Not done yet.

## Migration name limits differ by Nextcloud version (matters for app renames)

When the app was renamed to Hereabouts (2026-11-19), the `wepwawet_group_members` table became `hereabouts_members`, not `hereabouts_group_members` (24 chars). Reason: on Nextcloud ≤ 32, `MigrationService::ensureOracleConstraints()` rejects any table whose name (minus the `oc_` prefix) is **≥ 23 characters** if it uses the default primary-key name (a plain `setPrimaryKey(['id'])`). The error is `Primary index name on "oc_..." is too long.` This check runs on every database, not just Oracle: `checkOracle` is on for any app whose `info.xml` has no `<dependencies><database>` element, which includes this one. Other ≤ 32 limits: table names ≤ 27, column/index names ≤ 30.

From Nextcloud 33 on (checked `stable33`–`stable35`), that rule is gone and `ensureNamingConstraints()` allows names up to 63 characters including the prefix. Since the app now requires 33+, the short name is no longer strictly needed, but it's harmless. Re-check these limits if `min-version` in `info.xml` is ever lowered below 33.

## Nextcloud 34/35 compatibility fixes (2026-11-21)

Found while preparing to test on a Nextcloud 35 instance (`min-version` was 30, `max-version` 34):

- **`addAllowedChildSrcDomain()` was removed in Nextcloud 34.** `lib/AppInfo/Application.php` called it as a fallback next to `addAllowedWorkerSrcDomain('blob:')`, which would crash the app's `boot()` with "Call to undefined method" on 34+. Removed it: `worker-src blob:` (still set) is what MapLibre's blob-URL web worker needs, and all current browsers support `worker-src`. Source: `developer_manual/release_notes/previous/upgrade_to_34.rst` in nextcloud/documentation.
- **Boolean columns with `notnull => true` fail to install on Nextcloud ≤ 32.** `hereabouts_members.visible` is `Types::BOOLEAN` with `notnull => true`. On ≤ 32, `ensureOracleConstraints()` throws `is type Bool and also NotNull, so it can not store "false"`, even on a fresh install. Nextcloud 33+ allows it and only adjusts the column on Oracle (server PR #55156). Fix chosen: `min-version` raised to 33. 30–32 are end-of-life anyway (32 since 2026-09), so the app no longer claims support for them.
- Everything else in the 34/35 upgrade notes doesn't affect this app. It uses none of the removed browser globals (`oc_requesttoken`, `OCDialogs`, `moment`, `_`, jQuery), and the migrations only use `addColumn`/`setPrimaryKey`/`addIndex`/`addUniqueIndex`/`hasColumn`/`getTable`, which keep the same signatures on 35's new `OCP\DB\Schema\ITable` wrapper.

## Setting `apps_paths` one key at a time with `occ` takes the whole instance down

Running `occ config:system:set apps_paths 0 path --value=...` as the first of several per-key commands writes an entry that has a `path` but no `url`. At startup, `lib/OC.php` (checked on `stable35`) skips every `apps_paths` entry missing either key. With no usable entry left, it throws `apps directory not found! Please put the Nextcloud apps folder in the Nextcloud folder...` on **every** request: the web UI and every later `occ` command fail, so `occ` can't undo it. Happened on the test instance on 2026-11-21.

Fix: delete the half-written `'apps_paths'` block from `config/config.php` by hand (`php -l` it afterwards), restart php-fpm, then set the whole list in one command:

```bash
occ config:system:set apps_paths --type=json --value='[{"path":"/var/www/nextcloud/apps","url":"/apps","writable":false},{"path":"/var/www/nextcloud/custom_apps","url":"/custom_apps","writable":true}]'
```

The same applies to any other nested system-config value that Nextcloud only accepts as a whole: set it with `--type=json`, not key by key.

Also: on a normal (archive) install, **no `apps_paths` is the default** and every app, shipped or from the App Store, lives in `apps/`. The `apps` + `custom_apps` split comes from the official Docker image (and our `docker-compose.dev.yml`). There's no reason to add it to a bare-metal test server; the test instance went back to the default and uses `apps/hereabouts`.

## Companion: `CI=1` turns off Metro's file watching

Starting the companion with `CI=1 npx expo run:android` (or `expo start`) makes Expo run Metro in CI mode: the log says `Metro is running in CI mode, reloads are disabled. Remove CI=true to enable watch mode.` Edits never reach the app, and **new files can't be resolved at all** (`Unable to resolve module ./newFile`), because Metro only knows the files it found at startup. Start Metro without `CI` (`env -u CI npx expo start --dev-client`) and reload the app.

## Companion: POSTs fail with 405 on servers without pretty URLs (2026-11-21)

**Symptom:** on the NC 35 test server, the companion logged in and listed groups fine, but every `sendPosition` / `createShare` failed with `405 Method Not Allowed`.

**Cause:** the companion built URLs as `{server}/apps/hereabouts/...`, without `/index.php`. On an Apache server without pretty URLs (no `htaccess.RewriteBase`), such a URL is not a file, so Apache serves its `ErrorDocument 404`, which points into `index.php`. Nextcloud then routes the original path, so it *seems* to work, but Apache always makes error-document requests a GET. GET routes work; POST routes arrive as GET and the router answers 405. Proof: without `/index.php`, a POST to the GET-only `/api/groups` gets 401 (accepted as GET); with `/index.php`, the same POST gets 405. The Docker dev container has pretty URLs on, so it never showed up there.

**Fix:** `companion/src/api.ts` builds every URL with `appUrl()`, which always inserts `/index.php/apps/hereabouts`. That works on every server. `parseInviteUrl` now keeps a subpath (`https://example.com/nextcloud`) and drops `index.php`, which `appUrl()` adds back. The web frontend isn't affected: `generateUrl()` adds `index.php` itself when needed. Any future client code that builds Nextcloud URLs by hand must include `/index.php` too.

## Joining a group from the web join page failed for non-admins (2026-11-21)

**Symptom:** a logged-in Nextcloud user opening an invite link and clicking "Join group" got "Couldn't join the group. Check your connection and try again."

**Cause:** commit b79523b (2026-09-13) inserted the new `GroupController::info()` method *between* `accept()`'s `#[NoAdminRequired]` / `#[NoCSRFRequired]` attributes and `accept()` itself. From then on those attributes belonged to `info()` (which had its own copies too), and `accept()` had none, so it became admin-only and required a CSRF token. The join page's `fetch(ACCEPT_URL, {method: 'POST'})` sends no token, so it failed for every web user. It stayed hidden because the Docker dev env tests as `admin`, and the companion app's join passes the CSRF check anyway: Nextcloud treats requests with an `OCS-APIRequest` header as passing it.

**Fix:** moved the attributes (and `accept()`'s docblock) back. When adding a controller method, insert it *above* the previous method's docblock and attributes, never directly above its `public function` line. To audit, list every controller method with its attributes and look for one without `NoAdminRequired`. Test web flows as a non-admin user too.

## Companion map: marker stacking and hot reload (2026-11-21)

- **Marker stacking:** `@maplibre/maplibre-react-native` (v11) draws `<Marker>`s in the order they were *added* to the native map. Reordering the React children doesn't change it. When two people are at the same spot, the selected person's marker would stay hidden. `GroupMap.tsx` gives the selected marker a different `key`, so React removes it and adds it again as the topmost one.
- **Hot reload:** a Fast Refresh that touches a file importing the MapLibre module fails with `Invariant Violation: Tried to register two views with the same name MLRNVectorSource`. Not a code bug: do a full reload (reopen the dev-client deep link, or `r` in Metro).

## `@nextcloud/vue` 9: `NcButton type="tertiary"` silently loses its style (2026-11-21)

In `@nextcloud/vue` 9, `NcButton`'s `type` prop is the native button type (`button`/`submit`/`reset`), and the look is set with `variant` (`primary`, `tertiary`, …). Older code using `type="tertiary"` / `type="primary"` still compiles and renders, but every such button gets the default `secondary` style, and "Create share link" lost its primary colour. All buttons in `src/App.vue` now use `variant`. Use `variant` for new buttons.

## Redeploying with the same app version: browsers keep the old JS for 6 months (2026-11-21)

Symptom: after deploying the redesigned guest page to the test server, the page showed the new markup (top bar) but behaved like the old script (no member strip, no map buttons, map re-framing on every poll).

Cause: Nextcloud's `.htaccess` serves app JS/CSS with `Cache-Control: max-age=15778463, immutable` (checked with `curl -sI` against the test server). The `?v=` cache buster on script URLs comes from the app version in `appinfo/info.xml`, so while that stays the same (it was `0.1.0` for every deploy) the URL never changes. Browsers that had loaded the page before keep using the old script without asking the server, while the PHP template (HTML) is always fresh. Old script plus new markup gives a half-updated page. The local Docker env doesn't show this: with `debug=true` Nextcloud leaves out `?v=` altogether.

Fix while testing: open the page in a fresh private window, or hard-reload (Ctrl+Shift+R). For anything other people use (releases, family testers), bump `<version>` in `info.xml` so every script URL changes; Nextcloud then needs `occ upgrade` (or the web updater's "update" button) before the app runs again.

## Public pages: Nextcloud's core CSS squashes plain `<input>`/`<button>` elements (2026-11-21)

Symptom: on the guest join page (`templates/join.php`) the name field looked cramped, with its text partly cut off. The duration buttons were slightly offset and changed colour on focus or hover in ways the page's own CSS never asked for.

Cause: core `server.css` (checked on the test server, NC 35) styles every bare form element. `input:not([type=radio]):not([type=checkbox])…` sets `height: var(--default-clickable-area)` (34px). Our `#ls-name-input` rule set `padding: 14px 16px` but no height, so with `box-sizing: border-box` almost nothing was left for the text. `button:not(.button-vue,…)` adds `margin: 3px`, `width: 130px`, its own padding and a `:hover`/`:focus` background. Nextcloud components (NcButton etc.) opt out via `.button-vue`; hand-written markup doesn't.

Fix: scope the page's styles under `#hereabouts-join` (an ID beats the long `:not()` chains), and set `height`, `margin`, `width` and the `:hover`/`:focus` states explicitly on every input and button.

Related: the public layout's `#content` is a fixed flex row with no background. A card placed in it directly shrinks to its content width. `join.php` therefore positions `#hereabouts-join` fixed below the header, like `Viewer.vue`. It stays transparent, so the theme background behind the header continues behind the card.

## Link previews and the app link: testing gotchas (2026-11-21)

- **Chat apps cache link previews per URL.** WhatsApp, Signal and others fetch a link's Open Graph tags (`PageController::addLinkPreview`) once and keep the result. An invite link that was pasted into a chat before the tags existed keeps showing the old "Nextcloud" preview. To test, use a link that has never been shared, e.g. a newly created group or share link.
- **`companion/app.json` changes need a prebuild.** `companion/android/` is generated and gitignored, so changing something native in `app.json` (here: `"scheme": "hereabouts"`) only takes effect after `npx expo prebuild --platform android --no-install` has rewritten `AndroidManifest.xml`. Without it, the APK builds fine but Android doesn't know the app handles `hereabouts://` links, so the invite page's "Open in the Hereabouts app" link falls back to the browser. Check with `aapt2 dump xmltree --file AndroidManifest.xml app-release.apk | grep scheme`.
