<?php
if (function_exists('opcache_reset')) opcache_reset();
/**
 * php-box Admin API
 */

// 会话配置（HttpOnly + SameSite 防篡改）
ini_set('session.cookie_httponly', 1);
ini_set('session.cookie_samesite', 'Strict');
ini_set('session.use_only_cookies', 1);
ini_set('session.cookie_path', '/');
session_start();

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

$action = $_GET['action'] ?? '';

// 验证登录状态
function requireAuth(): void {
    if (empty($_SESSION['authenticated'])) {
        jsonResponse(['ok' => false, 'error' => '未登录'], 401);
    }
}

function getDaemonStatus(): array {
    $file = '/run/php-box/status.json';
    if (!file_exists($file)) {
        return ['state' => 'unknown', 'current' => 'php84', 'current_version' => 'PHP 8.4.x', 'message' => 'daemon not started'];
    }
    $data = json_decode(file_get_contents($file), true);
    return is_array($data) ? $data : ['state' => 'unknown'];
}

function getPHP84Version(): string {
    $out = shell_exec('/usr/bin/php84 -v 2>/dev/null | head -1');
    return $out ? trim($out) : 'PHP 8.4.x';
}

function getPHP74Version(): string {
    $out = shell_exec('/opt/php/bin/php -v 2>/dev/null | head -1');
    return $out ? trim($out) : 'PHP 7.4.x';
}

