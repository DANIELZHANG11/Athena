## 执行目标

* 将 Docker Desktop (WSL2) 的镜像与缓存迁移至 `F:\DOCKER`。

* 统一镜像拉取域为 `zukubq0aouv2k2.xuanyuan.run`（HTTPS 优先，必要时允许不安全仓库）。

* 自动化执行，无需你手动干预。

## 执行步骤

1. 预检查

* 检查 Docker Desktop 安装与 WSL2 可用性：`docker version`、`wsl -l -v`。

* 创建/确认目录：`F:\DOCKER`。

1. 停机与数据导出

* 停止 Docker：`wsl --shutdown`。

* 导出当前数据：`wsl --export docker-desktop-data F:\DOCKER\docker-desktop-data.tar`。

1. 卸载与重新导入到 F盘

* 卸载旧 data：`wsl --unregister docker-desktop-data`。

* 导入到 F盘：`wsl --import docker-desktop-data F:\DOCKER\wsl\docker-desktop-data F:\DOCKER\docker-desktop-data.tar --version 2`。

1. 私有镜像域配置（两种模式择优或并行）

* 镜像加速/镜像镜像（推荐 HTTPS）：

  * 写入 Docker Engine 配置 JSON：`{"registry-mirrors":["https://zukubq0aouv2k2.xuanyuan.run"]}`。

  * 若仅 HTTP：加入 `"insecure-registries":["zukubq0aouv2k2.xuanyuan.run"]`。

  * 自动重启 Docker Desktop 后端。

* 强制镜像源前缀（Compose）：

  * 在工作区查找 `docker-compose*.yml`，若存在，注入 `.env`：`REGISTRY=zukubq0aouv2k2.xuanyuan.run`。

  * 将镜像名改为 `${REGISTRY}/namespace/image:tag`；批量替换并备份原文件。

  * 自动执行 `docker compose pull` 验证拉取。

1. 仓库登录（如启用鉴权）

* `docker login https://zukubq0aouv2k2.xuanyuan.run`（可从安全存储读取凭据或使用你提供的账号）。

1. 验证

* 基本信息：`docker info`，确认路径已指向新 VHDX。

* 拉取测试：`docker pull zukubq0aouv2k2.xuanyuan.run/library/alpine:3.20`（或你域中已同步的任意镜像）。

* 如存在 Compose：`docker compose up -d` 验证运行。

## 回滚方案

* 停机：`wsl --shutdown`。

* 卸载：`wsl --unregister docker-desktop-data`。

* 重新导入至原位置（或重新安装 Docker Desktop），使用之前导出的 `docker-desktop-data.tar`。

## 备注与风险控制

* 需要你域名已正确部署仓库与证书；否则采用 `insecure-registries`（仅限内网受控环境）。

* 导出文件体积≈现有镜像总大小，F盘需充足空间。

* 若未发现任何 `docker-compose*.yml`，仅进行 Engine 层镜像域配置与迁移；后续如你添加 Compose 文件，我可再自动对齐前缀。

## 确认

* 确认后我将立即执行上述步骤与命令，并在完成后给出验证结果与路径/配置证据。

