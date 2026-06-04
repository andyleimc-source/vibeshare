<div align="right"><a href="./README.md">English</a> | 简体中文</div>

# vibeshare

**一行命令，把本地 HTML 文件/目录变成一个带有效期的公开预览链接。**

你用 vibe coding 在本地做好了一个 HTML 页面，现在想给别人看、想在手机上预览、或者丢个链接到群里。`vibeshare` 把它部署成一个真实的公开 URL，并且**过几天自动过期消失**。本地文件始终是源头——链接到期了，你什么也没丢。

```bash
npm install -g vibeshare
vibeshare init                 # 一次性：登录 + 选一个免费的 Firebase 项目
vibeshare ./index.html         # → https://<项目>--<id>-<hash>.web.app （活 7 天）
```

## 为什么用它

- **随处预览** —— 电脑 → 手机，或发给同事/客户。再也不用说"只有我电脑上能看"。
- **天生临时** —— 设个有效期，到期链接自动删除。不留垃圾、不用手动清理。
- **自带 Firebase（免费）** —— 没有中心服务器、没有任何费用、没有第三方替你保管数据。完全跑在你自己免费的 Firebase Hosting（Spark 套餐）上。

## 安装

```bash
npm install -g vibeshare
```

需要 Node 18+。`firebase-tools` 已随包内置，无需额外安装。

## 首次设置（一次即可）

```bash
vibeshare init
```

会在浏览器里登录你的 Google/Firebase，并选择（或帮你创建）一个免费 Firebase 项目。**首次使用 Firebase 的账号**会被引导到 console 接受一次服务条款——这一步只能在浏览器完成。之后就一劳永逸了。

> 多个 Google 账号？`init` 会让你选，并记住账号，之后每次运行都核对，避免发错账号。

## 使用

```bash
vibeshare ./site                 # 部署一个目录（默认 7 天有效期）
vibeshare ./report.html          # 部署单个文件
vibeshare ./index.html --ttl 1d  # 自定义有效期：12h、3d、30d（最大 30 天）
vibeshare ./index.html --open    # 部署完直接在浏览器打开

vibeshare list                   # 查看当前所有链接
vibeshare unshare <id>           # 提前删除某个链接
vibeshare open <id>              # 在浏览器打开某个链接
vibeshare doctor                 # 检查环境配置
```

任意命令加 `--json` 即输出机器可解析的 JSON（Claude Code skill 用的就是它）。

## 原理

`vibeshare` 封装了 [Firebase Hosting **预览频道（preview channels）**](https://firebase.google.com/docs/hosting/test-preview-deploy#preview-channels)——它原生支持过期时间（默认 7 天，最大 30 天）。每次分享就是你项目下的一个频道，到期后 Firebase 自动删除。部署前你的文件会被拷到一个临时目录再发布，所以 **`vibeshare` 绝不会往你的项目目录里写任何 Firebase 配置文件**。

## Claude Code 技能

本仓库自带一个很薄的 Claude Code skill（`skill/SKILL.md`）。软链进你的 skills 目录，Claude 就能帮你分享页面：

```bash
ln -s "$(npm root -g)/vibeshare/skill/SKILL.md" ~/.claude/skills/vibeshare/SKILL.md
```

之后在 Claude Code 里直接说"分享这个页面"即可。

## 许可证

MIT © Andy Lei
