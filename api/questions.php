<?php
/* The gate's questions, with the answer hashes stripped out — the server does
   the checking, so a visitor never receives anything to crack offline.
   Incomplete questions are withheld: one of those locks the visitor out. */
require __DIR__ . '/lib.php';

$access = gg_read_data()['access'] ?? [];
$out = [];
foreach (($access['questions'] ?? []) as $q) {
    if (trim((string)($q['question'] ?? '')) === '' || empty($q['hash'])) continue;
    $out[] = ['id' => $q['id'] ?? '', 'question' => $q['question']];
}
gg_json([
    'enabled'   => (bool)($access['enabled'] ?? false),
    'title'     => $access['title'] ?? '',
    'intro'     => $access['intro'] ?? '',
    'questions' => $out,
]);
