# Herdr Linear

[English](README.md) · 中文

在 Herdr 终端旁查看和创建 Linear issues。每个 space 可绑定一个 project，点 tab bar 右侧的 Linear 即可打开。

![Herdr Linear 列表和详情预览](preview.png)

*列表与详情并排展示，使用演示数据。*

## 安装

把这句话发给运行在 Herdr 中的 agent：

```text
Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/neilforest7/herdr-linear/tree/main
```

需要 macOS 和 Node.js 22+。agent 完成安装后，你只需在浏览器授权 Linear，再在面板选择 project。[详细安装说明](INSTALL.md)。

## 功能

- **按 space 绑定项目。** 也可选择不需要 Linear，切入该 space 时面板自动收起。
- **一眼看清 issues。** 编号、状态与优先级图标、负责人和彩色标签，支持搜索和筛选。
- **面板内查看详情。** 描述、图片、估点、标签和关联关系；点击关联 issue 继续查看，返回或 Escape 回到上一层。
- **创建 issue。** 填写标题、Markdown 描述，选择团队、状态、优先级、项目和彩色标签，添加附件。**More** 提供截止日期、估点、周期、里程碑和父 issue；**Create more** 在创建后保留表单，继续创建下一条。
- **一次授权，持续复用。** 浏览使用 OAuth `read` 权限；首次创建时请求额外的 `write` 授权。凭据保存在 macOS 钥匙串，后续新建、切换 space、重启 Herdr 均会复用，并自动续期；授权失效或被撤销后才需重新授权。面板显示时每分钟刷新。

## 更新

告诉 agent：

```text
Read ~/.config/herdr-app/AGENTS.md, then update my Herdr Linear mod from: https://github.com/neilforest7/herdr-linear/tree/main
```

## 文档

- [安装、授权与开发说明](INSTALL.md)
- [模块结构与行为](RECIPE.md)

按钮和侧栏接入方式参考 [Herdr Issues](https://github.com/jankeesvw/herdr-issues)。采用 [MIT 许可证](LICENSE)。
