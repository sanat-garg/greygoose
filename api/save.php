<?php
/* The admin panel writing the whole archive back. Admin-only. */
require __DIR__ . '/lib.php';
gg_require_admin();

$data = gg_body();
foreach (['crews', 'members', 'parties', 'gallery'] as $key) {
    if (!array_key_exists($key, $data)) gg_fail('missing key: ' . $key);
}

/* --- the waiting list is server-owned ------------------------------------
   A friend can send their file in at any moment, including while the editor
   sits open. The editor may legitimately remove entries (approving or
   discarding them), but it must never delete one it has never seen — and an
   editor loaded before the submission arrived posts an empty list, which
   would silently wipe it. So: honour what the editor removed, and re-add
   anything on disk it was never shown. */

$incoming = is_array($data['submissions'] ?? null) ? $data['submissions'] : [];
$seen     = array_flip(array_map('strval', (array)($data['submissionsSeen'] ?? [])));
unset($data['submissionsSeen']);

$keptIds = [];
foreach ($incoming as $s) if (isset($s['id'])) $keptIds[(string)$s['id']] = true;

$merged = $incoming;
foreach (gg_read_data()['submissions'] ?? [] as $onDisk) {
    $id = (string)($onDisk['id'] ?? '');
    if ($id === '') continue;
    if (isset($keptIds[$id])) continue;   // editor still has it
    if (isset($seen[$id])) continue;      // editor saw it and dropped it on purpose
    $merged[] = $onDisk;                  // arrived after the editor loaded
}
$data['submissions'] = $merged;

gg_write_data($data);
gg_json(['ok' => true, 'submissions' => count($merged)]);
