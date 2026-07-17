# 📦 php-box

> 多版本 PHP 运行环境容器。支持 PHP 7.4 + 8.4 一键切换，带 Web 管理后台（文件管理、在线编辑、日志查看）。

---

## 🚀 快速开始

### 前置要求

- Docker 24+
- Docker Compose（通常随 Docker 一起安装）

### 启动

```bash
# 克隆或进入项目目录
cd php-box

# 构建并启动
docker compose up -d --build
```

### 访问

| 端口 | 用途 | 说明 |
|------|------|------|
| `5080` | 🐘 **PHP 站点** | 放 PHP 文件到这里，直接浏览器访问运行 |
| `5090` | 🔧 **管理后台** | 仪表盘、文件管理、PHP 版本切换、日志查看 |

默认登录账号：`admin` / `admin`（通过环境变量 ADMIN_USER / ADMIN_PASS 修改）

---

## 📖 详细使用指南

### 部署 PHP 文件

PHP 文件放在 Docker 命名卷 `php-box_repo` 中，对应容器内 `/var/www/repo`：

```bash
# 方式一：docker cp（快速测试）
docker cp your-file.php php-box:/var/www/repo/

# 方式二：绑定宿主机目录（推荐，方便直接编辑）
# 修改 docker-compose.yml，将卷改为 bind mount：
services:
  php-box:
    volumes:
      - /你的本地路径:/var/www/repo
```

部署后访问 `http://你的IP:5080/your-file.php` 即可运行。

---

### 管理后台（5090）

打开 `http://你的IP:5090`，功能包括：

#### 📊 仪表盘
- 运行状态：当前 PHP 版本、运行时长
- 系统负载：CPU、内存、存储使用率
- 进程列表：运行的 PHP-FPM 和 Nginx 进程
- **一键切换 PHP 7.4 / 8.4**

#### 📁 文件管理
- 目录浏览与导航（面包屑）
- 文件操作：上传、新建、编辑、重命名、移动、删除
- 批量操作：多选 + 批量删除
- 压缩解压：ZIP / 7Z / TAR / TAR.GZ
- 分块上传：大文件自动分片上传
- 在线编辑器：Ace Editor，带查找替换（支持大小写、整词、正则）

#### 📋 日志
- 运行日志（daemon）
- PHP 错误日志
- Nginx 错误日志
- Nginx 访问日志
- 支持自动刷新

---

### 切换 PHP 版本

**方法一：管理后台**
打开 `http://你的IP:5090` → 仪表盘 → 点击版本切换下拉框 → 选择 PHP 7.4 或 8.4

**方法二：环境变量（启动时默认版本）**
```yaml
environment:
  - PHP_DEFAULT=php74  # 或 php84
```

切换原理：Daemon 进程监听切换请求，停掉当前 FPM → 启动目标版本 FPM → Nginx upstream 自动切换 socket。

---

## ⚙️ 配置参考

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `TZ` | `Asia/Shanghai` | 时区 |
| `ADMIN_USER` | `admin` | 管理后台用户名 |
| `ADMIN_PASS` | `admin` | 管理后台密码 |
| `PHP_DEFAULT` | `php84` | 默认 PHP 版本（`php74` 或 `php84`） |

### docker-compose.yml 完整示例

```yaml
services:
  php-box:
    build: .
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
      - ./repo:/var/www/repo   # 绑定本地目录
    restart: unless-stopped
```

---

## 🔐 安全说明

- 管理后台使用 **PHP session 登录验证**，密码仅登录时发送一次
- 支持退出登录（session 销毁）
- 登录后重新生成 session ID，防止 session 固定攻击
- 建议通过反向代理加 HTTPS（见下文）

### 反向代理配置示例（Nginx + HTTPS）

```nginx
server {
    listen 443 ssl;
    server_name admin.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:5090;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
    }
}
```

---

## 🛠 开发信息

### 项目结构

```
php-box/
├── Dockerfile              # 容器构建（Alpine + PHP 7.4/8.4 + Nginx）
├── docker-compose.yml      # 容器编排
├── entrypoint.sh           # 容器入口（初始化 + 启动服务）
├── daemon.sh               # PHP 版本切换守护进程
├── hc.sh                   # 健康检查脚本
├── nginx/
│   └── php-box.conf        # Nginx 配置
├── admin/
│   ├── index.html          # 管理后台页面
│   ├── style.css           # 毛玻璃主题样式
│   ├── app.js              # 前端逻辑
│   ├── api.php             # 后端 API
│   └── qr.png              # 公众号二维码
└── README.md
```

### 技术栈

| 组件 | 版本 |
|------|------|
| 基础镜像 | livecodesvip/php-runtime (Alpine) |
| PHP 7.4 | 7.4.33（来自基础镜像） |
| PHP 8.4 | 8.4.x（Alpine 包） |
| Web 服务器 | Nginx |
| 管理后台 | 原生 HTML + CSS + JS（无框架） |
| 编辑器 | Ace Editor |

---

## ✅ 功能清单

- [x] PHP 7.4.33 + 8.4.x 双版本一键切换
- [x] Web 管理后台（仪表盘 / 文件管理 / 日志）
- [x] 在线编辑器（Ace Editor，查找替换）
- [x] 文件上传（分块上传 + 拖拽）
- [x] 压缩解压（ZIP / 7Z / TAR / TAR.GZ）
- [x] 批量操作
- [x] PHP 模块列表查看
- [x] Nginx + PHP 错误日志查看
- [x] 亮色/暗色主题切换
- [x] 手机响应式布局
- [x] 容器健康检查
- [x] GitHub Pages 前端部署

---

## 📦 相关链接

- GitHub: [kanchairen-d/PHP-Box](https://github.com/kanchairen-d/PHP-Box)
- GitHub Pages 前端: [https://kanchairen-d.github.io/PHP-Box/](https://kanchairen-d.github.io/PHP-Box/)