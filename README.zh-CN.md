# Herdr Linear

在 Herdr 终端旁查看 Linear issues 的原生 mod。[English](README.md)

每个 space 可绑定一个 Linear project，也可设为不需要 Linear。列表显示 issue 编号、状态、优先级、负责人和彩色标签；点击后在面板内查看描述、图片、估点和关联关系。返回或 Escape 回到上一层，右上角可打开 Linear 原页。

## 安装

需要 macOS、Node.js 22+、npm，以及运行中的 Herdr；`herdr-app` 须在 PATH 中。已在 Herdr 0.1.13 验证。

```sh
git clone https://github.com/neilforest7/herdr-linear.git
cd herdr-linear
npm ci
node install.mjs
```

安装器会把 mod 复制到 Herdr，向当前布局添加入口和侧栏，并备份布局。支持包含 `tabs`，且有 `panel-body` stack 或 `work-body` row 的布局；默认 `main` 符合要求。内置布局会先克隆。

点 tab bar 右侧的 Linear，在浏览器授权后选择 project。选择页中的“这个 space 不需要绑定 Linear”会记住该设置，以后切入此 space 自动收起面板。手动打开后可重新绑定。

安装后的 mod 会调用这个源码目录里的 helper。移动目录后，需要重新运行安装器。

## 更新

```sh
git pull --ff-only
npm ci
node install.mjs
```

要在其他布局中使用，切到该布局后再次运行安装器。Herdr 更新会保留自建 mod；API 改动可能需要适配。

## 授权和数据

授权通过 [Linear 官方 MCP](https://linear.app/docs/mcp) 的只读入口完成，不需要自行注册 OAuth 应用或填写 API key。OAuth 凭据保存在 macOS 钥匙串的 `Herdr Linear MCP` 条目中；space 绑定保存在 Herdr shared state，helper 路径和图片保存在 Herdr home 的 `data/linear/` 下。登录过程状态保存在 Herdr home 的 `data/linear-auth.json` 中。

远程 space 也使用本机授权。授权无法续期时，在面板中重新授权。移除本机 OAuth 凭据：

```sh
node helper/client.mjs logout
```

也可以在 Linear 中撤销应用访问权限。自定义 Herdr home 时，启动 Herdr 与安装时使用相同的 `HERDR_APP_HOME`。

## 开发

```sh
npm test
herdr-app check mods/linear
```

实现参考 [Herdr Issues](https://github.com/jankeesvw/herdr-issues) 的按钮和侧栏接入方式。采用 [MIT 许可证](LICENSE)。
