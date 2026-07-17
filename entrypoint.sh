#!/bin/sh
set -euo pipefail

# =============================================================
# php-box Entrypoint
# =============================================================

TZ="${TZ:-Asia/Shanghai}"

# 容器启动时间
mkdir -p /run/php-box
date +%s > /run/php-box/start_time
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-admin}"
PHP_DEFAULT="${PHP_DEFAULT:-php84}"

# 时区
ln -snf "/usr/share/zoneinfo/$TZ" /etc/localtime && echo "$TZ" > /etc/timezone

# 验证管理员密码
if [ -z "$ADMIN_USER" ] || [ -z "$ADMIN_PASS" ]; then
    echo "[FATAL] ADMIN_USER and ADMIN_PASS must be set"
    exit 64
fi

# 密码仅由环境变量控制（PHP session 认证）

# 修复仓库文件所有权（确保 nginx 可读写删除）
chown -R nginx:nginx /var/www/repo
# 覆盖上传大小限制（无限制）
sed -i "s/client_max_body_size 1m;/client_max_body_size 0;/" /etc/nginx/nginx.conf
sed -i "s/^upload_max_filesize = .*/upload_max_filesize = 0/" /etc/php84/php.ini
sed -i "s/^post_max_size = .*/post_max_size = 0/" /etc/php84/php.ini
sed -i "s/^max_execution_time = .*/max_execution_time = 0/" /etc/php84/php.ini
sed -i "s/^max_input_time = .*/max_input_time = 0/" /etc/php84/php.ini
echo "[INFO] Upload limits disabled"

# 生成 PHP-FPM 配置文件
cat > /tmp/php-fpm74.conf <<'PHPFPM74'
[global]
pid = /run/php-box/php74-fpm.pid
error_log = /var/log/php-box/php74-error.log
daemonize = no

[www]
user = nginx
group = nginx
listen = /run/php-box/php74.sock
listen.mode = 0666
pm = dynamic
pm.max_children = 20
pm.start_servers = 2
pm.min_spare_servers = 1
pm.max_spare_servers = 3
php_admin_value[error_log] = /var/log/php-box/php74-error.log
php_admin_flag[log_errors] = on
PHPFPM74

cat > /tmp/php-fpm84.conf <<'PHPFPM84'
[global]
pid = /run/php-box/php84-fpm.pid
error_log = /var/log/php-box/php84-error.log
daemonize = no

[www]
user = nginx
group = nginx
listen = /run/php-box/php84.sock
listen.mode = 0666
pm = dynamic
pm.max_children = 20
pm.start_servers = 2
pm.min_spare_servers = 1
pm.max_spare_servers = 3
php_admin_value[error_log] = /var/log/php-box/php84-error.log
php_admin_flag[log_errors] = on
PHPFPM84

# 启动守护进程（管理 PHP 版本切换）
echo "[INFO] Starting php-box-daemon with default: $PHP_DEFAULT"
php-box-daemon "$PHP_DEFAULT" &
DAEMON_PID=$!

# 启动 Nginx
echo "[INFO] Starting Nginx"
nginx -g 'daemon off;' &
NGINX_PID=$!

# 信号处理
cleanup() {
    echo "[INFO] Shutting down..."
    kill $NGINX_PID 2>/dev/null || true
    kill $DAEMON_PID 2>/dev/null || true
    wait
    exit 0
}
trap cleanup SIGTERM SIGINT

# 等待所有子进程
wait