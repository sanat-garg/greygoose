<?php
require __DIR__ . '/lib.php';
gg_json(['configured' => gg_admin_configured(), 'authed' => gg_is_admin()]);
