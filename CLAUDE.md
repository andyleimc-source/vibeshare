# vibeshare

一行命令把本地 HTML 文件/目录变成**带有效期的公开预览链接**。解决 vibe coding 本地做完 HTML 想分享/手机预览不便的痛点。

## 目标
让任何人 `npm i -g vibeshare` 后，一条命令把本地页面发成公开 URL，N 天后自动过期消失，本地文件始终是源头。对作者零成本零运维（自带 Firebase）。

## 架构
- **形态**：Node ESM CLI（npm 包，无构建）+ 薄 Claude Code Skill 包装（`skill/SKILL.md`）
- **后端**：自带 Firebase Hosting **预览频道**（BYO-Firebase，无中心服务器）。原生 `--expires`（默认 7d，最大 30d），到期 Firebase 自动删频道 → 无自建清理 infra
- **依赖**：`firebase-tools` 内置打包；运行时 bin 解析顺序 = bundled → PATH 上的 `firebase` 兜底
- **登录态**：复用 firebase-tools 自己的 `~/.config/configstore`，vibeshare 绝不接管 token

```
bin/vibeshare.js   入口（shebang）
src/cli.js         参数解析 + 命令路由（默认命令=share）
src/commands/      share / list / unshare / open / init / doctor
src/firebase.js    firebase 子进程封装 + --json 解析 + bin 解析
src/stage.js       os.tmpdir 临时 staging（关键：绝不污染用户仓库）
src/doctor.js      预检（firebase/登录/项目）
src/classify.js    firebase stderr → 稳定错误码（ToS/API/login/quota...）
src/ttl.js         TTL 解析+钳制   src/channel.js 频道 id 生成   src/config.js 配置   src/ui.js 输出
test/pure.test.js  纯逻辑单测（node --test）
```

## 关键约束
- **绝不往用户当前目录写 firebase.json/.firebaserc** —— 用临时 staging + `firebase -c/-P`，这是核心正确性要求
- 单文件部署自动另存一份为 `index.html`，保证根 URL 可渲染（拷贝不移动，绝不动用户原文件）
- `--json` 全命令支持，机器可解析（skill 依赖它）
- TTL 最大 30d（Firebase 硬限），超了钳制 + 告警
- `init` 必须接住 onboarding 坑：交互登录、多账号 authuser、ToS 403 引导浏览器、Firebase API 未启用

## 命令 & 选项速查
`vibeshare <path>`(默认=share) / `list` / `unshare <id>` / `open <id>` / `init` / `doctor`
`--ttl/-e`(默认7d,max30d) `--name/--id` `--project/-P` `--open` `--json` `--yes/-y` `--debug` `--version/-v` `--help/-h`
配置：`~/.config/vibeshare/config.json`（`project` + `account`）

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
