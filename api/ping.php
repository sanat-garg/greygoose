<?php
/* Tells the admin panel whether it can save at all. */
require __DIR__ . '/lib.php';
gg_json(['ok' => true, 'gate' => GG_GATE, 'php' => PHP_VERSION]);
