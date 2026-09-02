<?php
/* Checks one gate answer. The comparison happens here, so the hashes never
   leave the server on this path. */
require __DIR__ . '/lib.php';

$p      = gg_body();
$wanted = (string)($p['id'] ?? '');
$given  = (string)($p['answer'] ?? '');

usleep(250000);                       // take the shine off guessing

foreach (gg_read_data()['access']['questions'] ?? [] as $q) {
    if (empty($q['hash'])) continue;                 // nothing could match it
    if ((string)($q['id'] ?? '') !== $wanted) continue;
    if (hash_equals((string)$q['hash'], gg_answer_hash($given))) {
        gg_set_cookie(GG_COOKIE_ACCESS, gg_access_token(), 60 * 60 * 24 * 30);
        gg_json(['ok' => true]);
    }
    break;
}
gg_fail('wrong answer', 401);
