<?php
$appId = OCA\Hereabouts\AppInfo\Application::APP_ID;
\OCP\Util::addScript($appId, $appId . '-main');
\OCP\Util::addStyle($appId, $appId . '-main');
?>
<div id="hereabouts-app"></div>
