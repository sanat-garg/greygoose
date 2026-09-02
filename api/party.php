<?php
/* One party, for a share link. Deliberately open — the key is the permission.
   Nothing else from data.json is exposed, and the key is not echoed back. */
require __DIR__ . '/lib.php';

$id  = (string)($_GET['id'] ?? '');
$key = (string)($_GET['k'] ?? '');

foreach (gg_read_data()['parties'] ?? [] as $p) {
    $share = (string)($p['share'] ?? '');
    if (($p['id'] ?? '') === $id && $share !== '' && hash_equals($share, $key)) {
        unset($p['share']);
        gg_json($p);
    }
}
gg_fail('not found', 404);
