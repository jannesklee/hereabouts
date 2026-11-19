<?php
$appId = OCA\Hereabouts\AppInfo\Application::APP_ID;
\OCP\Util::addScript($appId, $appId . '-viewer');
\OCP\Util::addStyle($appId, $appId . '-viewer');
?>
<div id="hereabouts-viewer"></div>
