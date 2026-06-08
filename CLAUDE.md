# vibeshare

一行命令把本地 HTML 页面变成**可管理的公开链接**：开启/关闭、密码/邮箱访问门禁、定时自动关闭。解决 vibe coding 本地做完 HTML 想分享/手机预览/控权限的痛点。

## 目标
让任何人 `npm i -g vibeshare` 后，把本地页面发成公开 URL，并像 Google 文档共享那样管理：所有人可看 / 密码 / 指定邮箱 / 邮箱+密码；随时开启关闭；到期默认关闭（不删）。本地文件始终是源头，对作者零成本零运维（自带 Firebase）。

## 架构（v0.2 — managed 模型）
- **形态**：Node ESM CLI（npm 包，无构建）+ 薄 Claude Code Skill 包装（`skill/SKILL.md`）
- **后端**：自带 Firebase Hosting，页面在**根域名路径** `https://<project>.web.app/<slug>/`（不再用 v0.1 的预览频道——频道是 hash 子域名、手机 DNS 易解析失败，且封顶 30 天、无法做"关闭不删/任意时长/访问门禁"）
- **真相源**：本地工作区 `~/.local/share/vibeshare/` 的 `manifest.json`。每次变更 → 按 manifest 重建 `public/` → 全量 `firebase deploy`（替换整站，所以要专用一个项目）
- **两条正交轴**：status（enabled/disabled）× access（anyone/password/email/email_password）；外加可选 expire（默认动作=disable，不是 delete）
- **访问门禁**：自研 Web Crypto 模板（AES-256-GCM + PBKDF2-SHA256），客户端解密、明文不下发。password=真加密；email=软门禁（邮箱非秘密）；email+password=推荐
- **依赖**：`firebase-tools` 内置打包；运行时 bin 解析 = `VIBESHARE_FIREBASE_BIN` 覆盖 → bundled → PATH `firebase` 兜底
- **登录态**：复用 firebase-tools 自己的 `~/.config/configstore`，vibeshare 绝不接管 token

```
bin/vibeshare.js   入口（shebang）
src/cli.js         参数解析 + 命令路由（默认命令=share；--password/--pin 为可选值 flag）
src/manage.js      managed 命令全集：share/list/enable/disable/access/expire/keep/rm/open/gc
src/store.js       工作区 + manifest（原子写 + flock 锁 + 路径）
src/render.js      reconcile：按 manifest 重建 public/（明文 / 门禁 / 关闭 stub / landing+404）
src/gate.js        Web Crypto 访问门禁模板 + 关闭 stub + landing（核心安全件）
src/when.js        到期表达式解析（任意时长，相对/绝对；替代 v0.1 的 ttl.js）
src/deploy.js      全量部署 + transact（锁→改 manifest→reconcile→deploy 事务）
src/commands/      init / doctor / cleaner（launchd 后台 gc，opt-in）
src/firebase.js    firebase 子进程封装 + --json 解析 + bin 解析（含 env 覆盖）
src/classify.js    firebase stderr → 稳定错误码   src/channel.js slugify   src/config.js / ui.js
test/pure.test.js  纯逻辑单测（含 when 解析 + gate 加密不泄漏明文）
```

## 关键约束
- **全量部署会替换整站** → vibeshare 独占其 Firebase 项目的 Hosting 站点；每次 deploy 前 `reconcile()` 让 public/ 精确匹配 manifest，拒绝意外空站（但允许删到最后一页 → 只剩 landing）
- **manifest 含明文 PIN**，工作区 `~/.local/share/vibeshare/` chmod 0700/0600，绝不入任何 git
- **门禁明文不下发**：gated 页面只部署密文；原始明文留在 `sources/<slug>.html` 供改/去门禁时重建
- **根 landing/404 不泄漏 slug 列表**
- `--json` 全命令支持（skill 依赖）；并发用 flock 串行化
- 到期任意时长（manifest 自管），`gc` 惰性（任意命令时）+ 可选 launchd 定时；默认到期=关闭
- `init` 必须接住 onboarding 坑：交互登录、多账号 authuser、ToS 403 引导浏览器、Firebase API 未启用

## 命令 & 选项速查
`vibeshare <file.html>`(默认=share) / `list` / `enable` / `disable` / `access` / `expire` / `keep` / `rm` / `open` / `gc` / `cleaner install|uninstall|status` / `init` / `doctor`
访问：`--password [PIN]`（裸 flag 自动生成 4 位）`--email a@b,c@d`（二者并存=邮箱+密码）
`--expire <when>`(30m/2h/3d/2w/裸数字=天/2026-07-01) `--delete`(到期改为删除) `--name/--slug` `--title` `--project/-P` `--force` `--json`
配置：`~/.config/vibeshare/config.json`（`project`+`account`）；工作区：`~/.local/share/vibeshare/`
二期路线：真·邮箱验证（Firebase Auth 邮箱链接登录），需 Auth + 内容移 Firestore/Storage，比客户端门禁重

## 发布 & 分发
- npm 包名 `vibeshare`（账号 andyleimc，发布需 OTP/2FA）；GitHub `andyleimc-source/vibeshare`（public, MIT）
- 改完发新版：`npm version patch && npm publish`（会带上最新 README）
- Andy 本机：`npm link` 上 PATH；skill 在 `~/dotfiles/claude/skills/vibeshare/`（随三台 Mac 同步）

## 关键文件
- `plan.md` — 当前迭代计划
- `progress.md` — 进度流水
- `decision.md` — 架构/选型决策记录
- `bug.md` — 已知问题 & 修复
- `handoff.md` — 会话交接
- 注：上面 5 个是**个人本地过程文档，已 gitignore，不入公开仓库**（保持 npm/GitHub 干净）

## 文档维护规则（无需提醒，主动执行；这 5 个文档只存本地不 commit）
- **修完 bug** → `bug.md`：OPEN 移 FIXED，补现象/根因/修复/日期
- **完成 plan 勾选项 / 阶段性进展** → `progress.md`：追加（日期倒序）
- **做了架构/选型决策** → `decision.md`：追加（决策 + Why + 备选 + 代价 + 日期）
- **新任务 / 里程碑 / scope 变化** → `plan.md`
- **会话结束 / 交接** → 刷新 `handoff.md`
- **发现新 bug 未当场修** → `bug.md` OPEN 区
- 日期用真实当天日期

## 参考
- 仓库：https://github.com/andyleimc-source/vibeshare
- npm：https://www.npmjs.com/package/vibeshare
- Firebase 预览频道：https://firebase.google.com/docs/hosting/test-preview-deploy#preview-channels
