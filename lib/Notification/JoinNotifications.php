<?php

namespace OCA\Hereabouts\Notification;

use OCA\Hereabouts\AppInfo\Application;
use OCA\Hereabouts\Db\GroupMemberMapper;
use OCP\Notification\IManager;
use Psr\Log\LoggerInterface;

/**
 * Tells the members of a group that someone joined it: a member through the
 * invite link (GroupController::accept), or a guest starting to share
 * (PositionController::guestUpdate). Everyone sharing their location in a
 * group should know who can see it. The text is built by Notifier.
 */
class JoinNotifications {

	public function __construct(
		private IManager $notificationManager,
		private GroupMemberMapper $groupMemberMapper,
		private LoggerInterface $logger,
	) {
	}

	public function memberJoined(int $groupId, string $userId): void {
		$this->send($groupId, Notifier::SUBJECT_MEMBER_JOINED, ['userId' => $userId], $userId);
	}

	public function guestJoined(int $groupId, string $name): void {
		$this->send($groupId, Notifier::SUBJECT_GUEST_JOINED, ['name' => $name], null);
	}

	/** @param array<string, string> $parameters */
	private function send(int $groupId, string $subject, array $parameters, ?string $exceptUserId): void {
		// Never let a notification problem break joining
		try {
			$now = new \DateTime();
			foreach ($this->groupMemberMapper->findByGroup($groupId) as $member) {
				if ($member->getUserId() === $exceptUserId) {
					continue;
				}
				$notification = $this->notificationManager->createNotification();
				$notification->setApp(Application::APP_ID)
					->setUser($member->getUserId())
					->setDateTime($now)
					->setObject('group', (string)$groupId)
					->setSubject($subject, $parameters);
				$this->notificationManager->notify($notification);
			}
		} catch (\Throwable $e) {
			$this->logger->warning('Could not send join notification for group ' . $groupId, ['exception' => $e]);
		}
	}
}
