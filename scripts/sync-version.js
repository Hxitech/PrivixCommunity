#!/usr/bin/env node
/**
 * 版本号同步脚本
 * 以 package.json 为唯一版本源，同步到所有相关文件
 *
 * 用法：
 *   node scripts/sync-version.js          # 同步当前版本
 *   node scripts/sync-version.js 0.6.0    # 先改 package.json 再同步
 */
import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const SEMVER_WITH_SUFFIX = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
const VERSION_PATTERN = '\\d+\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.-]+)?'

// 读取 package.json
const pkgPath = resolve(root, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))

// 如果传入了新版本号，先更新 package.json
const newVersion = process.argv[2]
if (newVersion) {
  if (!SEMVER_WITH_SUFFIX.test(newVersion)) {
    console.error('❌ 版本号格式不对，应为 x.y.z 或 x.y.z-suffix')
    process.exit(1)
  }
  pkg.version = newVersion
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  console.log(`✅ package.json → ${newVersion}`)
}

const version = pkg.version

// 同步目标文件
const targets = [
  {
    file: 'package-lock.json',
    update(content) {
      const obj = JSON.parse(content)
      obj.version = version
      if (obj.packages?.['']) obj.packages[''].version = version
      return JSON.stringify(obj, null, 2) + '\n'
    },
  },
  {
    file: 'src-tauri/tauri.conf.json',
    update(content) {
      const obj = JSON.parse(content)
      obj.version = version
      return JSON.stringify(obj, null, 2) + '\n'
    },
  },
  {
    file: 'src-tauri/Cargo.toml',
    update(content) {
      return content.replace(/^version\s*=\s*"[^"]*"/m, `version = "${version}"`)
    },
  },
  {
    file: 'docs/index.html',
    update(content) {
      // JSON-LD softwareVersion
      let result = content.replace(/"softwareVersion":\s*"[^"]*"/, `"softwareVersion": "${version}"`)
      // 下载链接中的版本号: Privix_x.y.z_xxx
      result = result.replace(new RegExp(`Privix_${VERSION_PATTERN}_`, 'g'), `Privix_${version}_`)
      // 版本徽标: v0.x.x 最新版
      result = result.replace(new RegExp(`v${VERSION_PATTERN}\\s*最新版`), `v${version} 最新版`)
      return result
    },
  },
]

let changed = 0
for (const { file, update } of targets) {
  const filepath = resolve(root, file)
  try {
    const before = readFileSync(filepath, 'utf8')
    const after = update(before)
    if (before !== after) {
      writeFileSync(filepath, after)
      console.log(`✅ ${file} → ${version}`)
      changed++
    } else {
      console.log(`  ${file} — 已是 ${version}`)
    }
  } catch (e) {
    if (e?.code === 'ENOENT') {
      console.log(`  ${file} — 文件不存在，已跳过`)
      continue
    }
    console.error(`❌ ${file}: ${e.message}`)
  }
}

console.log(`\n版本 ${version}，${changed ? `已同步 ${changed} 个文件` : '所有文件已是最新'}`)
