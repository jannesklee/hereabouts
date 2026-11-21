<?php

namespace OCA\Hereabouts\BackgroundJob;

use OCA\Hereabouts\AppInfo\Application;
use OCA\Hereabouts\Db\GuestMapper;
use OCA\Hereabouts\Db\PositionMapper;
use OCA\Hereabouts\Db\ShareMapper;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\TimedJob;

/**
 * Deletes what the app no longer shows: expired or inactive guests, guests
 * the owner removed a while ago, old positions and expired share links.
 * Queries already leave these out, so running only hourly is fine.
 */
class CleanupExpiredGuests extends TimedJob {

	public function __construct(
		ITimeFactory $time,
		private GuestMapper $guestMapper,
		private PositionMapper $positionMapper,
		private ShareMapper $shareMapper,
	) {
		parent::__construct($time);
		// Run once per hour
		$this->setInterval(3600);
	}

	protected function run(mixed $argument): void {
		$now = $this->time->getTime();
		$this->guestMapper->deleteExpired();
		$this->guestMapper->deleteInactive($now - Application::INACTIVE_AFTER);
		$this->guestMapper->deleteRemovedBefore($now - Application::REMOVED_GUEST_KEEP);
		$this->positionMapper->deleteOlderThan($now - Application::INACTIVE_AFTER);
		$this->shareMapper->deleteExpired();
	}
}
