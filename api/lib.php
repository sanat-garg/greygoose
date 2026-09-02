<?php
/* ============================================================================
   GREYGOOSE — api/lib.php
   Shared helpers for every endpoint. Written for ordinary shared hosting:
   no database, no persistent process, no extensions beyond json + mbstring.

   Each endpoint is its own .php file so nothing depends on mod_rewrite —
   plenty of shared hosts ship with AllowOverride off.
   ========================================================================== */

declare(strict_types=1);

/* ---- where things live ----------------------------------------------------
   ROOT is the folder holding index.html. If your host lets you write above the
   web root, point GG_PRIVATE there instead and move .secret/.adminpass into it;
   the .htaccess rules become belt-and-braces rather than the only defence.   */

define('GG_ROOT',    dirname(__DIR__));
define('GG_PRIVATE', GG_ROOT);                       // e.g. dirname(GG_ROOT).'/gg-private'
define('GG_DATA',    GG_ROOT . '/data.json');
define('GG_PHOTOS',  GG_ROOT . '/photos');
define('GG_BACKUPS', GG_PRIVATE . '/.backups');
define('GG_SECRET',  GG_PRIVATE . '/.secret');
define('GG_ADMIN',   GG_PRIVATE . '/.adminpass');

/* Turn on to make api/data.php withhold the archive until a question is
   answered. Also add the data.json deny rule in the root .htaccess, or the
   file stays reachable directly and the gate means nothing. */
define('GG_GATE', false);

define('GG_MAX_BODY', 12 * 1024 * 1024);             // 12 MB per request
define('GG_COOKIE_ACCESS', 'gg_access');
define('GG_COOKIE_ADMIN',  'gg_admin');

const GG_IMAGE_EXT = ['jpg','jpeg','png','gif','webp','avif','svg'];

/* ---- output ------------------------------------------------------------- */

