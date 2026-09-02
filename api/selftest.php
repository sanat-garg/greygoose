<?php
/* Open this on your host after uploading. It proves the two things that would
   silently break everything: that PHP hashes answers exactly like the browser
   does, and that the folders are writable. Delete it once you are happy. */
require __DIR__ . '/lib.php';

/* Same vectors the JavaScript is checked against. */
$vectors = [
    'maple'          => 'sha256:49ead2b1066bda1e127f6ae0bd163778d08587e3e97d9ed58e8cc99972460a1c',
    '  MAPLE!! '     => 'sha256:49ead2b1066bda1e127f6ae0bd163778d08587e3e97d9ed58e8cc99972460a1c',
    'Arnold-Palmer'  => 'sha256:7e63a7968d5225a71a61f10d44efc8f920f34e821170640e936c1c5e855888ac',
    'arnold palmer'  => 'sha256:7e63a7968d5225a71a61f10d44efc8f920f34e821170640e936c1c5e855888ac',
    'ARNOLDPALMER'   => 'sha256:7e63a7968d5225a71a61f10d44efc8f920f34e821170640e936c1c5e855888ac',
    "St. Mary's"     => 'sha256:ecef68c1209ca994e60365daeae67e330898a1d78ad886291c2d2e110613b234',
    'café'           => 'sha256:a860b858265b22dad3aaf1165cfc2936daf1d3d86e0b7b77e3cc07f59f96858f',
    'Shoes Off.'     => 'sha256:32b180bcdb74c3c9b02bd6d5191d5b9ea5fb6dbd1da401f64cdc73ee83030340',
];

$hash = [];
$bad  = 0;
foreach ($vectors as $input => $want) {
    $got = gg_answer_hash($input);
    $ok  = hash_equals($want, $got);
    if (!$ok) $bad++;
    $hash[] = ['input' => $input, 'normalised' => gg_normalise($input), 'ok' => $ok];
}

$checks = [
    'php_version'        => PHP_VERSION,
    'json'               => extension_loaded('json'),
    'mbstring'           => extension_loaded('mbstring'),
    'intl_Normalizer'    => class_exists('Normalizer'),
    'data_json_readable' => is_readable(GG_DATA),
    'data_json_writable' => is_writable(GG_DATA),
    'site_dir_writable'  => is_writable(GG_ROOT),
    'photos_writable'    => is_dir(GG_PHOTOS) ? is_writable(GG_PHOTOS) : 'photos/ missing',
    'admin_password_set' => gg_admin_configured(),
    'gate_enforced'      => GG_GATE,
];

$fatal = [];
if ($bad) $fatal[] = "$bad answer hash(es) do NOT match the browser — gate answers will not work";
if (!$checks['data_json_writable'] && !$checks['site_dir_writable']) $fatal[] = 'cannot write data.json — the admin panel will not save';
if ($checks['photos_writable'] !== true) $fatal[] = 'cannot write photos/ — uploads will fail';

gg_json([
    'ok'      => empty($fatal),
    'fatal'   => $fatal,
    'checks'  => $checks,
    'hashing' => $hash,
], empty($fatal) ? 200 : 500);
