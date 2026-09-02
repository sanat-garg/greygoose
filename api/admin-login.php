<?php
require __DIR__ . '/lib.php';

$pw = (string)(gg_body()['password'] ?? '');
usleep(300000);

if (!gg_admin_configured()) gg_fail('not configured', 400);
if (!gg_check_admin_password($pw)) gg_fail('wrong password', 401);

gg_set_cookie(GG_COOKIE_ADMIN, gg_admin_token(), 60 * 60 * 12);
gg_json(['ok' => true]);
