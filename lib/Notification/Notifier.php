<?php

namespace OCA\Hereabouts\Notification;

use OCA\Hereabouts\AppInfo\Application;
use OCA\Hereabouts\Db\GroupMapper;
use OCA\Hereabouts\Db\GroupMemberMapper;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\IURLGenerator;
use OCP\IUserManager;
use OCP\L10N\IFactory;
use OCP\Notification\AlreadyProcessedException;
use OCP\Notification\INotification;
use OCP\Notification\INotifier;
use OCP\Notification\UnknownNotificationException;

/**
 * Turns the app's notifications (sent by JoinNotifications) into text when
 * Nextcloud shows them: "Anna joined Family" / "Tom joined Family as a guest".
 * Clicking one opens the group's map.
 */
class Notifier implements INotifier {

	public const SUBJECT_MEMBER_JOINED = 'member_joined';
	public const SUBJECT_GUEST_JOINED = 'guest_joined';

	public function __construct(
		private IFactory $l10nFactory,
		private IURLGenerator $urlGenerator,
		private IUserManager $userManager,
		private GroupMapper $groupMapper,
		private GroupMemberMapper $groupMemberMapper,
	) {
	}

	public function getID(): string {
		return Application::APP_ID;
	}

	public function getName(): string {
		return $this->l10nFactory->get(Application::APP_ID)->t('Hereabouts');
	}

	public function prepare(INotification $notification, string $languageCode): INotification {
		if ($notification->getApp() !== Application::APP_ID) {
			throw new UnknownNotificationException();
		}
		$subject = $notification->getSubject();
		if ($subject !== self::SUBJECT_MEMBER_JOINED && $subject !== self::SUBJECT_GUEST_JOINED) {
			throw new UnknownNotificationException();
		}

		// Group deleted, or the recipient isn't in it anymore: drop it
		$groupId = (int)$notification->getObjectId();
		try {
			$group = $this->groupMapper->find($groupId);
		} catch (DoesNotExistException $e) {
			throw new AlreadyProcessedException();
		}
		if (!$this->groupMemberMapper->isMember($groupId, $notification->getUser())) {
			throw new AlreadyProcessedException();
		}

		$l = $this->l10nFactory->get(Application::APP_ID, $languageCode);
		$parameters = $notification->getSubjectParameters();

		if ($subject === self::SUBJECT_MEMBER_JOINED) {
			$userId = (string)($parameters['userId'] ?? '');
			$person = [
				'type' => 'user',
				'id' => $userId,
				'name' => $this->userManager->getDisplayName($userId) ?? $userId,
			];
			$text = $l->t('{person} joined {group}');
		} else {
			$person = [
				'type' => 'highlight',
				'id' => 'guest',
				'name' => (string)($parameters['name'] ?? ''),
			];
			$text = $l->t('{person} joined {group} as a guest');
		}
		$groupParameter = [
			'type' => 'highlight',
			'id' => (string)$groupId,
			'name' => $group->getName(),
		];

		$notification->setRichSubject($text, ['person' => $person, 'group' => $groupParameter]);
		$notification->setParsedSubject(str_replace(
			['{person}', '{group}'],
			[$person['name'], $group->getName()],
			$text,
		));
		$notification->setIcon($this->urlGenerator->getAbsoluteURL(
			$this->urlGenerator->imagePath(Application::APP_ID, 'app-dark.svg'),
		));
		$notification->setLink(
			$this->urlGenerator->linkToRouteAbsolute('hereabouts.page.index') . '?group=' . $groupId,
		);

		return $notification;
	}
}
