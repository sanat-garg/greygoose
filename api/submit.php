<?php
/* join.html — a friend filling in their own file.
   Unauthenticated on purpose, so it lands on a waiting list the admin approves
   rather than going straight onto the site. Everything is length-capped. */
require __DIR__ . '/lib.php';

$p    = gg_body();
$name = trim((string)($p['name'] ?? ''));
if ($name === '') gg_fail('a name is required');

$record = [];
foreach ((array)($p['record'] ?? []) as $k => $v) {
    if (!is_scalar($v)) continue;
    $k = mb_substr(trim((string)$k), 0, 60);
    $v = mb_substr(trim((string)$v), 0, 300);
    if ($k !== '' && $v !== '') $record[$k] = $v;
}

$entry = [
    'id'        => 'sub-' . bin2hex(random_bytes(5)),
    'at'        => date('Y-m-d H:i'),
    'name'      => mb_substr($name, 0, 80),
    'crew'      => mb_substr((string)($p['crew'] ?? ''), 0, 40),
    'blurb'     => mb_substr(trim((string)($p['blurb'] ?? '')), 0, 600),
    'instagram' => mb_substr((string)preg_replace('/[^A-Za-z0-9._]/', '', (string)($p['instagram'] ?? '')), 0, 40),
    'record'    => $record,
    'photo'     => '',
];

if (!empty($p['photoData'])) {
    $stored = gg_store_data_url((string)$p['photoData'], $p['photoName'] ?? 'photo.jpg', 'join-');
    if ($stored !== null) $entry['photo'] = $stored;
}

$data = gg_read_data();
$data['submissions'] = $data['submissions'] ?? [];
if (count($data['submissions']) >= 200) gg_fail('the waiting list is full');
$data['submissions'][] = $entry;

gg_write_data($data);
gg_json(['ok' => true]);
