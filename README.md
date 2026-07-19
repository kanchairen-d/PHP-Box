# 🐘 PHP-Box

> 多版本 PHP 运行环境容器，带 Web 管理后台。支持 PHP 7.4 + 8.4 一键切换，文件管理、在线编辑、日志查看。

## 部署

### Docker Compose（推荐）

```yaml
services:
  php-box:
    image: ghcr.io/kanchairen-d/php-box:latest
    container_name: php-box
    ports:
      - "5080:5080"   # PHP 站点
      - "5090:5090"   # 管理后台
    environment:
      - TZ=Asia/Shanghai
      - ADMIN_USER=admin
      - ADMIN_PASS=admin
      - PHP_DEFAULT=php84
    volumes:
      - ./repo:/var/www/repo
    restart: unless-stopped
```

启动：

```bash
docker compose up -d
```

### 直接拉取运行

```bash
docker pull ghcr.io/kanchairen-d/php-box:latest

docker run -d \
  --name php-box \
  -p 5080:5080 \
  -p 5090:5090 \
  -e TZ=Asia/Shanghai \
  -e ADMIN_USER=admin \
  -e ADMIN_PASS=admin \
  -e PHP_DEFAULT=php84 \
  -v ./repo:/var/www/repo \
  --restart unless-stopped \
  ghcr.io/kanchairen-d/php-box:latest
```

## 访问

| 端口 | 用途 | 说明 |
|------|------|------|
| `5080` | **PHP 站点** | 放 PHP 文件到这里，浏览器访问运行 |
| `5090` | **管理后台** | 仪表盘、文件管理、PHP 版本切换、日志查看 |

默认登录：`admin` / `admin`（通过环境变量 `ADMIN_USER` / `ADMIN_PASS` 修改）

## 管理后台功能

### 📊 仪表盘
- 运行状态：当前 PHP 版本、运行时长
- 系统负载：CPU、内存、存储使用率
- 一键切换 PHP 7.4 / 8.4

### 📁 文件管理
- 目录浏览与导航
- 文件操作：上传、新建、编辑、重命名、移动、删除
- 批量操作：多选 + 批量删除
- 压缩解压：ZIP / 7Z / TAR / TAR.GZ
- 分块上传：大文件自动分片
- 在线编辑器：Ace Editor，查找替换

### 📋 日志
- 运行日志、PHP 错误日志、Nginx 错误日志、访问日志

## 配置

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `TZ` | `Asia/Shanghai` | 时区 |
| `ADMIN_USER` | `admin` | 管理后台用户名 |
| `ADMIN_PASS` | `admin` | 管理后台密码 |
| `PHP_DEFAULT` | `php84` | 默认 PHP 版本（`php74` / `php84`） |

### 切换 PHP 版本

**管理后台切换：** 打开 `http://IP:5090` → 仪表盘 → 选择版本

**启动默认版本：** 通过环境变量 `PHP_DEFAULT=php74` 或 `PHP_DEFAULT=php84`

## 技术栈

| 组件 | 版本 |
|------|------|
| 基础镜像 | Alpine Linux |
| PHP 7.4 | 7.4.33 |
| PHP 8.4 | 8.4.x |
| Web 服务器 | Nginx |
| 管理后台 | 原生 HTML + CSS + JS |

## 许可证

MIT