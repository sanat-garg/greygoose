<?php
/* Sets the password the first time, or changes it when already signed in.
   Once one exists you must prove you know it — otherwise anyone could
   overwrite it and take the editor. */
require __DIR__ . '/lib.php';

$p   = gg_body();
$new = trim((string)($p['new'] ?? ''));

if (mb_strlen($new) < 6) gg_fail('use at least 6 characters');

if (gg_admin_configured() && !gg_check_admin_password((string)($p['current'] ?? ''))) {
    gg_fail('current password is wrong', 401);
}

gg_set_admin_password($new);
gg_set_cookie(GG_COOKIE_ADMIN, gg_admin_token(), 60 * 60 * 12);
gg_json(['ok' => true]);
