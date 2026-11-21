<?php

namespace OCA\Hereabouts\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * hereabouts_guests.removed_at: set when the group owner removes a guest.
 * The row stays for a while (Application::REMOVED_GUEST_KEEP) so the guest's
 * still-open page is told it was removed instead of silently re-adding them
 * with its next position update.
 */
class Version000000Date20261121000000 extends SimpleMigrationStep {

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		$table = $schema->getTable('hereabouts_guests');
		if (!$table->hasColumn('removed_at')) {
			$table->addColumn('removed_at', Types::INTEGER, ['notnull' => false]);
		}

		return $schema;
	}
}
