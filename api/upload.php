<?php
/* A photo added from the admin panel. Admin-only. */
require __DIR__ . '/lib.php';
gg_require_admin();

$p    = gg_body();
$path = gg_store_data_url((string)($p['dataUrl'] ?? ''), $p['name'] ?? null);

if ($path === null) {
    gg_fail('could not save that image — check the file type and that photos/ is writable');
}
gg_json(['ok' => true, 'path' => $path]);
