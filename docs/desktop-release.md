# Privix 桌面发版说明

## 当前口径（v1.4.2+）

- 正式发版统一为单一 `Privix` 身份
- 社区版仅保留 base 模块,无 license 激活概念
- `scripts/apply-product-profile.js`、`npm run profile:*`、`npm run release:desktop:all` 仅保留历史兼容，不再作为默认发版路径
- macOS Apple Silicon 标准产物路径：`src-tauri/target/release/bundle/dmg/Privix_<version>_aarch64.dmg`
- 如果用户说“发包到桌面”，默认在构建完成后把 DMG 额外复制到 `~/Desktop/`

## 推荐命令

```bash
npm run version:set 1.4.5-fix2
npm run test
./scripts/build.sh release
cp src-tauri/target/release/bundle/dmg/Privix_1.4.5-fix2_aarch64.dmg ~/Desktop/
```

## 标准发布流程

1. `npm run version:set X.Y.Z`，以 `package.json` 为唯一版本源同步 `Cargo.toml`、`tauri.conf.json` 等文件
2. 更新 `CHANGELOG.md`、`UPSTREAM.md`、`openclaw-version-policy.json` 与相关说明文档
3. 运行 `npm run test`，必要时补跑 `npm run i18n:check:strict`
4. 执行 `./scripts/build.sh release`
5. 如需官网分发，执行 `./scripts/release-to-portal.sh`
6. 若脚本同步更新了主仓库内的 `src/portal/portal.html`，记得把该文件一并提交到面板仓库
7. 如需 GitHub 归档备份，再创建 tag 与 release；GitHub Release 不作为官网下载安装源

## 发版完成后核对

- `package.json` / `src-tauri/Cargo.toml` / `src-tauri/tauri.conf.json` 版本一致
- `src-tauri/target/release/bundle/dmg/Privix_<version>_aarch64.dmg` 已生成
- 若用户要求“到桌面”，`~/Desktop/Privix_<version>_aarch64.dmg` 已存在
- 若执行了官网发布，Portal 仓库下载链接与站内 badge 已同步
- 若执行了官网发布，主仓库内 `src/portal/portal.html` 的下载链接与版本 badge 也已提交/推送

## 历史兼容说明

- `release:desktop:all` 仅保留历史兼容,不再作为正式发版默认路径
