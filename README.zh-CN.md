<div align="right"><a href="./README.md">English</a> | 简体中文</div>

# vibeshare

**把本地 HTML 页面变成一个可管理的公开链接——支持开启/关闭、密码或邮箱访问、以及定时自动关闭。**

你用 vibe coding 在本地做好了一个 HTML 页面，现在想给别人看、在手机上预览、加个密码、或者只让某几个人能进。`vibeshare` 把它部署到**你自己的免费 Firebase** 上，并像 Google 文档共享那样管理它：对所有人开放、用密码锁、限定指定邮箱、随时关闭（但不删除）、或设置到期自动关闭。

```bash
npm install -g vibeshare
vibeshare init                            # 一次性：登录 + 选一个免费 Firebase 项目
vibeshare ./report.html                   # → https://<项目>.web.app/report/
vibeshare ./report.html --password        # ……再加一个自动生成的 4 位数字密码
```

## 功能一览

- 🌐 **一条命令部署** —— 把任意本地 `.html` 变成你自己免费 Firebase 上的公开 URL。
- 🔓 **对所有人开放** —— 直接发链接，无门禁。
- 🔑 **密码门禁** —— 自动 4 位 PIN 或自定义密码；页面在浏览器里 AES-256 加密，明文不下发。
- 📧 **邮箱门禁** —— 限定邮箱白名单；或要求**邮箱 + 密码**同时正确。
- 🟢 **随时开启/关闭** —— 关闭后内容仍在本地保留、随时再开，像切换 Google 文档的共享开关。
- ⏰ **定时自动关闭** —— 任意时长（`2h`、`3d`、`2026-07-01`）；到期默认**关闭**（要删才删）。
- 🗑️ **彻底删除** —— 想删随时删。
- 📋 **列出与管理** —— 一眼看到每个页面的开关状态、访问方式、到期时间。
- 🔒 **完全属于你** —— 没有中心服务器、不用在我们这注册、零费用，本地文件始终是源头。

## 为什么用它

- **随处预览** —— 电脑 → 手机，或发给同事/客户。链接在项目根域名上（`<项目>.web.app/<slug>/`），各地解析都稳。
- **像文档一样控权限** —— 所有人可看 / 密码 / 指定邮箱白名单 / 邮箱+密码。一个页面随时在这几种之间切换。
- **能"关闭"而不只是删除** —— 关闭后内容仍在本地保留，随时再开启。到期默认是**关闭**页面（删除永远是你明确的选择）。
- **自带 Firebase（免费）** —— 没有中心服务器、零费用、没有第三方替你保管数据。完全跑在 Firebase Hosting 免费 Spark 套餐上。

## 安装

```bash
npm install -g vibeshare
```

需要 Node 18+。`firebase-tools` 已随包内置。（在极新的 Node 版本上若内置版异常，可设 `VIBESHARE_FIREBASE_BIN=$(which firebase)` 改用系统的 Firebase CLI。）

## 首次设置（一次即可）

```bash
vibeshare init
```

在浏览器里登录 Google/Firebase，并选择（或帮你创建）一个免费项目。首次使用的账号需在浏览器接受一次服务条款。**请给 vibeshare 专门用一个项目**——它会把该项目的 Hosting 站点作为整体来管理。

## 使用

```bash
# 部署
vibeshare ./report.html                          # 所有人可看
vibeshare ./report.html --password               # 自动生成 4 位数字密码
vibeshare ./report.html --password 1234          # 自定义密码
vibeshare ./report.html --email a@x.com,b@y.com  # 仅这些邮箱可进
vibeshare ./report.html --email a@x.com --password 1234   # 邮箱 + 密码
vibeshare ./report.html --expire 3d              # 3 天后自动关闭（也支持 2h、2w、2026-07-01）
vibeshare ./report.html --name launch            # 自定义 slug → /launch/

# 管理
vibeshare list                                   # 所有页面：开启/关闭 · 访问方式 · 到期 · URL
vibeshare disable <slug>                          # 关闭（内容保留）
vibeshare enable  <slug>                          # 重新开启
vibeshare access  <slug> --password 9999          # 随时改访问方式
vibeshare access  <slug> --email a@x.com          # → 切到仅邮箱
vibeshare expire  <slug> 12h                       # 定时自动关闭（加 --delete 则改为删除）
vibeshare keep    <slug>                            # 取消定时
vibeshare rm      <slug>                            # 彻底删除
vibeshare open    <slug>                            # 浏览器打开

# 后台自动到期（可选，macOS）
vibeshare cleaner install                          # 用 launchd 每 15 分钟跑一次 gc
vibeshare gc                                       # 立即应用已到期的页面
```

任意命令加 `--json` 即输出机器可解析的 JSON（Claude Code skill 用的就是它）。

## 访问方式与安全

加密的页面是**在浏览器里解密**的（Web Crypto：AES-256-GCM，密钥用 PBKDF2-SHA256 派生）。明文不会随页面下发——没有正确凭证就读不到内容。

- **密码** —— 真加密保护。4 位数字 PIN 方便，但**可离线暴力破解**（1 万种组合、无服务端限速）；重要内容请用更长的密码。
- **邮箱** —— *软*门禁：邮箱不是秘密，知道某个白名单邮箱的人都能进。适合"只给我的客户看"，不适合保密。
- **邮箱 + 密码** —— 密码提供真正的锁，邮箱用来识别访客。既要门禁又有明确受众时推荐。

> 真·邮箱验证（Google / 邮箱链接登录）在路线图上——它需要 Firebase Authentication，比上面这些客户端门禁要重不少。

## 原理

页面位于 `https://<项目>.web.app/<slug>/`。vibeshare 在本地维护一个工作区（`~/.local/share/vibeshare/`），以 manifest 为唯一真相源、并保留你的原始文件；每次变更都会按 manifest 重建部署目录，再做一次全量 `firebase deploy`。因为部署会替换整个站点，**请给 vibeshare 专用一个 Firebase 项目**。到期信息记在 manifest 里（所以时长不受限，不像 Firebase 预览频道封顶 30 天），由 `vibeshare gc` 应用——任意命令时惰性触发，或用 `vibeshare cleaner install` 定时触发。

## Claude Code 技能

本仓库自带一个很薄的 Claude Code skill（`skill/SKILL.md`）。软链进你的 skills 目录：

```bash
ln -s "$(npm root -g)/vibeshare/skill/SKILL.md" ~/.claude/skills/vibeshare/SKILL.md
```

之后在 Claude Code 里直接说"分享这个页面"即可。

## 许可证

MIT © Andy Lei
