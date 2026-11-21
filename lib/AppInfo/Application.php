<?php

namespace OCA\Hereabouts\AppInfo;

use OCA\Hereabouts\Notification\Notifier;
use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IRegistrationContext;
use OCP\AppFramework\Http\ContentSecurityPolicy;

class Application extends App implements IBootstrap {

	public const APP_ID = 'hereabouts';

	/**
	 * Seconds without a position update after which someone counts as no
	 * longer sharing: guests drop out of the group, members stay in it but
	 * their position is hidden (groups and share links alike). Both the web
	 * pages and the companion app send at least every 30s while sharing.
	 */
	public const INACTIVE_AFTER = 15 * 60;

	/** How long a guest the owner removed stays blocked from silently rejoining. */
	public const REMOVED_GUEST_KEEP = 24 * 3600;

	/**
	 * How long an inactive guest's entry (without position) is kept. Coming
	 * back within that time continues the old entry, so the group isn't
	 * notified of them "joining" again (see Notification\JoinNotifications).
	 */
	public const INACTIVE_GUEST_KEEP = 24 * 3600;

	public function __construct(array $urlParams = []) {
		parent::__construct(self::APP_ID, $urlParams);
	}

	public function register(IRegistrationContext $context): void {
		$context->registerNotifierService(Notifier::class);
	}

	public function boot(IBootContext $context): void {
		$cspManager = $this->getContainer()->get(\OCP\Security\IContentSecurityPolicyManager::class);

		$csp = new ContentSecurityPolicy();
		// MapLibre GL fetches raster tiles via fetch() in a web worker (connect-src).
		// The wildcard *.tile.openstreetmap.org covers a/b/c subdomains used for
		// load balancing; the bare domain is needed as a fallback.
		$csp->addAllowedConnectDomain('https://tile.openstreetmap.org');
		$csp->addAllowedConnectDomain('https://*.tile.openstreetmap.org');
		// Some browsers/MapLibre versions decode tiles into <img> elements (img-src).
		$csp->addAllowedImageDomain('https://tile.openstreetmap.org');
		$csp->addAllowedImageDomain('https://*.tile.openstreetmap.org');
		// MapLibre GL uses a web worker created from a blob URL
		$csp->addAllowedWorkerSrcDomain('blob:');

		$cspManager->addDefaultPolicy($csp);
	}
}