function jsonResponse(array $data, int $code = 200): void {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

function errorResponse(string $message, int $code = 400): void {
    jsonResponse(['ok' => false, 'error' => $message], $code);
}

function resolvePath(string $relPath): string {
    $basePath = '/var/www/repo';
    $candidate = $basePath . '/' . ltrim($relPath, '/');
    // Use realpath for existing files; fallback for symlinks (including broken)
    $fullPath = realpath($candidate);
    if ($fullPath === false) {
        // Check if it's a symlink (possibly broken)
        if (is_link($candidate) || file_exists($candidate)) {
            $linkTarget = is_link($candidate) ? readlink($candidate) : '';
            $fullPath = $candidate;
        }
    }
    if ($fullPath === false || $fullPath === '' || strpos($fullPath, $basePath) !== 0) {
        errorResponse('Invalid path');
    }
    return $fullPath;
}

function getContainerUptime(): string {
    $startFile = '/run/php-box/start_time';
    if (!file_exists($startFile)) return '刚刚启动';
    $start = (int) trim(file_get_contents($startFile));
    $elapsed = time() - $start;
    if ($elapsed < 60) return '刚刚启动';
    $d = intdiv($elapsed, 86400); $elapsed %= 86400;
    $h = intdiv($elapsed, 3600); $elapsed %= 3600;
    $m = intdiv($elapsed, 60);
    $parts = [];
    if ($d > 0) $parts[] = $d . ' 天';
    if ($h > 0) $parts[] = $h . ' 小时';
    if ($m > 0) $parts[] = $m . ' 分钟';
    return $parts ? implode(' ', $parts) : '刚刚启动';
}

function formatSize(int $bytes): string {
    $units = ['B', 'KB', 'MB', 'GB', 'TB'];
    $i = 0;
    while ($bytes >= 1024 && $i < 4) { $bytes /= 1024; $i++; }
    return round($bytes, 1) . ' ' . $units[$i];
}

function getProcessInfo(): array {
    $procs = [];
    $dirs = glob('/proc/[0-9]*/cmdline');
    sort($dirs);
    foreach ($dirs as $f) {
        $cmd = trim(@file_get_contents($f));
        if (!$cmd) continue;
        $cmd = str_replace("\0", ' ', $cmd);
        if (strpos($cmd, 'php-fpm') === false && strpos($cmd, 'nginx') === false) continue;
        $pid = basename(dirname($f));
        $stat = @file_get_contents('/proc/' . $pid . '/stat');
        $time = '';
        if ($stat) {
            $parts = explode(' ', $stat);
            $clk = isset($parts[21]) && isset($parts[22]) ? (intval($parts[13]) + intval($parts[14])) / 100 : 0;
            $time = sprintf('%d:%02d', intdiv((int)$clk, 60), (int)$clk % 60);
        }
        $name = $pid === '1' ? 'entrypoint' : (strpos($cmd, 'php-fpm') !== false ? 'php-fpm' : 'nginx');
        $procs[] = ['name' => $cmd, 'pid' => $pid];
    }
    return $procs;
}

// 递归删除文件夹（PHP 原生，无需 sudo）
function rrmdir(string $dir): bool {
    if (!is_dir($dir)) return false;
    $items = scandir($dir);
    foreach ($items as $it) {
        if ($it === '.' || $it === '..') continue;
        $p = $dir . '/' . $it;
        if (is_dir($p)) rrmdir($p); else @unlink($p);
    }
    return @rmdir($dir);
}

$method = $_SERVER['REQUEST_METHOD'];

// 鉴权中间件（login/logout/check_login 公开）
if (!in_array($action, ['login', 'logout', 'check_login'], true)) {
    requireAuth();
}

try {
    switch ($action) {

        // ============================
        // POST /api?action=login
        // ============================
        case 'login':
            if ($method !== 'POST') errorResponse('Method not allowed', 405);
            $input = json_decode(file_get_contents('php://input'), true);
            $user = $input['username'] ?? '';
            $pass = $input['password'] ?? '';
            $adminUser = getenv('ADMIN_USER') ?: 'admin';
            $adminPass = getenv('ADMIN_PASS') ?: 'admin';
            if ($user === $adminUser && $pass === $adminPass) {
                $_SESSION['authenticated'] = true;
                $_SESSION['login_time'] = time();
                session_regenerate_id(true);
                jsonResponse(['ok' => true]);
            } else {
                jsonResponse(['ok' => false, 'error' => '用户名或密码错误'], 401);
            }
            break;

        // ============================
        // GET /api?action=logout
        // ============================
        case 'logout':
            $_SESSION = [];
            session_destroy();
            jsonResponse(['ok' => true]);
            break;

        // ============================
        // GET /api?action=check_login
        // ============================
        case 'check_login':
            jsonResponse(['ok' => true, 'authenticated' => !empty($_SESSION['authenticated'])]);
            break;



        // ============================
        // GET /api?action=status
        // ============================
        case 'status':
            $status = getDaemonStatus();
            $loadAvg = sys_getloadavg();
            $loadStr = $loadAvg ? implode(', ', array_map(fn($v) => number_format($v, 2), $loadAvg)) : '-';
            $uptimeStr = getContainerUptime();
            $cpuCores = (int)(trim(`nproc`) ?: '1');
            $cpuPct = $loadAvg ? min(round(($loadAvg[0] / max($cpuCores, 1)) * 100), 100) : 0;
            $memTotal = trim(`free -m | awk 'NR==2{print $2}'`) ?: '0';
            $memUsed  = trim(`free -m | awk 'NR==2{print $3}'`) ?: '0';
            $diskFree = disk_free_space('/var/www/repo') ?: 0;
            $diskTotal = disk_total_space('/var/www/repo') ?: 0;
            $diskUsed = $diskTotal - $diskFree;

            jsonResponse([
                'ok' => true,
                'current' => $status,
                'versions' => [
                    'php74' => [
                        'version' => getPHP74Version(),
                        'bin' => '/opt/php/sbin/php-fpm',
                        'available' => file_exists('/opt/php/sbin/php-fpm'),
                    ],
                    'php84' => [
                        'version' => getPHP84Version(),
                        'bin' => '/usr/sbin/php-fpm84',
                        'available' => file_exists('/usr/sbin/php-fpm84'),
                    ],
                ],
                'load'   => $loadStr,
                'load_pct' => $cpuPct,
                'load_color' => $cpuPct > 80 ? 'red' : ($cpuPct > 50 ? 'orange' : 'green'),
                'cpu_cores' => $cpuCores,
                'uptime' => $uptimeStr,
                'memory' => sprintf('%.1fGB / %.1fGB', $memUsed / 1024, $memTotal / 1024),
                'disk'   => formatSize($diskUsed) . ' / ' . formatSize($diskTotal),
                'procs'  => getProcessInfo(),
            ]);
            break;

        // ============================
        // POST /api?action=switch
        // ============================
        case 'switch':
            if ($method !== 'POST') errorResponse('Method not allowed', 405);
            $input = json_decode(file_get_contents('php://input'), true);
            $version = $input['version'] ?? '';
            if (!in_array($version, ['php74', 'php84'])) {
                errorResponse('Invalid version, must be php74 or php84');
            }
            $requestFile = '/run/php-box/switch-request';
            if (!file_exists($requestFile)) {
                errorResponse('Daemon not ready');
            }
            $ts = time();
            file_put_contents($requestFile, "$ts $version", LOCK_EX);
            jsonResponse(['ok' => true, 'message' => "Switch to $version requested"]);
            break;

        // ============================
        // GET /api?action=phpinfo
        // ============================
        case 'phpinfo':
            $status = getDaemonStatus();
            $current = $status['current'] ?? 'php84';
            $phpBin = ($current === 'php74') ? '/opt/php/bin/php' : '/usr/bin/php84';
            $modules = [];
            $out = shell_exec("$phpBin -m 2>/dev/null");
            $lines = explode("\n", trim($out ?? ''));
            $inSection = false;
            foreach ($lines as $line) {
                $line = trim($line);
                if ($line === '[PHP Modules]') { $inSection = true; continue; }
                if ($line === '[Zend Modules]') { $inSection = false; continue; }
                if ($inSection && $line) $modules[] = $line;
            }
            jsonResponse([
                'ok' => true,
                'current_version' => $current,
                'version_string' => trim(shell_exec("$phpBin -v 2>/dev/null | head -1") ?? ''),
                'modules' => $modules,
            ]);
            break;

        // ============================
        // GET /api?action=files
        // ============================
        case 'files':
            $basePath = '/var/www/repo';
            $relPath = $_GET['path'] ?? '';
            $fullPath = realpath($basePath . '/' . ltrim($relPath, '/'));
            if ($fullPath === false || strpos($fullPath, $basePath) !== 0) {
                errorResponse('Invalid path');
            }
            $sorted = [];
            $dir = new DirectoryIterator($fullPath);
            foreach ($dir as $item) {
                if ($item->isDot()) continue;

                $realPath = $item->getPathname();
                $perms = '-';
                try { $perms = substr(sprintf('%o', fileperms($realPath)), -4); } catch (Exception $e) {}
                $mtime = null;
                try { $mtime = $item->getMTime(); } catch (Exception $e) {}
                $sorted[] = [
                    'name'    => $item->getFilename(),
                    'path'    => str_replace($basePath, '', $realPath),
                    'is_dir'  => $item->isDir(),
                    'size'    => $item->isFile() ? $item->getSize() : 0,
                    'size_hr' => $item->isFile() ? formatSize($item->getSize()) : '-',
                    'mtime'   => $mtime,
                    'mtime_hr'=> $mtime ? date('Y-m-d H:i:s', $mtime) : '-',
                    'perms'   => $perms,
                ];
            }
            usort($sorted, fn($a, $b) =>
                $a['is_dir'] !== $b['is_dir'] ? ($a['is_dir'] ? -1 : 1)
                : strcasecmp($a['name'], $b['name'])
            );
            jsonResponse(['ok' => true, 'path' => $relPath ?: '/', 'files' => $sorted]);
            break;

        // ============================
        // GET /api?action=read
        // ============================
        case 'read':
            $relPath = $_GET['path'] ?? '';
            $fullPath = resolvePath($relPath);
            if (!is_file($fullPath)) {
                if (is_link($fullPath) || file_exists($fullPath)) {
                    // symlink or other special file
                } else {
                    errorResponse('Not a file', 404);
                }
            }
            $ext = strtolower(pathinfo($fullPath, PATHINFO_EXTENSION));
            $binaryExts = ['jpg','jpeg','png','gif','webp','ico','zip','tar','gz','mp4','pdf','woff','woff2','ttf','eot'];
            if (in_array($ext, $binaryExts)) {
                $size = filesize($fullPath);
                jsonResponse([
                    'ok' => true, 'path' => $relPath,
                    'binary' => true, 'mime' => mime_content_type($fullPath) ?: 'application/octet-stream',
                    'size' => $size, 'base64' => base64_encode(file_get_contents($fullPath))
                ]);
            } else {
                jsonResponse(['ok' => true, 'path' => $relPath, 'content' => file_get_contents($fullPath)]);
            }
            break;

        // ============================
        // POST /api?action=write
        // ============================
        case 'write':
            if ($method !== 'POST') errorResponse('Method not allowed', 405);
            $input = json_decode(file_get_contents('php://input'), true);
            $basePath = '/var/www/repo';
            $relPath = $input['path'] ?? '';
            $dir = realpath(dirname($basePath . '/' . ltrim($relPath, '/')));
            if ($dir === false || strpos($dir, $basePath) !== 0) errorResponse('Invalid path');
            $writePath = $dir . '/' . basename($relPath);
            // 处理软链接：先删掉再写真实文件
            if (is_link($writePath)) {
                @unlink($writePath);
            }
            $content = $input['content'] ?? '';
            $bytes = @file_put_contents($writePath, $content, LOCK_EX);
            if ($bytes === false) errorResponse('Write failed', 500);
            jsonResponse(['ok' => true, 'path' => $relPath, 'bytes' => $bytes]);
            break;

        // ============================
        // POST /api?action=mkdir
        // ============================
        case 'mkdir':
            if ($method !== 'POST') errorResponse('Method not allowed', 405);
            $input = json_decode(file_get_contents('php://input'), true);
            $relPath = $input['path'] ?? '';
            $basePath = '/var/www/repo';
            $fullPath = $basePath . '/' . ltrim($relPath, '/');
            // resolve parent
            $parent = realpath(dirname($fullPath));
            if ($parent === false || strpos($parent, $basePath) !== 0) errorResponse('Invalid path');
            if (file_exists($fullPath)) errorResponse('Already exists');
            if (!@mkdir($fullPath, 0755)) errorResponse('Failed to create directory', 500);
            jsonResponse(['ok' => true, 'path' => $relPath]);
            break;

        // ============================
        // POST /api?action=delete
        // ============================
        case 'delete':
            if ($method !== 'POST') errorResponse('Method not allowed', 405);
            $input = json_decode(file_get_contents('php://input'), true);
            $relPath = $input['path'] ?? '';
            $fullPath = resolvePath($relPath);
            if (is_file($fullPath)) {
                @unlink($fullPath);
            } elseif (is_dir($fullPath)) {
                if (!rrmdir($fullPath)) errorResponse('Delete failed: directory still exists');
            } else {
                errorResponse('Not found', 404);
            }
            jsonResponse(['ok' => true, 'deleted' => $relPath]);
            break;

        // ============================
        // POST /api?action=upload
        // ============================
        case 'upload':
            if ($method !== 'POST') errorResponse('Method not allowed', 405);
            $relPath = $_POST['path'] ?? '';
            $basePath = '/var/www/repo';
            $fullPath = realpath($basePath . '/' . ltrim($relPath, '/'));
            if ($fullPath === false || strpos($fullPath, $basePath) !== 0) errorResponse('Invalid path');
            if (!$_FILES || !isset($_FILES['file'])) errorResponse('No file uploaded');
            $file = $_FILES['file'];
            if ($file['error'] !== UPLOAD_ERR_OK) errorResponse('Upload error: ' . $file['error']);
            $dest = $fullPath . '/' . basename($file['name']);
            if (move_uploaded_file($file['tmp_name'], $dest)) {
                jsonResponse(['ok' => true, 'path' => $relPath . '/' . basename($file['name']), 'size' => $file['size']]);
            } else {
                errorResponse('Failed to save uploaded file', 500);
            }
            break;

        // ============================
        // GET /api?action=logs
        // ============================
        case 'logs':
            $lines = max(10, min(500, (int)($_GET['lines'] ?? 100)));
            $logType = $_GET['type'] ?? 'php';
            $files = [
                'php'    => '/var/log/php-box/php84-error.log',
                'nginx'  => '/var/log/nginx/error.log',
                'access' => '/var/log/nginx/access.log',
                'daemon' => '/var/log/php-box/daemon.log',
            ];
            $file = $files[$logType] ?? '/var/log/php-box/php84-error.log';
            $output = []; $code = 0;
            $content = '';
            if (file_exists($file)) {
                exec('tail -n ' . intval($lines) . ' ' . escapeshellarg($file) . ' 2>&1', $output, $code);
                $content = trim(implode("\n", $output));
            }
            jsonResponse(['ok' => true, 'file' => $file, 'lines' => intval($lines), 'content' => $content]);
            break;


        // ============================
        // POST /api?action=extract
        // ============================
        
        // ============================
        // POST /api?action=bulk_delete
        // ============================
        case 'bulk_delete':
            if ($method !== 'POST') errorResponse('Method not allowed', 405);
            $input = json_decode(file_get_contents('php://input'), true);
            $basePath = '/var/www/repo';
            $dir = realpath($basePath . '/' . ltrim(($input['path'] ?? ''), '/'));
            if (!$dir || strpos($dir, $basePath) !== 0) errorResponse('Invalid path');
            $files = $input['files'] ?? [];
            $ok = 0; $fail = 0;
            foreach ($files as $f) {
                $target = $dir . '/' . basename($f);
                if (!file_exists($target)) { $fail++; continue; }
                if (is_dir($target)) { rrmdir($target); }
                else { @unlink($target); }
                if (!file_exists($target)) $ok++; else $fail++;
            }
            jsonResponse(['ok' => $fail === 0, 'message' => "Deleted: $ok, failed: $fail"]);
            break;

        case 'extract':
            if ($method !== 'POST') errorResponse('Method not allowed', 405);
            $input = json_decode(file_get_contents('php://input'), true);
            $relPath = $input['filename'] ?? '';
            $basePath = '/var/www/repo';
            $dir = realpath($basePath . '/' . ltrim(($input['path'] ?? ''), '/'));
            if (!$dir || strpos($dir, $basePath) !== 0) errorResponse('Invalid path');
            $archive = $dir . '/' . basename($relPath);
            if (!file_exists($archive)) errorResponse('File not found', 404);
            $password = $input['password'] ?? '';
            $ext = strtolower(pathinfo($archive, PATHINFO_EXTENSION));
            $output = []; $code = 0;
            if ($ext === 'zip') {
                $cmd = 'unzip -o ' . escapeshellarg($archive) . ' -d ' . escapeshellarg($dir) . ' 2>&1';
                if ($password) $cmd = 'unzip -o -P ' . escapeshellarg($password) . ' ' . escapeshellarg($archive) . ' -d ' . escapeshellarg($dir) . ' 2>&1';
                exec($cmd, $output, $code);
            } elseif ($ext === 'gz' || substr($relPath, -7) === '.tar.gz' || substr($relPath, -4) === '.tgz') {
                exec('tar xzf ' . escapeshellarg($archive) . ' -C ' . escapeshellarg($dir) . ' 2>&1', $output, $code);
            } elseif ($ext === 'tar') {
                exec('tar xf ' . escapeshellarg($archive) . ' -C ' . escapeshellarg($dir) . ' 2>&1', $output, $code);
            } elseif ($ext === '7z') {
                $cmd = '7z x ' . escapeshellarg($archive) . ' -o' . escapeshellarg($dir) . ' -y 2>&1';
                if ($password) $cmd = '7z x ' . escapeshellarg($archive) . ' -o' . escapeshellarg($dir) . ' -p' . escapeshellarg($password) . ' -y 2>&1';
                exec($cmd, $output, $code);
            } else {
                errorResponse('Unsupported archive format: ' . $ext);
            }
            if ($code === 0) {
                jsonResponse(['ok' => true, 'message' => '解压完成', 'output' => implode("\n", $output)]);
            } else {
                jsonResponse(['ok' => false, 'error' => '解压失败', 'output' => implode("\n", $output)]);
            }
            break;

        // ============================
        // POST /api?action=extract_upload (upload + extract)
        // ============================
        case 'extract_upload':
            if ($method !== 'POST') errorResponse('Method not allowed', 405);
            if (!$_FILES || !isset($_FILES['file'])) errorResponse('No file uploaded');
            $file = $_FILES['file'];
            if ($file['error'] !== UPLOAD_ERR_OK) errorResponse('Upload error: ' . $file['error']);
            $basePath = '/var/www/repo';
            $relPath = ltrim(($_POST['path'] ?? ''), '/');
            $dir = realpath($basePath . '/' . $relPath);
            if (!$dir || strpos($dir, $basePath) !== 0) errorResponse('Invalid path');
            $dest = $dir . '/' . basename($file['name']);
            if (!move_uploaded_file($file['tmp_name'], $dest)) errorResponse('Save failed', 500);
            // 执行解压
            $output = []; $code = 0;
            $archive = $dest;
            $ext = strtolower(pathinfo($archive, PATHINFO_EXTENSION));
            if ($ext === 'zip') {
                exec('unzip -o ' . escapeshellarg($archive) . ' -d ' . escapeshellarg($dir) . ' 2>&1', $output, $code);
            } elseif ($ext === 'gz' || substr($dest, -7) === '.tar.gz' || substr($dest, -4) === '.tgz') {
                exec('tar xzf ' . escapeshellarg($archive) . ' -C ' . escapeshellarg($dir) . ' 2>&1', $output, $code);
            } elseif ($ext === 'tar') {
                exec('tar xf ' . escapeshellarg($archive) . ' -C ' . escapeshellarg($dir) . ' 2>&1', $output, $code);
            } elseif ($ext === '7z') {
                exec('7z x ' . escapeshellarg($archive) . ' -o' . escapeshellarg($dir) . ' -y 2>&1', $output, $code);
            } else {
                @unlink($dest);
                errorResponse('Unsupported archive format: ' . $ext);
            }
            @unlink($dest);
            if ($code === 0) {
                jsonResponse(['ok' => true, 'message' => '解压完成']);
            } else {
                jsonResponse(['ok' => false, 'error' => '解压失败', 'output' => implode("\n", $output)]);
            }
            break;

        // ============================
        // POST /api?action=move
        // ============================
        case 'move':
            if ($method !== 'POST') errorResponse('Method not allowed', 405);
            $input = json_decode(file_get_contents('php://input'), true);
            $basePath = '/var/www/repo';
            $files = $input['files'] ?? [];
            $target = ltrim($input['target'] ?? '', '/');
            $targetDir = realpath($basePath . '/' . $target);
            if (!$targetDir || strpos($targetDir, $basePath) !== 0) errorResponse('Invalid target');
            $moved = []; $errors = [];
            foreach ($files as $relPath) {
                $src = resolvePath($relPath);
                if ($src === false) { $errors[] = $relPath . ': not found'; continue; }
                $dest = $targetDir . '/' . basename($src);
                if ($src === $dest) { $moved[] = $relPath; continue; } // 相同目录，跳过
                if (rename($src, $dest)) $moved[] = $relPath;
                else $errors[] = $relPath . ': move failed';
            }
            $ok = !empty($moved) && empty($errors);
            jsonResponse(['ok' => $ok, 'moved' => $moved, 'errors' => $errors]);
            break;

        // ============================
        // POST /api?action=copy
        // ============================
        case 'copy':
            if ($method !== 'POST') errorResponse('Method not allowed', 405);
            $input = json_decode(file_get_contents('php://input'), true);
            $basePath = '/var/www/repo';
            $files = $input['files'] ?? [];
            $target = ltrim($input['target'] ?? '', '/');
            $targetDir = realpath($basePath . '/' . $target);
            if (!$targetDir || strpos($targetDir, $basePath) !== 0) errorResponse('Invalid target');
            $copied = []; $errors = [];
            foreach ($files as $relPath) {
                $src = resolvePath($relPath);
                if ($src === false) { $errors[] = $relPath . ': not found'; continue; }
                $base = basename($src);
                $dest = $targetDir . '/' . $base;
                // handle name conflicts
                if (file_exists($dest)) {
                    $i = 1;
                    while (file_exists($targetDir . '/' . pathinfo($base, PATHINFO_FILENAME) . '_' . $i . '.' . pathinfo($base, PATHINFO_EXTENSION))) $i++;
                    $dest = $targetDir . '/' . pathinfo($base, PATHINFO_FILENAME) . '_' . $i . '.' . pathinfo($base, PATHINFO_EXTENSION);
                }
                if (is_dir($src)) {
                    exec('cp -r ' . escapeshellarg($src) . ' ' . escapeshellarg($dest) . ' 2>&1', $out, $code);
                    if ($code === 0) $copied[] = $relPath; else $errors[] = $relPath . ': copy failed';
                } else {
                    if (@copy($src, $dest)) $copied[] = $relPath; else $errors[] = $relPath . ': copy failed';
                }
            }
            jsonResponse(['ok' => empty($errors), 'copied' => $copied, 'errors' => $errors]);
            break;

        // ============================
        // GET /api?action=download
        // ============================
        case 'download':
            $basePath = '/var/www/repo';
            $relPath = $_GET['path'] ?? '';
            $filename = $_GET['filename'] ?? '';
            $filePath = $basePath . '/' . ltrim($relPath, '/') . '/' . basename($filename);
            if (!file_exists($filePath)) errorResponse('File not found', 404);
            header('Content-Type: application/octet-stream');
            header('Content-Disposition: attachment; filename="' . basename($filename) . '"');
            header('Content-Length: ' . filesize($filePath));
            readfile($filePath);
            exit;

        // ============================
        // POST /api?action=rename
        // ============================
        case 'rename':
            if ($method !== 'POST') errorResponse('Method not allowed', 405);
            $input = json_decode(file_get_contents('php://input'), true);
            $basePath = '/var/www/repo';
            $relPath = $input['path'] ?? '';
            $oldName = $input['old_name'] ?? '';
            $newName = $input['new_name'] ?? '';
            if (!$oldName || !$newName) errorResponse('Missing old_name or new_name');
            if (preg_match('/[\\/\0]/', $newName)) errorResponse('Invalid name');
            $parentDir = realpath($basePath . '/' . ltrim($relPath, '/'));
            if (!$parentDir || strpos($parentDir, $basePath) !== 0) errorResponse('Invalid path');
            $oldPath = $parentDir . '/' . basename($oldName);
            $newPath = $parentDir . '/' . basename($newName);
            if (!file_exists($oldPath)) errorResponse('Not found', 404);
            if (file_exists($newPath)) errorResponse('Target already exists');
            if (!rename($oldPath, $newPath)) errorResponse('Rename failed', 500);
            jsonResponse(['ok' => true]);
            break;

        // ============================
        // POST /api?action=archive
        // ============================
        case 'archive':
            if ($method !== 'POST') errorResponse('Method not allowed', 405);
            $input = json_decode(file_get_contents('php://input'), true);
            $basePath = '/var/www/repo';
            $dir = realpath($basePath . '/' . ltrim(($input['path'] ?? ''), '/'));
            if (!$dir || strpos($dir, $basePath) !== 0) errorResponse('Invalid path');
            $files = $input['files'] ?? [];
            $format = $input['format'] ?? 'zip';
            $archiveName = $input['archive_name'] ?? 'archive.' . $format;
            $password = $input['password'] ?? '';
            $items = [];
            foreach ($files as $f) {
                $fPath = $dir . '/' . basename($f);
                if (file_exists($fPath)) $items[] = $fPath;
            }
            if (empty($items)) errorResponse('No valid files to archive');
            $dest = $dir . '/' . basename($archiveName);
            $output = []; $code = 0;
            if ($format === 'zip') {
                $cmd = 'cd ' . escapeshellarg($dir) . ' && zip -r ' . escapeshellarg(basename($archiveName));
                if ($password) $cmd .= ' -P ' . escapeshellarg($password);
                foreach ($files as $f) {
                    if (file_exists($dir . '/' . basename($f))) $cmd .= ' ' . escapeshellarg(basename($f));
                }
                $cmd .= ' 2>&1';
                exec($cmd, $output, $code);
            } elseif ($format === '7z') {
                $cmd = '7z a ' . escapeshellarg($dest);
                if ($password) $cmd .= ' -p' . escapeshellarg($password);
                foreach ($items as $item) $cmd .= ' ' . escapeshellarg($item);
                $cmd .= ' 2>&1';
                exec($cmd, $output, $code);
            } elseif ($format === 'tar' || $format === 'tgz') {
                $tarFile = $format === 'tgz' ? $archiveName : $archiveName;
                $opts = $format === 'tgz' ? 'czf' : 'cf';
                $tarPath = $dir . '/' . basename($tarFile);
                $cmd = 'cd ' . escapeshellarg($dir) . ' && tar ' . $opts . ' ' . escapeshellarg(basename($tarFile));
                foreach ($files as $f) {
                    if (file_exists($dir . '/' . basename($f))) $cmd .= ' ' . escapeshellarg(basename($f));
                }
                $cmd .= ' 2>&1';
                exec($cmd, $output, $code);
            } else {
                errorResponse('Unsupported format: ' . $format);
            }
            if ($code === 0) {
                jsonResponse(['ok' => true, 'path' => $archiveName]);
            } else {
                errorResponse('Archive failed: ' . implode("\n", $output));
            }
            break;

        // ============================
        // POST /api?action=upload_chunk_init
        // ============================
        case 'upload_chunk_init':
            if ($method !== 'POST') errorResponse('Method not allowed', 405);
            $input = json_decode(file_get_contents('php://input'), true);
            $basePath = '/var/www/repo';
            $dir = realpath($basePath . '/' . ltrim(($input['path'] ?? ''), '/'));
            if (!$dir || strpos($dir, $basePath) !== 0) errorResponse('Invalid path');
            $filename = basename($input['filename'] ?? '');
            $totalSize = intval($input['total_size'] ?? 0);
            $uploadId = bin2hex(random_bytes(8));
            $chunkDir = sys_get_temp_dir() . '/' . $uploadId;
            @mkdir($chunkDir, 0755, true);
            jsonResponse(['ok' => true, 'upload_id' => $uploadId, 'chunk_size' => 5*1024*1024, 'total_chunks' => ceil($totalSize / (5*1024*1024))]);
            break;

        // ============================
        // POST /api?action=upload_chunk_part
        // ============================
        case 'upload_chunk_part':
            if ($method !== 'POST') errorResponse('Method not allowed', 405);
            $uploadId = $_POST['upload_id'] ?? '';
            $chunkIndex = intval($_POST['chunk_index'] ?? 0);
            if (!$_FILES || !isset($_FILES['chunk'])) errorResponse('No chunk data');
            $chunkDir = sys_get_temp_dir() . '/' . basename($uploadId);
            if (!is_dir($chunkDir)) errorResponse('Upload session not found', 404);
            $dest = $chunkDir . '/' . $chunkIndex . '.part';
            move_uploaded_file($_FILES['chunk']['tmp_name'], $dest);
            $expectedSize = intval($_POST['chunk_size'] ?? 0);
            if ($expectedSize > 0 && filesize($dest) !== $expectedSize) {
                // Last chunk may be smaller
            }
            jsonResponse(['ok' => true, 'chunk_index' => $chunkIndex]);
            break;

        // ============================
        // POST /api?action=upload_chunk_finish
        // ============================
        case 'upload_chunk_finish':
            if ($method !== 'POST') errorResponse('Method not allowed', 405);
            $input = json_decode(file_get_contents('php://input'), true);
            $uploadId = $input['upload_id'] ?? '';
            $basePath = '/var/www/repo';
            $dir = realpath($basePath . '/' . ltrim(($input['path'] ?? ''), '/'));
            if (!$dir || strpos($dir, $basePath) !== 0) errorResponse('Invalid path');
            $filename = basename($input['filename'] ?? '');
            $chunkDir = sys_get_temp_dir() . '/' . basename($uploadId);
            if (!is_dir($chunkDir)) errorResponse('Upload session not found', 404);
            $parts = glob($chunkDir . '/*.part');
            sort($parts, SORT_NUMERIC);
            $dest = $dir . '/' . $filename;
            // If file exists, add timestamp to name
            if (file_exists($dest)) {
                $info = pathinfo($filename);
                $dest = $dir . '/' . $info['filename'] . '_' . time() . '.' . ($info['extension'] ?? '');
            }
            $out = fopen($dest, 'wb');
            foreach ($parts as $p) {
                fwrite($out, file_get_contents($p));
            }
            fclose($out);
            // Cleanup
            array_map('unlink', glob($chunkDir . '/*'));
            rmdir($chunkDir);
            jsonResponse(['ok' => true, 'path' => str_replace($basePath, '', $dest)]);
            break;

        default:
            errorResponse('Unknown action: ' . $action, 404);
    }
} catch (Throwable $e) {
    errorResponse('Internal error: ' . $e->getMessage(), 500);
}