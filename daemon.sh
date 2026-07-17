#!/bin/sh
set -eu

# =============================================================
# php-box Daemon — 管理 PHP-FPM 版本切换
# =============================================================

run_dir="/run/php-box"
daemon_log="/var/log/php-box/daemon.log"
request_file="$run_dir/switch-request"
status_file="$run_dir/status.json"
current_file="$run_dir/current"
handled_file="$run_dir/handled"

log_info() {
    local ts="$(date '+%Y-%m-%d %H:%M:%S')"
    echo "[$ts] $*" >> "$daemon_log"
}

PHP74_BIN="/opt/php/sbin/php-fpm"
PHP74_CONF="/tmp/php-fpm74.conf"
PHP84_BIN="/usr/sbin/php-fpm84"
PHP84_CONF="/tmp/php-fpm84.conf"

runtime_bin() {
    case "$1" in
        php74) echo "$PHP74_BIN" ;;
        php84) echo "$PHP84_BIN" ;;
        *) return 1 ;;
    esac
}

runtime_conf() {
    case "$1" in
        php74) echo "$PHP74_CONF" ;;
        php84) echo "$PHP84_CONF" ;;
        *) return 1 ;;
    esac
}

runtime_version() {
    case "$1" in
        php74) echo "PHP 7.4.33" ;;
        php84) echo "PHP 8.4.x" ;;
        *) echo "unknown" ;;
    esac
}

write_status() {
    local state="$1" target="$2" message="$3"
    local current="$(cat "$current_file" 2>/dev/null || echo "")"
    local ts="$(date +%s)"
    local ver="$(runtime_version "$target")"
    local cur_ver="$(runtime_version "$current")"
    printf '{"state":"%s","target":"%s","target_version":"%s","current":"%s","current_version":"%s","message":"%s","time":%s}\n' \
        "$state" "$target" "$ver" "$current" "$cur_ver" "$message" "$ts" > "$status_file"
    chmod 664 "$status_file" 2>/dev/null || true
}

stop_all_fpm() {
    log_info "Stopping all PHP-FPM processes"
    # 停 php-fpm7
    if [ -f "$run_dir/php74-fpm.pid" ]; then
        pid=$(cat "$run_dir/php74-fpm.pid" 2>/dev/null || true)
        [ -n "${pid:-}" ] && kill "$pid" 2>/dev/null || true
    fi
    # 停 php-fpm84
    if [ -f "$run_dir/php84-fpm.pid" ]; then
        pid=$(cat "$run_dir/php84-fpm.pid" 2>/dev/null || true)
        [ -n "${pid:-}" ] && kill "$pid" 2>/dev/null || true
    fi
    # 通杀
    pkill -TERM php-fpm php-fpm84 2>/dev/null || true
    sleep 0.5
    pkill -KILL php-fpm php-fpm84 2>/dev/null || true
    rm -f "$run_dir"/*.sock "$run_dir"/*.pid
}

start_fpm() {
    local target="$1"
    local bin="$(runtime_bin "$target")"
    local conf="$(runtime_conf "$target")"

    if [ ! -x "$bin" ]; then
        write_status error "$target" "binary not found: $bin"
        return 66
    fi
    if [ ! -f "$conf" ]; then
        write_status error "$target" "config not found: $conf"
        return 66
    fi

    # 判断 PHP 版本
    local sock_name="${target}.sock"
    local pid_name="${target}-fpm.pid"

    "$bin" -F -y "$conf" &
    local pid=$!

    log_info "Starting PHP-FPM: $target (PID $pid)"
    # 等待 socket 出现
    for _ in $(seq 1 50); do
        if [ -S "$run_dir/$sock_name" ] && kill -0 "$pid" 2>/dev/null; then
            echo "$target" > "$current_file"
            ln -sf "$run_dir/$sock_name" "$run_dir/php-fpm.sock"
            log_info "$target socket ready at $run_dir/$sock_name"
            write_status running "$target" "switched to $target"
            return 0
        fi
        if ! kill -0 "$pid" 2>/dev/null; then
            break
        fi
        sleep 0.1
    done
    write_status error "$target" "php-fpm failed to start"
    return 70
}

switch_to() {
    local target="$1"
    local current="$(cat "$current_file" 2>/dev/null || true)"
    log_info "Switch requested: $target (current=$current)"

    case "$target" in
        php74|php84) ;;
        *) write_status error "$target" "invalid target"; return 64 ;;
    esac

    # 检查是否真的在运行（socket + PID 双验证）
    local pid_file="$run_dir/${target}-fpm.pid"
    local is_alive=false
    if [ -S "$run_dir/$target.sock" ] && [ -f "$pid_file" ]; then
        local old_pid=$(cat "$pid_file" 2>/dev/null || echo 0)
        if [ "$old_pid" -gt 0 ] 2>/dev/null && kill -0 "$old_pid" 2>/dev/null; then
            is_alive=true
        fi
    fi
 if [ "$current" = "$target" ] && $is_alive; then
        log_info "Already active: $target (PID $old_pid alive)"
        write_status running "$target" "already active"
        return 0
    fi
    # 清理残留的 socket 文件
    log_info "Cleaning stale sockets for $target"
    rm -f "$run_dir/$target.sock" "$run_dir/$pid_file"

    write_status switching "$target" "switching to $target"
    stop_all_fpm
    sleep 0.3
    start_fpm "$target"
}

# 初始化
mkdir -p "$run_dir"
touch "$request_file" "$status_file" "$current_file" "$handled_file"
chmod 755 "$run_dir"
touch "$daemon_log" 2>/dev/null || true
chmod 644 "$daemon_log" 2>/dev/null || true
chmod 666 "$request_file" "$status_file" "$current_file" "$handled_file" 2>/dev/null || true

log_info "=== Daemon started, default: ${1:-php84} ==="
# 启动默认版本
switch_to "${1:-php84}" || true

# 主循环 — 监听切换请求
while :; do
    req="$(cat "$request_file" 2>/dev/null || true)"
    seen="$(cat "$handled_file" 2>/dev/null || true)"
    if [ -n "$req" ] && [ "$req" != "$seen" ]; then
        sleep 0.5
        echo "$req" > "$handled_file"
        target="${req##* }"
        switch_to "$target" || true
    fi
    sleep 0.5
done