#!/bin/sh
set -eu

# 检查 Nginx 是否活着
wget -qO- http://127.0.0.1:5080/healthz >/dev/null 2>&1 || exit 1

# 检查 PHP-FPM 是否响应
wget -qO- http://127.0.0.1:5090/status.php >/dev/null 2>&1 || exit 1

exit 0