function gg_json($data, int $status = 200): void {
    if (!headers_sent()) {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
    }
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function gg_fail(string $msg, int $status = 400): void {
    gg_json(['ok' => false, 'error' => $msg], $status);
}

/** Body of a POST, decoded. Rejects anything oversized or not JSON. */
function gg_body(): array {
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') gg_fail('POST only', 405);
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') gg_fail('empty request');
    if (strlen($raw) > GG_MAX_BODY) gg_fail('request too large', 413);
    $data = json_decode($raw, true);
    if (!is_array($data)) gg_fail('expected JSON');
    return $data;
}

function gg_require_post(): void {
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') gg_fail('POST only', 405);
}

/* ---- data.json ---------------------------------------------------------- */

function gg_read_data(): array {
    if (!is_file(GG_DATA)) gg_fail('data.json is missing', 500);
    $raw = file_get_contents(GG_DATA);
    $d = json_decode((string)$raw, true);
    if (!is_array($d)) gg_fail('data.json is not valid JSON', 500);
    return $d;
}

/** Write atomically, keeping the last 20 snapshots. */
function gg_write_data(array $data): void {
    if (!is_writable(GG_ROOT) && !is_writable(GG_DATA)) {
        gg_fail('data.json is not writable — give the folder write permission (755 or 775)', 500);
    }
    if (!is_dir(GG_BACKUPS)) @mkdir(GG_BACKUPS, 0775, true);
    if (is_dir(GG_BACKUPS) && is_file(GG_DATA)) {
        @copy(GG_DATA, GG_BACKUPS . '/data-' . date('Ymd-His') . '.json');
        $old = glob(GG_BACKUPS . '/data-*.json') ?: [];
        sort($old);
        foreach (array_slice($old, 0, max(0, count($old) - 20)) as $f) @unlink($f);
    }

    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if ($json === false) gg_fail('could not encode the data', 500);

    $tmp = GG_DATA . '.tmp' . bin2hex(random_bytes(4));
    if (file_put_contents($tmp, $json . "\n", LOCK_EX) === false) {
        gg_fail('could not write data.json — check folder permissions', 500);
    }
    if (!rename($tmp, GG_DATA)) { @unlink($tmp); gg_fail('could not replace data.json', 500); }
    @chmod(GG_DATA, 0664);
}

/* ---- answer matching -----------------------------------------------------
   This MUST agree character-for-character with normalise() in gate.js,
   admin.js and join.js. If it drifts, every saved answer stops matching.   */

function gg_normalise($s): string {
    $s = (string)$s;

    if (class_exists('Normalizer')) {
        $n = Normalizer::normalize($s, Normalizer::FORM_KD);
        if (is_string($n)) $s = $n;
    } else {
        /* No intl on this host. Fold the accents we can hit by hand rather
           than trusting iconv//TRANSLIT, which differs between systems. */
        $s = strtr($s, [
            'á'=>'a','à'=>'a','â'=>'a','ä'=>'a','ã'=>'a','å'=>'a','Á'=>'A','À'=>'A','Â'=>'A','Ä'=>'A','Ã'=>'A','Å'=>'A',
            'é'=>'e','è'=>'e','ê'=>'e','ë'=>'e','É'=>'E','È'=>'E','Ê'=>'E','Ë'=>'E',
            'í'=>'i','ì'=>'i','î'=>'i','ï'=>'i','Í'=>'I','Ì'=>'I','Î'=>'I','Ï'=>'I',
            'ó'=>'o','ò'=>'o','ô'=>'o','ö'=>'o','õ'=>'o','Ó'=>'O','Ò'=>'O','Ô'=>'O','Ö'=>'O','Õ'=>'O',
            'ú'=>'u','ù'=>'u','û'=>'u','ü'=>'u','Ú'=>'U','Ù'=>'U','Û'=>'U','Ü'=>'U',
            'ñ'=>'n','Ñ'=>'N','ç'=>'c','Ç'=>'C','ý'=>'y','ÿ'=>'y','Ý'=>'Y',
        ]);
    }

    /* drop combining marks — the same U+0300–U+036F range the JS strips */
    $stripped = preg_replace('/[\x{0300}-\x{036F}]/u', '', $s);
    if (is_string($stripped)) $s = $stripped;

    $s = function_exists('mb_strtolower') ? mb_strtolower($s, 'UTF-8') : strtolower($s);

    /* capitals, spaces and punctuation all stop mattering */
    $out = preg_replace('/[^a-z0-9]+/', '', $s);
    return is_string($out) ? $out : '';
}

function gg_answer_hash($answer): string {
    return 'sha256:' . hash('sha256', gg_normalise($answer));
}

/* ---- signing key + cookies ---------------------------------------------- */

function gg_secret(): string {
    if (!is_file(GG_SECRET)) {
        $key = random_bytes(32);
        if (@file_put_contents(GG_SECRET, $key) === false) {
            gg_fail('cannot create .secret — the site folder is not writable', 500);
        }
        @chmod(GG_SECRET, 0600);
        return $key;
    }
    return (string)file_get_contents(GG_SECRET);
}

function gg_set_cookie(string $name, string $value, int $maxAge): void {
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
          || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    setcookie($name, $value, [
        'expires'  => time() + $maxAge,
        'path'     => '/',
        'httponly' => true,          // JavaScript can never read it
        'samesite' => 'Lax',
        'secure'   => $https,
    ]);
}

/* ---- the visitor gate --------------------------------------------------- */

function gg_access_token(): string {
    return hash_hmac('sha256', 'greygoose-access-v1', gg_secret());
}

function gg_is_unlocked(): bool {
    if (!GG_GATE) return true;
    $got = $_COOKIE[GG_COOKIE_ACCESS] ?? '';
    return is_string($got) && $got !== '' && hash_equals(gg_access_token(), $got);
}

/* ---- the admin password ------------------------------------------------- */

function gg_admin_configured(): bool { return is_file(GG_ADMIN); }

function gg_set_admin_password(string $pw): void {
    $salt = bin2hex(random_bytes(16));
    $line = $salt . '$' . hash('sha256', $salt . $pw);
    if (@file_put_contents(GG_ADMIN, $line) === false) {
        gg_fail('could not save the password — the site folder is not writable', 500);
    }
    @chmod(GG_ADMIN, 0600);
}

function gg_check_admin_password(string $pw): bool {
    if (!gg_admin_configured()) return false;
    $line = trim((string)file_get_contents(GG_ADMIN));
    if (strpos($line, '$') === false) return false;
    [$salt, $digest] = explode('$', $line, 2);
    return hash_equals($digest, hash('sha256', $salt . $pw));
}

/** Bound to the stored password, so changing it signs everyone out. */
function gg_admin_token(): string {
    return hash_hmac('sha256', 'admin:' . (string)@file_get_contents(GG_ADMIN), gg_secret());
}

function gg_is_admin(): bool {
    if (!gg_admin_configured()) return true;      // nothing set yet
    $got = $_COOKIE[GG_COOKIE_ADMIN] ?? '';
    return is_string($got) && $got !== '' && hash_equals(gg_admin_token(), $got);
}

function gg_require_admin(): void {
    if (!gg_is_unlocked()) gg_fail('locked', 403);
    if (!gg_is_admin())    gg_fail('admin', 401);
}

/* ---- uploads ------------------------------------------------------------ */

/** Reduce any uploaded name to a harmless flat filename, or null. */
function gg_safe_name(?string $name): ?string {
    $name = basename((string)$name);
    $ext  = strtolower((string)pathinfo($name, PATHINFO_EXTENSION));
    if (!in_array($ext, GG_IMAGE_EXT, true)) return null;
    $stem = (string)pathinfo($name, PATHINFO_FILENAME);
    $stem = strtolower((string)preg_replace('/[^A-Za-z0-9_-]+/', '-', $stem));
    $stem = trim($stem, '-');
    if ($stem === '') $stem = 'photo';
    return substr($stem, 0, 60) . '.' . $ext;
}

/** Decode a data: URL and drop it in photos/, never overwriting. */
function gg_store_data_url(string $dataUrl, ?string $name, string $prefix = ''): ?string {
    if (strpos($dataUrl, 'data:') !== 0) return null;
    $comma = strpos($dataUrl, ',');
    if ($comma === false) return null;

    $bytes = base64_decode(substr($dataUrl, $comma + 1), true);
    if ($bytes === false || $bytes === '' || strlen($bytes) > GG_MAX_BODY) return null;

    $file = gg_safe_name($name);
    if ($file === null) return null;

    if (!is_dir(GG_PHOTOS) && !@mkdir(GG_PHOTOS, 0775, true)) return null;
    if (!is_writable(GG_PHOTOS)) return null;

    $stem = $prefix . (string)pathinfo($file, PATHINFO_FILENAME);
    $ext  = '.' . (string)pathinfo($file, PATHINFO_EXTENSION);
    $final = $stem . $ext;
    for ($n = 2; file_exists(GG_PHOTOS . '/' . $final); $n++) $final = $stem . '-' . $n . $ext;

    if (@file_put_contents(GG_PHOTOS . '/' . $final, $bytes) === false) return null;
    @chmod(GG_PHOTOS . '/' . $final, 0664);
    return 'photos/' . $final;
}
