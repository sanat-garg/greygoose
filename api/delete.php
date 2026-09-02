<?php
/* Removes one file from photos/. Admin-only, and confined to that folder.

   basename() is what actually stops traversal: "photos/../../api/lib.php"
   collapses to "lib.php", which is then looked for inside photos/ and nowhere
   else. realpath() is a second check in case photos/ holds a symlink out. */
require __DIR__ . '/lib.php';
gg_require_admin();

$rel = trim((string)(gg_body()['path'] ?? ''));
if (strpos($rel, 'photos/') !== 0) gg_fail('only files in photos/ can be deleted');

$name = basename($rel);
if ($name === '' || $name === '.' || $name === '..') gg_fail('not a file name');

$real   = realpath(GG_PHOTOS . '/' . $name);
$photos = realpath(GG_PHOTOS);

if ($real === false) {
    /* say so rather than reporting a phantom success */
    gg_json(['ok' => true, 'removed' => false, 'note' => 'no such file in photos/']);
}
if ($photos === false || strpos($real, $photos . DIRECTORY_SEPARATOR) !== 0) {
    gg_fail('that path escapes photos/');
}

$gone = @unlink($real);
gg_json(['ok' => (bool)$gone, 'removed' => (bool)$gone]);
