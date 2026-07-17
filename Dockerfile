# =============================================================
# php-box — 单阶段构建
# Base: livecodesvip/php-runtime (本地已缓存，含 Alpine + PHP 7.4)
# 添加: PHP 8.4 + Nginx + 管理后台
# =============================================================
FROM livecodesvip/php-runtime:latest

LABEL maintainer="php-box" \
      description="PHP Box - Multi-version PHP Runtime (7.4 + 8.4)" \
      php74="7.4.33" \
      php84="8.4.x"

# 已继承的环境变量（来自 base 镜像）：
#   PATH 已包含 /opt/php/bin:/opt/php/sbin
#   LD_LIBRARY_PATH 已包含 /opt/openssl-1.0.2u/lib:/opt/curl/lib

# 安装 PHP 8.4 + Nginx（Alpine 3.23 apk）
RUN apk add --no-cache \
    php84 \
    php84-fpm \
    php84-curl \
    php84-json \
    php84-mbstring \
    php84-openssl \
    php84-session \
    php84-xml \
    php84-dom \
    php84-xmlreader \
    php84-xmlwriter \
    php84-simplexml \
    php84-fileinfo \
    php84-gd \
    php84-exif \
    php84-zip \
    php84-bz2 \
    php84-ctype \
    php84-iconv \
    php84-pdo \
    php84-sqlite3 \
    php84-mysqli \
    php84-pdo_mysql \
    php84-pdo_sqlite \
    php84-tokenizer \
    php84-phar \
    php84-fileinfo \
    nginx \
    curl \
    wget \
    tzdata && \
    mkdir -p /var/www/repo /var/www/html /var/log/php-box /var/log/nginx /run/php-box /run/nginx && \
    adduser -D -H -s /sbin/nologin nginx 2>/dev/null || true && \
    chown -R nginx:nginx /var/www/repo /var/www/html

# 复制配置和脚本
COPY entrypoint.sh /entrypoint.sh
COPY daemon.sh /usr/local/bin/php-box-daemon
COPY hc.sh /usr/local/bin/php-box-hc
COPY nginx/php-box.conf /etc/nginx/http.d/php-box.conf
COPY admin/ /var/www/html/
RUN mkdir -p /var/www/html/vendor && cp -r /opt/hidden-ui/vendor/ace /var/www/html/vendor/ace

RUN chmod +x /entrypoint.sh /usr/local/bin/php-box-daemon /usr/local/bin/php-box-hc && \
    chown -R nginx:nginx /var/www/html /var/www/repo && chmod -R 755 /var/www/html /var/www/repo

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD /usr/local/bin/php-box-hc

EXPOSE 5090 5080

ENTRYPOINT ["/entrypoint.sh"]