#!/usr/bin/env bash
# Build Hereabouts and install it on a test Nextcloud over SSH.
#
# Usage: scripts/deploy-test.sh <ssh-host> [remote-dir]
#   ssh-host    anything ssh accepts: an alias from ~/.ssh/config or user@host
#   remote-dir  defaults to /var/www/nextcloud/apps/hereabouts
#
# Copies the release file set (see .nextcloudignore) to ~/hereabouts-staging
# on the server, then uses sudo there (asks for your password) to copy it into
# remote-dir and give it to www-data, like the rest of Nextcloud.
set -euo pipefail

host="${1:?usage: scripts/deploy-test.sh <ssh-host> [remote-dir]}"
dest="${2:-/var/www/nextcloud/apps/hereabouts}"
staging="hereabouts-staging"

# remote-dir gets "rsync --delete" as root, so refuse anything unexpected.
case "$dest" in
	/*/hereabouts) ;;
	*) echo "remote-dir must be an absolute path ending in /hereabouts" >&2; exit 1 ;;
esac

cd "$(dirname "$0")/.."
npm run build
rsync -rlpt --delete --chmod=D755,F644 \
	--exclude-from=.nextcloudignore --exclude=CLAUDE.md \
	./ "$host:$staging/"
ssh -t "$host" "sudo mkdir -p '$dest' && sudo rsync -rlpt --delete ~/'$staging'/ '$dest'/ && sudo chown -R www-data:www-data '$dest'"
echo "Installed to $host:$dest"
