<?php
/* Only needed if GG_GATE is on: serves data.json to unlocked visitors.
   Pointless unless the root .htaccess also blocks data.json directly. */
require __DIR__ . '/lib.php';

if (!gg_is_unlocked()) gg_fail('locked', 403);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
readfile(GG_DATA);
