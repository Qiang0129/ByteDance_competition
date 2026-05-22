# LabelHub Data Annotation Platform

LabelHub 是面向数据标注流程的 Web 平台，当前阶段已完成前端基础路由、登录页、角色工作台骨架、MySQL 初始表结构，以及后端认证/RBAC 的本地演示闭环。

## 环境要求

- Node.js 22+
- npm 10+
- Java 21+
- MySQL 8.0+

当前本地数据库约定：

```text
database: labelhub
username: root
password: 123456
port: 3306
```

## 后端启动

在项目根目录执行：

```powershell
cd backend
$env:LABELHUB_DB_PASSWORD='123456'
.\mvnw.cmd spring-boot:run
```

如果使用 cmd：

```cmd
cd backend
set LABELHUB_DB_PASSWORD=123456
mvnw.cmd spring-boot:run
```

后端默认地址：

```text
http://127.0.0.1:8080
```

看到类似日志即表示启动成功：

```text
Tomcat started on port 8080
Started LabelHubBackendApplication
```

如果提示 `Port 8080 was already in use`，先停止占用端口的旧进程，或改用其他端口启动。

## 前端启动

另开一个终端，在项目根目录执行：

```powershell
cd frontend
npm run dev
```

前端默认地址：

```text
http://localhost:5173
```

Vite 开发代理已将 `/api` 转发到：

```text
http://127.0.0.1:8080
```

因此本地联调时需要先启动后端，再启动前端。

## 演示账号

```text
角色       用户名     密码
owner      owner      owner123
labeler    labeler    labeler123
reviewer   reviewer   reviewer123
```

登录页会调用真实后端接口 `POST /api/auth/login`，登录成功后根据角色进入对应工作台。

## 构建检查

前端构建：

```powershell
cd frontend
npm run build
```

后端构建：

```powershell
cd backend
.\mvnw.cmd -q -DskipTests package
```
