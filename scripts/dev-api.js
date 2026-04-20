/**
 * Privix 开发模式 API 插件
 * 在 Vite 开发服务器上提供真实 API 端点，替代 mock 数据
 * 使浏览器模式能真正管理 OpenClaw 实例
 */
import fs from 'fs'
import path from 'path'
import os from 'os'
import { homedir, networkInterfaces } from 'os'
import { execSync, execFileSync, spawn, spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import net from 'net'
import http from 'http'
import crypto from 'crypto'
import * as skillhubSdk from './lib/skillhub-sdk.js'
import { getDefaultProductProfileId, normalizeProductProfileId } from '../src/lib/product-profile.js'
const DOCKER_TASK_TIMEOUT_MS = 10 * 60 * 1000

const __dev_dirname = path.dirname(fileURLToPath(import.meta.url))
const GENERATED_PRODUCT_PROFILE_ID = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dev_dirname, '..', 'src-tauri', 'product-profile.json'), 'utf8'))?.id
  } catch {
    return null
  }
})()
const OPENCLAW_DIR = process.env.OPENCLAW_HOME || path.join(homedir(), '.openclaw')
// 优先读新变量 PRIVIX_PRODUCT_PROFILE;保留旧变量 PROSPECTCLAW_PRODUCT_PROFILE 作为 deprecation fallback
function resolveProductProfileEnv() {
  if (process.env.PRIVIX_PRODUCT_PROFILE) return process.env.PRIVIX_PRODUCT_PROFILE
  if (process.env.PROSPECTCLAW_PRODUCT_PROFILE) {
    console.warn('[deprecated] PROSPECTCLAW_PRODUCT_PROFILE is deprecated, use PRIVIX_PRODUCT_PROFILE')
    return process.env.PROSPECTCLAW_PRODUCT_PROFILE
  }
  return null
}
const PRODUCT_PROFILE_ID = normalizeProductProfileId(
  resolveProductProfileEnv()
    || GENERATED_PRODUCT_PROFILE_ID
    || getDefaultProductProfileId(),
)
const CONFIG_PATH = path.join(OPENCLAW_DIR, 'openclaw.json')
const MCP_CONFIG_PATH = path.join(OPENCLAW_DIR, 'mcp.json')
const LOGS_DIR = path.join(OPENCLAW_DIR, 'logs')
const BACKUPS_DIR = path.join(OPENCLAW_DIR, 'backups')
const DEVICE_KEY_FILE = path.join(OPENCLAW_DIR, 'clawpanel-device-key.json')
const DEVICES_DIR = path.join(OPENCLAW_DIR, 'devices')
const PAIRED_PATH = path.join(DEVICES_DIR, 'paired.json')
const isWindows = process.platform === 'win32'
const isMac = process.platform === 'darwin'
const isLinux = process.platform === 'linux'
const SCOPES = ['operator.admin', 'operator.approvals', 'operator.pairing', 'operator.read', 'operator.write']
const CLUSTER_TOKEN = 'clawpanel-cluster-secret-2026'
const PANEL_PROFILES_DIR = path.join(OPENCLAW_DIR, getDefaultProductProfileId())
const PANEL_RUNTIME_DIR = path.join(PANEL_PROFILES_DIR, PRODUCT_PROFILE_ID)
const LEGACY_PANEL_CONFIG_PATH = path.join(OPENCLAW_DIR, 'clawpanel.json')
const LEGACY_PANEL_DATA_DIR = path.join(OPENCLAW_DIR, 'clawpanel')
const PANEL_CONFIG_PATH = path.join(PANEL_RUNTIME_DIR, 'clawpanel.json')
const DOCKER_NODES_PATH = path.join(PANEL_RUNTIME_DIR, 'docker-nodes.json')
const INSTANCES_PATH = path.join(PANEL_RUNTIME_DIR, 'instances.json')
const PANEL_AGENT_BACKUPS_DIR = path.join(PANEL_RUNTIME_DIR, 'agent-config-backups')
const FRONTEND_UPDATE_DIR = path.join(PANEL_RUNTIME_DIR, 'web-update')
const DOCKER_SOCKET = process.platform === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock'
const OPENCLAW_IMAGE = 'ghcr.io/qingchencloud/openclaw'
const PANEL_VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dev_dirname, '..', 'package.json'), 'utf8')).version || '0.0.0'
  } catch {
    return '0.0.0'
  }
})()
const VERSION_POLICY_PATH = path.join(__dev_dirname, '..', 'openclaw-version-policy.json')
const GIT_HTTPS_REWRITES = [
  'ssh://git@github.com/',
  'ssh://git@github.com',
  'ssh://git@://github.com/',
  'git@github.com:',
  'git://github.com/',
  'git+ssh://git@github.com/'
]

// === 异步任务存储 ===
const _taskStore = new Map()   // taskId → task object
const MAX_TASK_HISTORY = 50
const _agentScriptSyncCache = new Map() // `${endpoint}:${containerId}` → 脚本 hash

function createTask(containerId, containerName, nodeId, message) {
  const id = `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const task = {
    id,
    containerId,
    containerName: containerName || containerId.slice(0, 12),
    nodeId: nodeId || null,
    message,
    status: 'running',   // running | completed | error
    result: null,
    error: null,
    events: [],
    startedAt: Date.now(),
    completedAt: null,
  }
  _taskStore.set(id, task)
  // 清理旧任务
  if (_taskStore.size > MAX_TASK_HISTORY) {
    const oldest = [..._taskStore.keys()].slice(0, _taskStore.size - MAX_TASK_HISTORY)
    oldest.forEach(k => _taskStore.delete(k))
  }
  return task
}

// 语义化版本比较
function parseVersion(value) {
  return String(value || '').split(/[^0-9]/).filter(Boolean).map(Number)
}
function versionCompare(a, b) {
  const pa = parseVersion(a), pb = parseVersion(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1
    if ((pa[i] || 0) < (pb[i] || 0)) return -1
  }
  return 0
}
function versionGe(a, b) {
  return versionCompare(a, b) >= 0
}
function versionGt(a, b) {
  return versionCompare(a, b) > 0
}

// 提取基础版本号（去掉 -zh.x / -nightly.xxx 等后缀）
function baseVersion(v) {
  return String(v || '').split('-')[0]
}

// 判断 CLI 版本是否与推荐版匹配（考虑汉化版 -zh.x 后缀差异）
function versionsMatch(cliVer, recommended) {
  if (cliVer === recommended) return true
  return baseVersion(cliVer) === baseVersion(recommended)
}

// 判断推荐版是否真的比当前版本更新（忽略 -zh.x 后缀）
function recommendedIsNewer(recommended, current) {
  return versionGt(baseVersion(recommended), baseVersion(current))
}

function loadVersionPolicy() {
  try {
    return JSON.parse(fs.readFileSync(VERSION_POLICY_PATH, 'utf8'))
  } catch {
    return {}
  }
}

function standaloneConfig() {
  const policy = loadVersionPolicy()
  return policy?.standalone || { enabled: false }
}

function standalonePlatformKey() {
  const arch = process.arch
  const plat = process.platform
  if (plat === 'win32' && arch === 'x64') return 'win-x64'
  if (plat === 'darwin' && arch === 'arm64') return 'mac-arm64'
  if (plat === 'darwin' && arch === 'x64') return 'mac-x64'
  if (plat === 'linux' && arch === 'x64') return 'linux-x64'
  if (plat === 'linux' && arch === 'arm64') return 'linux-arm64'
  return 'unknown'
}

function standaloneInstallDir() {
  if (isWindows) return path.join(process.env.LOCALAPPDATA || '', 'Programs', 'OpenClaw')
  return path.join(os.homedir(), '.openclaw-bin')
}

async function _tryStandaloneInstall(version, logs, overrideBaseUrl = null) {
  const cfg = standaloneConfig()
  if (!cfg.enabled || !cfg.baseUrl) return false
  const platform = standalonePlatformKey()
  if (platform === 'unknown') throw new Error('当前平台不支持 standalone 安装包')
  const installDir = standaloneInstallDir()

  logs.push('📦 尝试 standalone 独立安装包（汉化版专属，自带 Node.js 运行时，无需 npm）')
  logs.push('查询最新版本...')
  const manifestUrl = `${cfg.baseUrl}/latest.json`
  const resp = await globalThis.fetch(manifestUrl, { signal: AbortSignal.timeout(10000) })
  if (!resp.ok) throw new Error(`standalone 清单不可用 (HTTP ${resp.status})`)
  const manifest = await resp.json()

  const remoteVersion = manifest.version
  if (!remoteVersion) throw new Error('standalone 清单缺少 version 字段')
  if (version !== 'latest' && !versionsMatch(remoteVersion, version)) {
    throw new Error(`standalone 版本 ${remoteVersion} 与请求版本 ${version} 不匹配`)
  }

  const remoteBase = overrideBaseUrl || manifest.base_url || `${cfg.baseUrl}/${remoteVersion}`
  const ext = isWindows ? 'zip' : 'tar.gz'
  const filename = `openclaw-${remoteVersion}-${platform}.${ext}`
  const downloadUrl = `${remoteBase}/${filename}`

  logs.push(`从 ${overrideBaseUrl ? 'GitHub' : 'CDN'} 下载: ${filename}`)
  const tmpPath = path.join(os.tmpdir(), filename)
  const dlResp = await globalThis.fetch(downloadUrl, { signal: AbortSignal.timeout(600000) })
  if (!dlResp.ok) throw new Error(`standalone 下载失败 (HTTP ${dlResp.status})`)
  const buffer = Buffer.from(await dlResp.arrayBuffer())
  const sizeMb = (buffer.length / 1048576).toFixed(0)
  logs.push(`下载完成 (${sizeMb}MB)，解压安装中...`)
  fs.writeFileSync(tmpPath, buffer)

  if (fs.existsSync(installDir)) {
    fs.rmSync(installDir, { recursive: true, force: true })
  }
  fs.mkdirSync(installDir, { recursive: true })

  if (isWindows) {
    execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${tmpPath}' -DestinationPath '${installDir}' -Force"`, { windowsHide: true })
    const nested = path.join(installDir, 'openclaw')
    if (fs.existsSync(nested) && fs.existsSync(path.join(nested, 'node.exe'))) {
      for (const entry of fs.readdirSync(nested)) {
        fs.renameSync(path.join(nested, entry), path.join(installDir, entry))
      }
      fs.rmSync(nested, { recursive: true, force: true })
    }
  } else {
    execSync(`tar -xzf "${tmpPath}" -C "${installDir}" --strip-components=1`, { windowsHide: true })
  }

  try { fs.unlinkSync(tmpPath) } catch {}
  const binFile = isWindows ? 'openclaw.cmd' : 'openclaw'
  if (!fs.existsSync(path.join(installDir, binFile))) {
    throw new Error('standalone 解压后未找到 openclaw 可执行文件')
  }

  logs.push(`✅ standalone 安装完成 (${remoteVersion})`)
  logs.push(`安装目录: ${installDir}`)
  return true
}

function recommendedVersionFor(source = 'chinese') {
  const policy = loadVersionPolicy()
  return policy?.panels?.[PANEL_VERSION]?.[source]?.recommended
    || policy?.default?.[source]?.recommended
    || null
}

function npmPackageName(source = 'chinese') {
  return source === 'official' ? 'openclaw' : '@qingchencloud/openclaw-zh'
}

function getConfiguredNpmRegistry() {
  const regFile = path.join(OPENCLAW_DIR, 'npm-registry.txt')
  try {
    if (fs.existsSync(regFile)) {
      const value = fs.readFileSync(regFile, 'utf8').trim()
      if (value) return value
    }
  } catch {}
  return 'https://registry.npmmirror.com'
}

function pickRegistryForPackage(pkg) {
  const configured = getConfiguredNpmRegistry()
  if (pkg.includes('openclaw-zh')) {
    if (configured.includes('npmmirror.com') || configured.includes('npmjs.org')) return configured
    return 'https://registry.npmjs.org'
  }
  return configured
}

function expandHomePath(p) {
  if (typeof p !== 'string') return p
  if (p.startsWith('~/') || p === '~') return path.join(homedir(), p.slice(1))
  return p
}

function normalizeCommandPath(raw) {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const expanded = expandHomePath(trimmed)
  if (!expanded) return null
  const looksLikePath =
    trimmed.includes('/') || trimmed.includes('\\') || trimmed.startsWith('.') || /^~[\\/]/.test(trimmed) || /^[A-Za-z]:[\\/]/.test(trimmed)
  return looksLikePath ? path.resolve(expanded) : expanded
}

function readConfiguredGitPath() {
  return normalizeCommandPath(readPanelConfig()?.gitPath || '')
}

function resolveGitExecutable() {
  const gitPath = readConfiguredGitPath()
  const isCustom = !!gitPath
  const isPathLike = !!gitPath && (gitPath.includes('/') || gitPath.includes('\\') || /^[A-Za-z]:[\\/]/.test(gitPath))
  return { gitPath: gitPath || 'git', isCustom, isPathLike }
}

function buildGitCommandEnv(extraEnv = {}, resolved = resolveGitExecutable()) {
  const env = { ...process.env, ...(extraEnv || {}) }
  if (resolved.isCustom && resolved.isPathLike) {
    const dir = path.dirname(resolved.gitPath)
    env.PATH = [dir, env.PATH || ''].filter(Boolean).join(path.delimiter)
  }
  if (resolved.isCustom) env.GIT = resolved.gitPath
  return env
}

function runGitSync(args, options = {}) {
  const resolved = resolveGitExecutable()
  const env = buildGitCommandEnv(options.env, resolved)
  const result = spawnSync(resolved.gitPath, args, {
    encoding: 'utf8',
    windowsHide: true,
    ...options,
    env,
  })
  return { ...resolved, result }
}

function configureGitHttpsRules() {
  try { runGitSync(['config', '--global', '--unset-all', 'url.https://github.com/.insteadOf'], { timeout: 5000 }) } catch {}
  let success = 0
  for (const from of GIT_HTTPS_REWRITES) {
    try {
      const { result } = runGitSync(['config', '--global', '--add', 'url.https://github.com/.insteadOf', from], { timeout: 5000 })
      if (result.status === 0) success++
    } catch {}
  }
  return success
}

function buildGitInstallEnv() {
  const env = buildGitCommandEnv({
    GIT_TERMINAL_PROMPT: '0',
    GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o StrictHostKeyChecking=no -o IdentitiesOnly=yes',
    GIT_ALLOW_PROTOCOL: 'https:http:file',
    GIT_CONFIG_COUNT: String(GIT_HTTPS_REWRITES.length),
  })
  GIT_HTTPS_REWRITES.forEach((from, idx) => {
    env[`GIT_CONFIG_KEY_${idx}`] = 'url.https://github.com/.insteadOf'
    env[`GIT_CONFIG_VALUE_${idx}`] = from
  })
  return env
}

function detectInstalledSource() {
  if (isMac) {
    // ARM Homebrew (/opt/homebrew) + Intel Homebrew (/usr/local)
    for (const prefix of ['/opt/homebrew/bin/openclaw', '/usr/local/bin/openclaw']) {
      try {
        const target = fs.readlinkSync(prefix)
        if (String(target).includes('openclaw-zh')) return 'chinese'
        return 'official'
      } catch {}
    }
    // standalone 安装 (~/.openclaw-bin)
    try {
      const homeBin = path.join(os.homedir(), '.openclaw-bin', 'openclaw')
      if (fs.existsSync(homeBin)) return 'official'
    } catch {}
  }
  if (isWindows) {
    try {
      const appdata = process.env.APPDATA
      if (appdata) {
        const zhDir = path.join(appdata, 'npm', 'node_modules', '@qingchencloud', 'openclaw-zh')
        if (fs.existsSync(zhDir)) return 'chinese'
      }
    } catch {}
    return 'official'
  }
  try {
    const npmBin = isWindows ? 'npm.cmd' : 'npm'
    const out = execSync(`${npmBin} list -g @qingchencloud/openclaw-zh --depth=0 2>&1`, { timeout: 10000, windowsHide: true }).toString()
    if (out.includes('openclaw-zh@')) return 'chinese'
  } catch {}
  return 'official'
}

function getLocalOpenclawVersion() {
  let current = null
  if (isMac) {
    // ARM Homebrew (/opt/homebrew) + Intel Homebrew (/usr/local)
    for (const prefix of ['/opt/homebrew/bin/openclaw', '/usr/local/bin/openclaw']) {
      try {
        const target = fs.readlinkSync(prefix)
        const pkgPath = path.resolve(path.dirname(prefix), target, '..', 'package.json')
        current = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version
        if (current) break
      } catch {}
    }
    // standalone 安装 (~/.openclaw-bin)
    if (!current) {
      try {
        const standalonePkg = path.join(os.homedir(), '.openclaw-bin', 'package.json')
        if (fs.existsSync(standalonePkg)) {
          current = JSON.parse(fs.readFileSync(standalonePkg, 'utf8')).version
        }
      } catch {}
    }
  }
  if (!current && isWindows) {
    try {
      const appdata = process.env.APPDATA
      if (appdata) {
        for (const pkg of [path.join('@qingchencloud', 'openclaw-zh'), 'openclaw']) {
          const pkgPath = path.join(appdata, 'npm', 'node_modules', pkg, 'package.json')
          if (fs.existsSync(pkgPath)) {
            current = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version
            if (current) break
          }
        }
      }
    } catch {}
  }
  if (!current) {
    try { current = execSync('openclaw --version 2>&1', { windowsHide: true }).toString().trim().split(/\s+/).find(w => /^\d/.test(w)) || null } catch {}
  }
  return current || null
}

async function getLatestVersionFor(source = 'chinese') {
  const pkg = npmPackageName(source)
  const encodedPkg = pkg.replace('/', '%2F').replace('@', '%40')
  const firstRegistry = pickRegistryForPackage(pkg)
  const registries = [...new Set([firstRegistry, 'https://registry.npmjs.org'])]
  for (const registry of registries) {
    try {
      const resp = await fetch(`${registry}/${encodedPkg}/latest`, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(10000) })
      if (!resp.ok) continue
      const data = await resp.json()
      if (data?.version) return data.version
    } catch {}
  }
  return null
}

// === 访问密码 & Session 管理 ===

const _sessions = new Map() // token → { expires }
const SESSION_TTL = 24 * 60 * 60 * 1000 // 24h
const AUTH_EXEMPT = new Set(['auth_check', 'auth_login', 'auth_logout'])

// 登录限速：防暴力破解（IP 级别，5次失败后锁定60秒）
const _loginAttempts = new Map() // ip → { count, lockedUntil }
const MAX_LOGIN_ATTEMPTS = 5
const LOCKOUT_DURATION = 60 * 1000 // 60s

function checkLoginRateLimit(ip) {
  const now = Date.now()
  const record = _loginAttempts.get(ip)
  if (!record) return null
  if (record.lockedUntil && now < record.lockedUntil) {
    const remaining = Math.ceil((record.lockedUntil - now) / 1000)
    return `登录失败次数过多，请 ${remaining} 秒后再试`
  }
  if (record.lockedUntil && now >= record.lockedUntil) {
    _loginAttempts.delete(ip)
  }
  return null
}

function recordLoginFailure(ip) {
  const record = _loginAttempts.get(ip) || { count: 0, lockedUntil: null }
  record.count++
  if (record.count >= MAX_LOGIN_ATTEMPTS) {
    record.lockedUntil = Date.now() + LOCKOUT_DURATION
    record.count = 0
  }
  _loginAttempts.set(ip, record)
}

function clearLoginAttempts(ip) {
  _loginAttempts.delete(ip)
}

// 配置缓存：避免每次请求同步读磁盘（TTL 2秒，写入时立即失效）
let _panelConfigCache = null
let _panelConfigCacheTime = 0
const CONFIG_CACHE_TTL = 2000 // 2s

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function copyFileIfMissing(src, dest) {
  if (!src || !dest || !fs.existsSync(src) || fs.existsSync(dest)) return
  ensureDir(path.dirname(dest))
  fs.copyFileSync(src, dest)
}

function copyDirIfMissing(src, dest) {
  if (!src || !dest || !fs.existsSync(src) || fs.existsSync(dest)) return
  ensureDir(dest)
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDirIfMissing(srcPath, destPath)
    else copyFileIfMissing(srcPath, destPath)
  }
}

function normalizePanelConfig(config) {
  const next = config && typeof config === 'object' && !Array.isArray(config)
    ? JSON.parse(JSON.stringify(config))
    : {}
  const productProfile = next.productProfile && typeof next.productProfile === 'object' && !Array.isArray(next.productProfile)
    ? next.productProfile
    : {}
  productProfile.baseProfileId = PRODUCT_PROFILE_ID
  if (productProfile.profileVersion == null) productProfile.profileVersion = 1
  if (!Array.isArray(productProfile.enabledCapabilities)) productProfile.enabledCapabilities = []
  next.productProfile = productProfile
  if (next.license && typeof next.license === 'object' && !Array.isArray(next.license) && !next.license.productProfileId) {
    next.license.productProfileId = PRODUCT_PROFILE_ID
  }
  return next
}

function ensurePanelRuntimeState() {
  ensureDir(PANEL_PROFILES_DIR)
  ensureDir(PANEL_RUNTIME_DIR)
  if (PRODUCT_PROFILE_ID === getDefaultProductProfileId()) {
    copyFileIfMissing(LEGACY_PANEL_CONFIG_PATH, PANEL_CONFIG_PATH)
    copyFileIfMissing(path.join(OPENCLAW_DIR, 'docker-nodes.json'), DOCKER_NODES_PATH)
    copyFileIfMissing(path.join(OPENCLAW_DIR, 'instances.json'), INSTANCES_PATH)
    if (fs.existsSync(LEGACY_PANEL_DATA_DIR)) {
      for (const entry of fs.readdirSync(LEGACY_PANEL_DATA_DIR, { withFileTypes: true })) {
        const srcPath = path.join(LEGACY_PANEL_DATA_DIR, entry.name)
        const destPath = path.join(PANEL_RUNTIME_DIR, entry.name)
        if (entry.isDirectory()) copyDirIfMissing(srcPath, destPath)
        else copyFileIfMissing(srcPath, destPath)
      }
    }
  }
  const current = fs.existsSync(PANEL_CONFIG_PATH)
    ? fs.readFileSync(PANEL_CONFIG_PATH, 'utf8')
    : ''
  const normalized = normalizePanelConfig(
    current ? JSON.parse(current) : {},
  )
  const serialized = JSON.stringify(normalized, null, 2)
  if (current !== serialized) {
    fs.writeFileSync(PANEL_CONFIG_PATH, serialized)
  }
}

function writePanelConfigFile(config) {
  ensurePanelRuntimeState()
  const normalized = normalizePanelConfig(config)
  fs.writeFileSync(PANEL_CONFIG_PATH, JSON.stringify(normalized, null, 2))
  invalidateConfigCache()
  return normalized
}

function readPanelConfig() {
  ensurePanelRuntimeState()
  const now = Date.now()
  if (_panelConfigCache && (now - _panelConfigCacheTime) < CONFIG_CACHE_TTL) {
    return JSON.parse(JSON.stringify(_panelConfigCache))
  }
  try {
    if (fs.existsSync(PANEL_CONFIG_PATH)) {
      _panelConfigCache = normalizePanelConfig(JSON.parse(fs.readFileSync(PANEL_CONFIG_PATH, 'utf8')))
      _panelConfigCacheTime = now
      return JSON.parse(JSON.stringify(_panelConfigCache))
    }
  } catch {}
  return {}
}

function invalidateConfigCache() {
  _panelConfigCache = null
  _panelConfigCacheTime = 0
}

function getAccessPassword() {
  return readPanelConfig().accessPassword || ''
}

function parseCookies(req) {
  const obj = {}
  ;(req.headers.cookie || '').split(';').forEach(pair => {
    const [k, ...v] = pair.trim().split('=')
    if (k) try { obj[k] = decodeURIComponent(v.join('=')) } catch (_) { obj[k] = v.join('=') }
  })
  return obj
}

function isAuthenticated(req) {
  const pw = getAccessPassword()
  if (!pw) return true // 未设密码，放行
  const cookies = parseCookies(req)
  const token = cookies.clawpanel_session
  if (!token) return false
  const session = _sessions.get(token)
  if (!session || Date.now() > session.expires) {
    _sessions.delete(token)
    return false
  }
  return true
}

function checkPasswordStrength(pw) {
  if (!pw || pw.length < 6) return '密码至少 6 位'
  if (pw.length > 64) return '密码不能超过 64 位'
  if (/^\d+$/.test(pw)) return '密码不能是纯数字'
  const weak = ['123456', '654321', 'password', 'admin', 'qwerty', 'abc123', '111111', '000000', 'letmein', 'welcome', 'clawpanel', 'openclaw']
  if (weak.includes(pw.toLowerCase())) return '密码太常见，请换一个更安全的密码'
  return null // 通过
}

function isUnsafePath(p) {
  return !p || p.includes('..') || p.includes('\0') || path.isAbsolute(p)
}

const CORE_AGENT_SOURCE_FILES = ['IDENTITY.md', 'SOUL.md', 'USER.md', 'AGENTS.md', 'TOOLS.md']
const COMMON_AGENT_SOURCE_FILES = ['agent.md', 'AGENT.md', 'CLAUDE.md', 'README.md']
const TARGET_AGENT_OUTPUT_FILES = ['IDENTITY.md', 'SOUL.md', 'AGENTS.md', 'TOOLS.md']
const AGENT_SOURCE_FILE_CHAR_LIMIT = 6000
const AGENT_SOURCE_TRUNCATION_NOTICE = '\n\n[内容已截断，仅保留前文以控制预览和提示词体积。]'

function readOpenclawConfigSafe() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return {}
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  } catch {
    return {}
  }
}

function defaultWorkspaceForAgent(agentId) {
  return agentId === 'main'
    ? path.join(OPENCLAW_DIR, 'workspace')
    : path.join(OPENCLAW_DIR, 'agents', agentId, 'workspace')
}

function listConfiguredAgentsData() {
  const config = readOpenclawConfigSafe()
  const result = []
  const defaults = config?.agents?.defaults || {}
  const mainWorkspace = defaults.workspace || defaultWorkspaceForAgent('main')
  const mainModel = defaults.model?.primary || null
  const mainIdentityName = defaults.identity?.name || null
  result.push({
    id: 'main',
    isDefault: true,
    identityName: mainIdentityName,
    model: mainModel,
    workspace: mainWorkspace,
  })

  const byId = new Map(result.map(item => [item.id, item]))
  const listed = Array.isArray(config?.agents?.list) ? config.agents.list : []
  for (const agent of listed) {
    const id = String(agent?.id || '').trim()
    if (!id || id === 'main') continue
    const item = {
      id,
      isDefault: false,
      identityName: agent?.identity?.name || agent?.name || null,
      model: agent?.model?.primary || null,
      workspace: agent?.workspace || defaultWorkspaceForAgent(id),
    }
    byId.set(id, item)
  }

  const agentsDir = path.join(OPENCLAW_DIR, 'agents')
  if (fs.existsSync(agentsDir)) {
    for (const entry of fs.readdirSync(agentsDir)) {
      if (entry === 'main') continue
      const full = path.join(agentsDir, entry)
      if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) continue
      if (!byId.has(entry)) {
        byId.set(entry, {
          id: entry,
          isDefault: false,
          identityName: null,
          model: null,
          workspace: defaultWorkspaceForAgent(entry),
        })
      }
    }
  }

  return [...byId.values()]
}

function resolveAgentWorkspace(agentId) {
  const match = listConfiguredAgentsData().find(item => item.id === agentId)
  if (!match?.workspace) throw new Error(`Agent「${agentId}」不存在或无 workspace`)
  return match.workspace
}

// ── Skills 本地扫描工具函数 ──────────────────────────────

function parseSkillFrontmatterFile(skillMdPath) {
  try {
    const raw = fs.readFileSync(skillMdPath, 'utf8').replace(/\r\n/g, '\n')
    if (!raw.startsWith('---\n')) return {}
    const end = raw.indexOf('\n---\n', 4)
    if (end < 0) return {}
    const frontmatter = raw.slice(4, end)
    const result = {}
    for (const line of frontmatter.split('\n')) {
      const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.+)$/)
      if (!match) continue
      result[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '')
    }
    return result
  } catch {
    return {}
  }
}

function resolveAgentSkillsDir(agentId) {
  const id = (agentId || '').trim()
  if (!id || id === 'main') return null
  try {
    const ws = resolveAgentWorkspace(id)
    return path.join(ws, 'skills')
  } catch {
    return path.join(OPENCLAW_DIR, 'agents', id, 'workspace', 'skills')
  }
}

function collectLocalSkillRoots(agentSkillsDir) {
  const roots = []
  const seen = new Set()
  const pushRoot = (dir, source, bundled = false) => {
    if (!dir) return
    const normalized = path.resolve(dir)
    const key = isWindows ? normalized.toLowerCase() : normalized
    if (seen.has(key)) return
    seen.add(key)
    roots.push({ dir: normalized, source, bundled })
  }

  if (agentSkillsDir) {
    pushRoot(agentSkillsDir, 'Agent 自定义', false)
  } else {
    pushRoot(path.join(OPENCLAW_DIR, 'skills'), 'OpenClaw 自定义', false)
  }
  pushRoot(path.join(homedir(), '.claude', 'skills'), 'Claude 自定义', false)

  // 尝试从 which/where 找到 CLI 路径推导 bundled skills
  try {
    const cmd = isWindows ? 'where openclaw' : 'which openclaw'
    const cliPath = execSync(cmd, { encoding: 'utf8', timeout: 5000 }).trim().split('\n')[0]
    if (cliPath) {
      const resolved = fs.realpathSync(cliPath)
      const cliDir = path.dirname(resolved)
      for (const pkgRoot of [cliDir, path.dirname(cliDir)]) {
        const bundledDir = path.join(pkgRoot, 'skills')
        if (fs.existsSync(bundledDir) && fs.statSync(bundledDir).isDirectory()) {
          pushRoot(bundledDir, 'openclaw-bundled', true)
          break
        }
      }
    }
  } catch { /* CLI 不可用 */ }

  return roots
}

function scanSingleSkill(root, name) {
  const skillPath = path.join(root.dir, name)
  const skillMd = path.join(skillPath, 'SKILL.md')
  const packageJson = path.join(skillPath, 'package.json')
  if (!fs.existsSync(skillMd) && !fs.existsSync(packageJson)) return null

  const result = {
    name,
    source: root.source,
    bundled: !!root.bundled,
    filePath: skillPath,
    description: '',
    eligible: true,
    disabled: false,
    blockedByAllowlist: false,
    requirements: { bins: [], anyBins: [], env: [], config: [], os: [] },
    missing: { bins: [], anyBins: [], env: [], config: [], os: [] },
    install: [],
  }

  try {
    if (fs.existsSync(packageJson)) {
      const pkg = JSON.parse(fs.readFileSync(packageJson, 'utf8'))
      if (pkg.description) result.description = pkg.description
      if (pkg.homepage) result.homepage = pkg.homepage
      if (pkg.version) result.version = pkg.version
      if (pkg.author) result.author = typeof pkg.author === 'string' ? pkg.author : (pkg.author?.name || '')
    }
  } catch {}

  const frontmatter = parseSkillFrontmatterFile(skillMd)
  if (frontmatter.description) result.description = frontmatter.description
  if (frontmatter.fullPath) result.fullPath = frontmatter.fullPath
  if (frontmatter.emoji) result.emoji = frontmatter.emoji

  return result
}

function scanLocalSkillsFallback(agentSkillsDir = null) {
  const roots = collectLocalSkillRoots(agentSkillsDir)
  const skills = []
  const seen = new Set()
  const scannedRoots = []

  for (const root of roots) {
    if (!fs.existsSync(root.dir) || !fs.statSync(root.dir).isDirectory()) continue
    scannedRoots.push(root.dir)
    for (const entry of fs.readdirSync(root.dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const key = isWindows ? entry.name.toLowerCase() : entry.name
      if (seen.has(key)) continue
      const skill = scanSingleSkill(root, entry.name)
      if (!skill) continue
      seen.add(key)
      skills.push(skill)
    }
  }

  skills.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
  return {
    skills,
    source: 'local-scan',
    cliAvailable: false,
    summary: { total: skills.length },
    diagnostic: { status: 'scanned', scannedAt: new Date().toISOString(), scannedRoots },
  }
}

function deriveWorkspaceFromCreateSpec(createSpec = {}) {
  const agentId = String(createSpec.agentId || createSpec.id || '').trim()
  if (!agentId) throw new Error('createSpec.agentId 不能为空')
  const workspace = String(createSpec.workspace || '').trim()
  return workspace || defaultWorkspaceForAgent(agentId)
}

function truncateAgentSourceContent(content, limit = AGENT_SOURCE_FILE_CHAR_LIMIT) {
  const text = String(content || '')
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : AGENT_SOURCE_FILE_CHAR_LIMIT
  if (text.length <= safeLimit) return text
  if (safeLimit <= AGENT_SOURCE_TRUNCATION_NOTICE.length) return text.slice(0, safeLimit)
  return `${text.slice(0, safeLimit - AGENT_SOURCE_TRUNCATION_NOTICE.length)}${AGENT_SOURCE_TRUNCATION_NOTICE}`
}

function collectAgentSourceFiles(workspace, sourceScope, sourceRole) {
  const files = []
  for (const name of CORE_AGENT_SOURCE_FILES) {
    const full = path.join(workspace, name)
    const exists = fs.existsSync(full)
    files.push({
      sourceRole,
      name,
      path: full,
      exists,
      content: exists ? truncateAgentSourceContent(fs.readFileSync(full, 'utf8')) : null,
    })
  }
  if (sourceScope === 'core_and_common') {
    for (const name of COMMON_AGENT_SOURCE_FILES) {
      const full = path.join(workspace, name)
      const exists = fs.existsSync(full)
      files.push({
        sourceRole,
        name,
        path: full,
        exists,
        content: exists ? truncateAgentSourceContent(fs.readFileSync(full, 'utf8')) : null,
      })
    }
  }
  return files
}

function excerptText(value, limit = 160) {
  const compact = String(value || '').replace(/\r/g, '').replace(/\n/g, ' ').trim()
  return compact.length <= limit ? compact : `${compact.slice(0, limit)}...`
}

function diffSummary(current, next) {
  const status = !current?.trim() ? 'created' : current === next ? 'unchanged' : 'updated'
  return {
    status,
    currentExcerpt: current ? excerptText(current) : null,
    nextExcerpt: excerptText(next),
    currentLines: current ? current.split('\n').length : null,
    nextLines: String(next || '').split('\n').length,
  }
}

function assertAllowedTargetFileName(fileName) {
  if (!TARGET_AGENT_OUTPUT_FILES.includes(fileName)) {
    throw new Error(`不支持写入目标文件: ${fileName}`)
  }
}

const MAX_BODY_SIZE = 1024 * 1024 // 1MB

function readBody(req) {
  return new Promise((resolve) => {
    let body = ''
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY_SIZE) { req.destroy(); resolve({}); return }
      body += chunk
    })
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')) }
      catch { resolve({}) }
    })
  })
}

function readRawBody(req, maxSize = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > maxSize) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function readMultipartForm(req) {
  const contentType = req.headers['content-type'] || ''
  const match = contentType.match(/boundary=(.+)$/)
  if (!match) throw new Error('缺少 multipart boundary')
  const boundary = Buffer.from(`--${match[1]}`)
  const body = await readRawBody(req)
  const parts = []
  let start = body.indexOf(boundary)
  while (start !== -1) {
    const next = body.indexOf(boundary, start + boundary.length)
    if (next === -1) break
    const part = body.slice(start + boundary.length + 2, next - 2)
    if (part.length > 0) parts.push(part)
    start = next
  }

  const fields = {}
  let file = null
  for (const part of parts) {
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'))
    if (headerEnd === -1) continue
    const headerText = part.slice(0, headerEnd).toString('utf8')
    const content = part.slice(headerEnd + 4)
    const disposition = headerText.match(/name="([^"]+)"/i)
    const fieldName = disposition?.[1]
    if (!fieldName) continue
    const filename = headerText.match(/filename="([^"]*)"/i)?.[1]
    const mimeType = headerText.match(/Content-Type:\s*([^\r\n]+)/i)?.[1] || 'application/octet-stream'
    if (filename) {
      file = {
        fieldName,
        originalName: filename,
        mimeType,
        buffer: content,
        size: content.length,
      }
    } else {
      fields[fieldName] = content.toString('utf8')
    }
  }
  return { fields, file }
}

function getUid() {
  if (!isMac) return 0
  return execSync('id -u').toString().trim()
}

function stripUiFields(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return config
  // 根级 UI 内部字段（Issue #89: 防止 Gateway 因未知字段启动失败）
  const uiRootKeys = [
    'current', 'latest', 'recommended', 'update_available',
    'latest_update_available', 'is_recommended', 'ahead_of_recommended',
    'panel_version', 'source', 'qqbot', 'profiles',
  ]
  for (const key of uiRootKeys) {
    delete config[key]
  }
  if (config.auth && typeof config.auth === 'object' && !Array.isArray(config.auth)) {
    delete config.auth.profiles
  }
  if (config.agents && typeof config.agents === 'object' && !Array.isArray(config.agents)) {
    delete config.agents.profiles
    if (Array.isArray(config.agents.list)) {
      for (const agent of config.agents.list) {
        if (!agent || typeof agent !== 'object' || Array.isArray(agent)) continue
        delete agent.current
        delete agent.latest
        delete agent.update_available
      }
    }
  }
  // 模型测试字段
  const providers = config?.models?.providers
  if (providers) {
    for (const p of Object.values(providers)) {
      if (!Array.isArray(p.models)) continue
      for (const m of p.models) {
        if (typeof m !== 'object') continue
        delete m.lastTestAt
        delete m.latency
        delete m.testStatus
        delete m.testError
        if (!m.name && m.id) m.name = m.id
      }
    }
  }
  return config
}

function cleanLoadedConfig(config) {
  const before = JSON.stringify(config)
  const cleaned = stripUiFields(config)
  if (fs.existsSync(CONFIG_PATH) && JSON.stringify(cleaned) !== before) {
    writeOpenclawConfigFile(cleaned)
  }
  return cleaned
}

function writeOpenclawConfigFile(config) {
  const cleaned = stripUiFields(config)
  if (fs.existsSync(CONFIG_PATH)) fs.copyFileSync(CONFIG_PATH, CONFIG_PATH + '.bak')
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cleaned, null, 2))
}

// === 配置校准修复 ===

const CALIBRATION_RESET_INHERIT_KEYS = [
  'agents', 'auth', 'bindings', 'browser', 'channels', 'commands',
  'env', 'hooks', 'models', 'plugins', 'session', 'skills', 'wizard',
]

function readJsonFileRelaxed(filePath) {
  if (!fs.existsSync(filePath)) return null
  try {
    const raw = fs.readFileSync(filePath)
    // 处理 BOM
    const text = (raw.length >= 3 && raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF)
      ? raw.subarray(3).toString('utf8') : raw.toString('utf8')
    return JSON.parse(text)
  } catch { return null }
}

function calibrationRichnessScore(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return 0
  let score = 0
  if (config.models?.providers && Object.keys(config.models.providers).length) score += 4
  if (config.agents?.defaults) score += 2
  if (Array.isArray(config.agents?.list) && config.agents.list.length) score += 3
  if (config.channels && Object.keys(config.channels).length) score += 2
  if (Array.isArray(config.bindings) && config.bindings.length) score += 2
  if (config.plugins?.entries && Object.keys(config.plugins.entries).length) score += 2
  if (config.plugins?.installs && Object.keys(config.plugins.installs).length) score += 2
  if (config.env && Object.keys(config.env).length) score += 1
  const auth = config.gateway?.auth
  if (auth?.mode === 'token' ? !!String(auth?.token || '').trim() : auth?.mode === 'password' ? !!String(auth?.password || '').trim() : false) score += 3
  return score
}

function mergeConfigsPreservingFields(existing, next) {
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) return next
  if (!next || typeof next !== 'object' || Array.isArray(next)) return next
  const merged = { ...existing }
  for (const [key, value] of Object.entries(next)) {
    const prev = existing[key]
    if (prev && typeof prev === 'object' && !Array.isArray(prev) && value && typeof value === 'object' && !Array.isArray(value)) {
      merged[key] = mergeConfigsPreservingFields(prev, value)
    } else {
      merged[key] = value
    }
  }
  return merged
}

function buildCalibrationBaseline() {
  return {
    $schema: 'https://openclaw.ai/schema/config.json',
    models: { providers: {} },
    agents: {
      defaults: { workspace: path.join(OPENCLAW_DIR, 'workspace') },
      list: [],
    },
    bindings: [],
    channels: {},
    commands: { native: 'auto', nativeSkills: 'auto', ownerDisplay: 'raw', restart: true },
    plugins: {},
    session: { dmScope: 'per-channel-peer' },
    skills: { entries: {} },
    tools: { profile: 'full', sessions: { visibility: 'all' } },
    gateway: {
      mode: 'local', bind: 'loopback', port: 18789,
      auth: { mode: 'token', token: `cp-${crypto.randomBytes(16).toString('hex')}` },
      controlUi: { enabled: true, allowedOrigins: requiredControlUiOrigins(), allowInsecureAuth: true },
    },
  }
}

function requiredControlUiOrigins() {
  const origins = [
    'tauri://localhost', 'https://tauri.localhost', 'http://tauri.localhost',
    'http://localhost', 'http://localhost:1420', 'http://127.0.0.1:1420',
    'http://localhost:18777', 'http://127.0.0.1:18777',
  ]
  for (const ip of getLocalIps()) {
    origins.push(`http://${ip}:1420`, `http://${ip}:18777`)
  }
  return [...new Set(origins)]
}

function calibrateOpenclawConfig(mode = 'inherit') {
  const normalizedMode = mode === 'reinitialize' ? 'reset' : String(mode || 'inherit').trim()
  if (normalizedMode !== 'inherit' && normalizedMode !== 'reset') {
    throw new Error('mode 必须是 inherit 或 reset')
  }
  if (!fs.existsSync(OPENCLAW_DIR)) fs.mkdirSync(OPENCLAW_DIR, { recursive: true })
  const warnings = []
  let preBackup = null
  if (fs.existsSync(CONFIG_PATH)) {
    try { preBackup = handlers.create_backup().name || null }
    catch (error) { warnings.push(`修复前备份失败: ${error?.message || error}`) }
  }
  const current = readJsonFileRelaxed(CONFIG_PATH)
  const backup = readJsonFileRelaxed(CONFIG_PATH + '.bak')
  // 选择更丰富的配置作为种子
  let source, seed
  if (current && backup) {
    ;[source, seed] = calibrationRichnessScore(backup) > calibrationRichnessScore(current) ? ['backup', backup] : ['current', current]
  } else if (current) { [source, seed] = ['current', current] }
  else if (backup) { [source, seed] = ['backup', backup] }
  else { [source, seed] = ['empty', {}] }

  let calibrated, inheritedKeys
  if (normalizedMode === 'inherit') {
    inheritedKeys = seed && typeof seed === 'object' ? Object.keys(seed) : []
    calibrated = mergeConfigsPreservingFields(buildCalibrationBaseline(), seed || {})
  } else {
    const base = buildCalibrationBaseline()
    calibrated = { ...base }
    inheritedKeys = []
    if (seed && typeof seed === 'object') {
      for (const key of CALIBRATION_RESET_INHERIT_KEYS) {
        if (key in seed) { calibrated[key] = seed[key]; inheritedKeys.push(key) }
      }
    }
  }
  inheritedKeys = [...new Set(inheritedKeys)].sort()
  calibrated = stripUiFields(calibrated)
  const serialized = JSON.stringify(calibrated, null, 2)
  fs.writeFileSync(CONFIG_PATH, serialized)
  fs.writeFileSync(CONFIG_PATH + '.bak', serialized)
  return {
    mode: normalizedMode, source, backup: preBackup, inheritedKeys, warnings,
    message: normalizedMode === 'inherit' ? '配置已按继承模式校准' : '配置已按完全初始化修复模式校准',
  }
}

// === Ed25519 设备密钥管理 ===

function getOrCreateDeviceKey() {
  if (fs.existsSync(DEVICE_KEY_FILE)) {
    const data = JSON.parse(fs.readFileSync(DEVICE_KEY_FILE, 'utf8'))
    // 从存储的 hex 密钥重建 Node.js KeyObject
    const privDer = Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'), // PKCS8 Ed25519 header
      Buffer.from(data.secretKey, 'hex'),
    ])
    const privateKey = crypto.createPrivateKey({ key: privDer, format: 'der', type: 'pkcs8' })
    return { deviceId: data.deviceId, publicKey: data.publicKey, privateKey }
  }
  // 生成新密钥对
  const keyPair = crypto.generateKeyPairSync('ed25519')
  const pubDer = keyPair.publicKey.export({ type: 'spki', format: 'der' })
  const privDer = keyPair.privateKey.export({ type: 'pkcs8', format: 'der' })
  const pubRaw = pubDer.slice(-32)
  const privRaw = privDer.slice(-32)
  const deviceId = crypto.createHash('sha256').update(pubRaw).digest('hex')
  const publicKey = Buffer.from(pubRaw).toString('base64url')
  const secretHex = Buffer.from(privRaw).toString('hex')
  const keyData = { deviceId, publicKey, secretKey: secretHex }
  if (!fs.existsSync(OPENCLAW_DIR)) fs.mkdirSync(OPENCLAW_DIR, { recursive: true })
  fs.writeFileSync(DEVICE_KEY_FILE, JSON.stringify(keyData, null, 2))
  return { deviceId, publicKey, privateKey: keyPair.privateKey }
}

function getLocalIps() {
  const ips = []
  const ifaces = networkInterfaces()
  for (const name in ifaces) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address)
    }
  }
  return ips
}

// === Raw WebSocket（支持 Origin header，绕过 Gateway origin 检查）===
function rawWsConnect(host, port, wsPath) {
  return new Promise((ok, no) => {
    const key = crypto.randomBytes(16).toString('base64')
    const req = http.request({ hostname: host, port, path: wsPath, method: 'GET', headers: {
      'Connection': 'Upgrade', 'Upgrade': 'websocket', 'Sec-WebSocket-Version': '13',
      'Sec-WebSocket-Key': key, 'Origin': 'http://localhost',
    } })
    req.on('upgrade', (_, socket) => ok(socket))
    req.on('response', (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => no(new Error(`HTTP ${res.statusCode}`))) })
    req.on('error', no)
    req.setTimeout(5000, () => { req.destroy(); no(new Error('ws connect timeout')) })
    req.end()
  })
}
function wsReadFrame(socket, timeout = 8000) {
  return new Promise((ok, no) => {
    let settled = false
    const cleanup = () => {
      clearTimeout(t)
      socket.removeListener('data', onData)
      socket.removeListener('error', onError)
      socket.removeListener('close', onClose)
    }
    const finish = (fn) => (value) => {
      if (settled) return
      settled = true
      cleanup()
      fn(value)
    }
    const t = setTimeout(finish(no), timeout, new Error('ws read timeout'))
    let buf = Buffer.alloc(0)
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]); if (buf.length < 2) return
      let len = buf[1] & 0x7f, off = 2
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4 }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10 }
      if (buf.length < off + len) return
      finish(ok)(buf.slice(off, off + len).toString('utf8'))
    }
    const onError = finish(no)
    const onClose = finish(no)
    socket.on('data', onData)
    socket.on('error', onError)
    socket.on('close', () => onClose(new Error('ws closed')))
  })
}
function wsSendFrame(socket, text) {
  const p = Buffer.from(text, 'utf8'), mask = crypto.randomBytes(4)
  let h
  if (p.length < 126) { h = Buffer.alloc(2); h[0] = 0x81; h[1] = 0x80 | p.length }
  else { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0x80 | 126; h.writeUInt16BE(p.length, 2) }
  const m = Buffer.alloc(p.length); for (let i = 0; i < p.length; i++) m[i] = p[i] ^ mask[i % 4]
  socket.write(Buffer.concat([h, mask, m]))
}
// 持续读取 WS 帧，每条消息调用 onMessage，支持超时和取消
function wsReadLoop(socket, onMessage, timeoutMs = DOCKER_TASK_TIMEOUT_MS) {
  let buf = Buffer.alloc(0), done = false
  const timer = setTimeout(() => { done = true; socket.destroy() }, timeoutMs)
  const cancel = () => { done = true; clearTimeout(timer); try { socket.destroy() } catch {} }
  socket.on('data', (chunk) => {
    if (done) return
    buf = Buffer.concat([buf, chunk])
    while (buf.length >= 2) {
      const opcode = buf[0] & 0x0f
      let len = buf[1] & 0x7f, off = 2
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4 }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10 }
      if (buf.length < off + len) return
      const payload = buf.slice(off, off + len)
      buf = buf.slice(off + len)
      if (opcode === 0x08) { done = true; clearTimeout(timer); socket.destroy(); return } // close
      if (opcode === 0x09) { // ping → 回 pong
        const mask = crypto.randomBytes(4)
        const h = Buffer.alloc(2); h[0] = 0x8A; h[1] = 0x80 | payload.length
        const m = Buffer.alloc(payload.length); for (let i = 0; i < payload.length; i++) m[i] = payload[i] ^ mask[i % 4]
        try { socket.write(Buffer.concat([h, mask, m])) } catch {}
        continue
      }
      if (opcode === 0x01) onMessage(payload.toString('utf8')) // text
    }
  })
  socket.on('error', () => { done = true; clearTimeout(timer) })
  socket.on('close', () => { done = true; clearTimeout(timer) })
  return cancel
}

function patchGatewayOrigins() {
  if (!fs.existsSync(CONFIG_PATH)) return false
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  const origins = [
    'tauri://localhost',
    'https://tauri.localhost',
    'http://localhost',
    'http://localhost:1420',
    'http://127.0.0.1:1420',
  ]
  for (const ip of getLocalIps()) {
    origins.push(`http://${ip}:1420`)
  }
  const existing = config?.gateway?.controlUi?.allowedOrigins || []
  // 合并：保留用户已有的 origins，只追加 Privix 需要的
  const merged = [...new Set([...existing, ...origins])]
  // 幂等：已包含所有需要的 origin 时跳过写入
  if (origins.every(o => existing.includes(o))) return false
  if (!config.gateway) config.gateway = {}
  if (!config.gateway.controlUi) config.gateway.controlUi = {}
  config.gateway.controlUi.allowedOrigins = merged
  fs.copyFileSync(CONFIG_PATH, CONFIG_PATH + '.bak')
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
  return true
}

// === macOS 服务管理 ===

function macCheckService(label) {
  try {
    const uid = getUid()
    const output = execSync(`launchctl print gui/${uid}/${label} 2>&1`).toString()
    let state = '', pid = null
    for (const line of output.split('\n')) {
      if (!line.startsWith('\t') || line.startsWith('\t\t')) continue
      const trimmed = line.trim()
      if (trimmed.startsWith('pid = ')) pid = parseInt(trimmed.slice(6)) || null
      if (trimmed.startsWith('state = ')) state = trimmed.slice(8).trim()
    }
    // 有 PID 则用 kill -0 验证进程是否存活（比 state 字符串更可靠）
    if (pid) {
      try { execSync(`kill -0 ${pid} 2>&1`); return { running: true, pid } } catch {}
    }
    // 无 PID 时 fallback 到 pgrep（launchctl 可能还没刷出 PID）
    if (state === 'running' || state === 'waiting') {
      try {
        const pgrepOut = execSync(`pgrep -f "openclaw.*gateway" 2>/dev/null`).toString().trim()
        if (pgrepOut) {
          const fallbackPid = parseInt(pgrepOut.split('\n')[0]) || null
          if (fallbackPid) return { running: true, pid: fallbackPid }
        }
      } catch {}
    }
    return { running: state === 'running', pid }
  } catch {
    return { running: false, pid: null }
  }
}

function macStartService(label) {
  const uid = getUid()
  const plistPath = path.join(homedir(), `Library/LaunchAgents/${label}.plist`)
  if (!fs.existsSync(plistPath)) throw new Error(`plist 不存在: ${plistPath}`)
  try { execSync(`launchctl bootstrap gui/${uid} "${plistPath}" 2>&1`) } catch {}
  try { execSync(`launchctl kickstart gui/${uid}/${label} 2>&1`) } catch {}
}

function macStopService(label) {
  const uid = getUid()
  try { execSync(`launchctl bootout gui/${uid}/${label} 2>&1`) } catch {}
}

function macRestartService(label) {
  const uid = getUid()
  const plistPath = path.join(homedir(), `Library/LaunchAgents/${label}.plist`)
  try { execSync(`launchctl bootout gui/${uid}/${label} 2>&1`) } catch {}
  // 等待进程退出
  for (let i = 0; i < 15; i++) {
    const { running } = macCheckService(label)
    if (!running) break
    execSync('sleep 0.2')
  }
  try { execSync(`launchctl bootstrap gui/${uid} "${plistPath}" 2>&1`) } catch {}
  try { execSync(`launchctl kickstart -k gui/${uid}/${label} 2>&1`) } catch {}
}

// === Windows 服务管理 ===

function parseWindowsListeningPids(output, port) {
  const portSuffix = `:${port}`
  const pids = new Set()
  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    if (!line.includes('LISTENING') && !line.includes('侦听')) continue
    const parts = line.split(/\s+/)
    if (parts.length < 5) continue
    if (!parts[1]?.endsWith(portSuffix)) continue
    const pid = Number.parseInt(parts[4], 10)
    if (Number.isInteger(pid) && pid > 0) pids.add(pid)
  }
  return [...pids].sort((a, b) => a - b)
}

function looksLikeGatewayCommandLine(commandLine) {
  const text = String(commandLine || '').toLowerCase()
  return text.includes('openclaw') && text.includes('gateway')
}

function readWindowsProcessCommandLine(pid) {
  const script = `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"; if ($p) { [Console]::Out.Write($p.CommandLine) }`
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
    windowsHide: true,
    encoding: 'utf8',
  })
  if (result.status !== 0) return ''
  return String(result.stdout || '').trim()
}

function inspectWindowsPortOwners(port = readGatewayPort()) {
  const output = execSync('netstat -ano', { windowsHide: true }).toString()
  const listeningPids = parseWindowsListeningPids(output, port)
  const gatewayPids = []
  const foreignPids = []

  for (const pid of listeningPids) {
    const commandLine = readWindowsProcessCommandLine(pid)
    if (looksLikeGatewayCommandLine(commandLine)) gatewayPids.push(pid)
    else if (commandLine) foreignPids.push(pid)  // 只有确实读到非 Gateway 命令行时才归为 foreign
    else gatewayPids.push(pid)  // 命令行读不到时，假定为 Gateway（避免权限问题导致误报）
  }

  return {
    gatewayPids: [...new Set(gatewayPids)].sort((a, b) => a - b),
    foreignPids: [...new Set(foreignPids)].sort((a, b) => a - b),
  }
}

function formatPidList(pids) {
  return pids.map(String).join(', ')
}

function winStartGateway() {
  const port = readGatewayPort()
  const { gatewayPids, foreignPids } = inspectWindowsPortOwners(port)
  if (gatewayPids.length) return
  if (foreignPids.length) {
    throw new Error(`端口 ${port} 已被非 Gateway 进程占用 (PID: ${formatPidList(foreignPids)})，已阻止启动`)
  }

  // 确保日志目录存在
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true })
  const logPath = path.join(LOGS_DIR, 'gateway.log')
  const errPath = path.join(LOGS_DIR, 'gateway.err.log')
  const out = fs.openSync(logPath, 'a')
  const err = fs.openSync(errPath, 'a')

  // 写入启动标记到日志
  const timestamp = new Date().toISOString()
  fs.appendFileSync(logPath, `\n[${timestamp}] [Privix] Starting Gateway on Windows...\n`)

  // 用 cmd.exe /c 启动，不用 shell: true（避免额外 cmd.exe 进程链导致终端闪烁）
  const child = spawn('cmd.exe', ['/c', 'openclaw', 'gateway'], {
    detached: true,
    stdio: ['ignore', out, err],
    windowsHide: true,
    cwd: homedir(),
  })
  child.unref()
}

async function winStopGateway() {
  const port = readGatewayPort()
  const { gatewayPids, foreignPids } = inspectWindowsPortOwners(port)
  if (!gatewayPids.length) {
    if (foreignPids.length) {
      throw new Error(`端口 ${port} 当前由非 Gateway 进程占用 (PID: ${formatPidList(foreignPids)})，已拒绝停止以避免误杀`)
    }
    return
  }

  spawnSync('cmd.exe', ['/c', 'openclaw', 'gateway', 'stop'], {
    windowsHide: true,
    cwd: homedir(),
    encoding: 'utf8',
  })

  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 300))
    if (!(await winCheckGateway()).running) return
  }

  for (const pid of gatewayPids) {
    try {
      execSync(`taskkill /F /T /PID ${pid}`, { timeout: 5000, windowsHide: true })
    } catch {}
  }

  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 300))
    if (!(await winCheckGateway()).running) return
  }

  throw new Error(`停止失败：Gateway 仍占用端口 ${port}`)
}

// 仅当占用端口的确实是 OpenClaw Gateway 时才视为运行
async function winCheckGateway() {
  const port = readGatewayPort()
  const { gatewayPids } = inspectWindowsPortOwners(port)
  return {
    running: gatewayPids.length > 0,
    pid: gatewayPids[0] || null,
  }
}

function readGatewayPort() {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    return config?.gateway?.port || 18789
  } catch {
    return 18789
  }
}

// === Linux 服务管理 ===

/**
 * 扫描常见 Node 版本管理器路径查找 openclaw 二进制文件。
 * 解决 systemd 服务环境中 PATH 不含 nvm/volta/fnm 路径的问题。
 */
function findOpenclawBin() {
  try {
    return execSync('which openclaw 2>/dev/null', { stdio: 'pipe' }).toString().trim()
  } catch {}

  const home = homedir()
  const candidates = [
    '/usr/local/bin/openclaw',
    '/usr/bin/openclaw',
    '/snap/bin/openclaw',
    path.join(home, '.local/bin/openclaw'),
    // npm 全局安装路径（修复 #156：systemd 服务缺少 PATH 时 which 失败）
    path.join(home, '.npm-global/bin/openclaw'),
    path.join(home, '.npm/bin/openclaw'),
  ]

  // nvm
  const nvmDir = process.env.NVM_DIR || path.join(home, '.nvm')
  const nvmVersions = path.join(nvmDir, 'versions/node')
  if (fs.existsSync(nvmVersions)) {
    try {
      for (const entry of fs.readdirSync(nvmVersions)) {
        candidates.push(path.join(nvmVersions, entry, 'bin/openclaw'))
      }
    } catch {}
  }

  // volta
  candidates.push(path.join(home, '.volta/bin/openclaw'))

  // nodenv
  candidates.push(path.join(home, '.nodenv/shims/openclaw'))

  // fnm
  const fnmDir = process.env.FNM_DIR || path.join(home, '.local/share/fnm')
  const fnmVersions = path.join(fnmDir, 'node-versions')
  if (fs.existsSync(fnmVersions)) {
    try {
      for (const entry of fs.readdirSync(fnmVersions)) {
        candidates.push(path.join(fnmVersions, entry, 'installation/bin/openclaw'))
      }
    } catch {}
  }

  // /usr/local/lib/nodejs（手动安装的 Node.js）
  const nodejsLib = '/usr/local/lib/nodejs'
  if (fs.existsSync(nodejsLib)) {
    try {
      for (const entry of fs.readdirSync(nodejsLib)) {
        candidates.push(path.join(nodejsLib, entry, 'bin/openclaw'))
      }
    } catch {}
  }

  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return null
}

function linuxCheckGateway() {
  const port = readGatewayPort()
  // ss 查端口监听
  try {
    const out = execSync(`ss -tlnp 'sport = :${port}' 2>/dev/null`, { timeout: 3000 }).toString().trim()
    const pidMatch = out.match(/pid=(\d+)/)
    if (pidMatch) {
      const pid = parseInt(pidMatch[1])
      // 修复 #151: 验证进程是否是 OpenClaw，避免与其他占用同端口的程序冲突
      let isOpenClaw = false
      try {
        const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ')
        isOpenClaw = /openclaw/i.test(cmdline)
      } catch {
        isOpenClaw = true // 无法读取进程信息时保守认为是
      }
      return { running: true, pid, manageable: isOpenClaw }
    }
    if (out.includes(`:${port}`)) return { running: true, pid: null, manageable: false }
  } catch {}
  // fallback: lsof
  try {
    const out = execSync(`lsof -i :${port} -t 2>/dev/null`, { timeout: 3000 }).toString().trim()
    if (out) {
      const pid = parseInt(out.split('\n')[0]) || null
      if (pid) {
        let isOpenClaw = false
        try {
          const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ')
          isOpenClaw = /openclaw/i.test(cmdline)
        } catch {
          isOpenClaw = true
        }
        return { running: true, pid, manageable: isOpenClaw }
      }
      return { running: true, pid: null, manageable: false }
    }
  } catch {}
  // fallback: /proc/net/tcp
  try {
    const hexPort = port.toString(16).toUpperCase().padStart(4, '0')
    const tcp = fs.readFileSync('/proc/net/tcp', 'utf8')
    if (tcp.includes(`:${hexPort}`)) return { running: true, pid: null, manageable: false }
  } catch {}
  return { running: false, pid: null, manageable: false }
}

function linuxStartGateway() {
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true })
  const logPath = path.join(LOGS_DIR, 'gateway.log')
  const errPath = path.join(LOGS_DIR, 'gateway.err.log')
  const out = fs.openSync(logPath, 'a')
  const err = fs.openSync(errPath, 'a')

  const timestamp = new Date().toISOString()
  fs.appendFileSync(logPath, `\n[${timestamp}] [Privix] Starting Gateway on Linux...\n`)

  const bin = findOpenclawBin() || 'openclaw'
  const child = spawn(bin, ['gateway'], {
    detached: true,
    stdio: ['ignore', out, err],
    shell: false,
    cwd: homedir(),
  })
  child.unref()
}

function linuxStopGateway() {
  const { running, pid, manageable } = linuxCheckGateway()
  if (!running || !pid) throw new Error('Gateway 未运行')
  // 修复 #151: 检测到非 OpenClaw 进程占用端口时拒绝操作
  if (manageable === false) throw new Error(`端口已被其他进程 (PID ${pid}) 占用，无法操作`)
  try {
    process.kill(pid, 'SIGTERM')
  } catch (e) {
    try { process.kill(pid, 'SIGKILL') } catch {}
    throw new Error('停止失败: ' + (e.message || e))
  }
}

// === Docker Socket 通信 ===

function dockerRequest(method, apiPath, body = null, endpoint = null) {
  return new Promise((resolve, reject) => {
    const opts = { path: apiPath, method, headers: { 'Content-Type': 'application/json' } }
    if (endpoint && endpoint.startsWith('tcp://')) {
      const url = new URL(endpoint.replace('tcp://', 'http://'))
      opts.hostname = url.hostname
      opts.port = parseInt(url.port) || 2375
    } else {
      opts.socketPath = endpoint || DOCKER_SOCKET
    }
    const req = http.request(opts, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }) }
        catch { resolve({ status: res.statusCode, data }) }
      })
    })
    req.on('error', (e) => reject(new Error('Docker 连接失败: ' + e.message)))
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Docker API 超时')) })
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

// Docker exec 附着模式：运行命令并捕获 stdout/stderr（解析多路复用流）
function dockerExecRun(containerId, cmd, endpoint = null, timeout = DOCKER_TASK_TIMEOUT_MS) {
  return new Promise(async (resolve, reject) => {
    try {
      // 1. 创建 exec
      const createResp = await dockerRequest('POST', `/containers/${containerId}/exec`, {
        AttachStdout: true, AttachStderr: true, Cmd: cmd,
      }, endpoint)
      if (createResp.status >= 400) return reject(new Error(`exec create: ${createResp.status} ${createResp.data?.message || ''}`))
      const execId = createResp.data?.Id
      if (!execId) return reject(new Error('no exec ID'))

      // 2. 启动 exec（附着模式，捕获输出流）
      const opts = {
        path: `/exec/${execId}/start`, method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }
      if (endpoint && endpoint.startsWith('tcp://')) {
        const url = new URL(endpoint.replace('tcp://', 'http://'))
        opts.hostname = url.hostname
        opts.port = parseInt(url.port) || 2375
      } else {
        opts.socketPath = endpoint || DOCKER_SOCKET
      }

      const req = http.request(opts, (res) => {
        let stdout = '', stderr = ''
        let buf = Buffer.alloc(0)

        res.on('data', (chunk) => {
          buf = Buffer.concat([buf, chunk])
          // 解析 Docker 多路复用流：[type(1), 0(3), size(4)] + payload
          while (buf.length >= 8) {
            const streamType = buf[0] // 1=stdout, 2=stderr
            const size = buf.readUInt32BE(4)
            if (buf.length < 8 + size) break
            const payload = buf.slice(8, 8 + size).toString('utf8')
            buf = buf.slice(8 + size)
            if (streamType === 1) stdout += payload
            else if (streamType === 2) stderr += payload
          }
        })

        res.on('end', () => resolve({ stdout, stderr }))
        res.on('error', reject)
      })

      req.on('error', reject)
      req.setTimeout(timeout, () => { req.destroy(); reject(new Error('exec timeout')) })
      req.write(JSON.stringify({ Detach: false, Tty: false }))
      req.end()
    } catch (e) { reject(e) }
  })
}

// 查找 clawpanel-agent.cjs 脚本并注入到容器（.cjs 避免容器内 ESM 冲突）
function findAgentScript() {
  const candidates = [
    path.resolve(__dev_dirname, '../openclaw-docker/full/clawpanel-agent.cjs'),
    path.resolve(__dev_dirname, '../openclaw-docker/full/clawpanel-agent.js'),
    path.resolve(__dev_dirname, '../../openclaw-docker/full/clawpanel-agent.cjs'),
    path.resolve(__dev_dirname, '../../openclaw-docker/full/clawpanel-agent.js'),
    path.resolve(__dev_dirname, '../clawpanel-agent.cjs'),
    path.resolve(__dev_dirname, '../clawpanel-agent.js'),
    path.resolve(__dev_dirname, 'clawpanel-agent.cjs'),
    path.resolve(__dev_dirname, 'clawpanel-agent.js'),
  ]
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue
    const content = fs.readFileSync(p, 'utf8')
    return {
      path: p,
      content,
      hash: crypto.createHash('sha256').update(content).digest('hex'),
    }
  }
  return null
}

function getAgentSyncCacheKey(containerId, endpoint) {
  return `${endpoint || DOCKER_SOCKET}:${containerId}`
}

function createContainerShellExec(containerId, endpoint) {
  return async (shellCmd) => {
    const createResp = await dockerRequest('POST', `/containers/${containerId}/exec`, {
      AttachStdout: true, AttachStderr: true, Cmd: ['sh', '-c', shellCmd],
    }, endpoint)
    if (createResp.status >= 400) throw new Error(`exec 失败: ${createResp.status}`)
    const execId = createResp.data?.Id
    if (!execId) throw new Error('exec ID 缺失')
    await dockerRequest('POST', `/exec/${execId}/start`, { Detach: true }, endpoint)
    await new Promise(r => setTimeout(r, 300))
  }
}

async function injectAgentToContainer(containerId, endpoint, cExecFn, agentScript = null) {
  const source = agentScript || findAgentScript()
  if (!source) {
    console.warn('[agent] clawpanel-agent.cjs 未找到，跳过注入')
    return false
  }
  const b64 = Buffer.from(source.content, 'utf8').toString('base64')
  await cExecFn(`echo '${b64}' | base64 -d > /app/clawpanel-agent.cjs`)
  console.log(`[agent] agent 已同步 → ${containerId.slice(0, 12)} (${source.hash.slice(0, 8)})`)
  _agentScriptSyncCache.set(getAgentSyncCacheKey(containerId, endpoint), source.hash)
  return true
}

async function syncAgentToContainerIfNeeded(containerId, endpoint, cExecFn) {
  const source = findAgentScript()
  if (!source) {
    console.warn('[agent] 本地 agent 脚本缺失，跳过自动同步')
    return false
  }

  const cacheKey = getAgentSyncCacheKey(containerId, endpoint)
  if (_agentScriptSyncCache.get(cacheKey) === source.hash) {
    return true
  }

  return injectAgentToContainer(containerId, endpoint, cExecFn, source)
}

function readDockerNodes() {
  if (!fs.existsSync(DOCKER_NODES_PATH)) {
    return [{ id: 'local', name: '本机', type: 'socket', endpoint: DOCKER_SOCKET }]
  }
  try {
    const data = JSON.parse(fs.readFileSync(DOCKER_NODES_PATH, 'utf8'))
    return data.nodes || []
  } catch {
    return [{ id: 'local', name: '本机', type: 'socket', endpoint: DOCKER_SOCKET }]
  }
}

function saveDockerNodes(nodes) {
  if (!fs.existsSync(OPENCLAW_DIR)) fs.mkdirSync(OPENCLAW_DIR, { recursive: true })
  fs.writeFileSync(DOCKER_NODES_PATH, JSON.stringify({ nodes }, null, 2))
}

function isDockerAvailable() {
  if (isWindows) return true // named pipe, can't stat
  return fs.existsSync(DOCKER_SOCKET)
}

// === 镜像拉取进度追踪 ===
const _pullProgress = new Map()

// === 实例注册表 ===

const DEFAULT_LOCAL_INSTANCE = { id: 'local', name: '本机', type: 'local', endpoint: null, gatewayPort: 18789, addedAt: 0, note: '' }

function readInstances() {
  if (!fs.existsSync(INSTANCES_PATH)) {
    return { activeId: 'local', instances: [{ ...DEFAULT_LOCAL_INSTANCE }] }
  }
  try {
    const data = JSON.parse(fs.readFileSync(INSTANCES_PATH, 'utf8'))
    if (!data.instances?.length) data.instances = [{ ...DEFAULT_LOCAL_INSTANCE }]
    if (!data.instances.find(i => i.id === 'local')) data.instances.unshift({ ...DEFAULT_LOCAL_INSTANCE })
    if (!data.activeId || !data.instances.find(i => i.id === data.activeId)) data.activeId = 'local'
    return data
  } catch {
    return { activeId: 'local', instances: [{ ...DEFAULT_LOCAL_INSTANCE }] }
  }
}

function saveInstances(data) {
  if (!fs.existsSync(OPENCLAW_DIR)) fs.mkdirSync(OPENCLAW_DIR, { recursive: true })
  fs.writeFileSync(INSTANCES_PATH, JSON.stringify(data, null, 2))
}

function getActiveInstance() {
  const data = readInstances()
  return data.instances.find(i => i.id === data.activeId) || data.instances[0]
}

async function proxyToInstance(instance, cmd, body) {
  const url = `${instance.endpoint}/__api/${cmd}`
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await resp.text()
  try { return JSON.parse(text) }
  catch { return text }
}

async function instanceHealthCheck(instance) {
  const result = { id: instance.id, online: false, version: null, gatewayRunning: false, lastCheck: Date.now() }
  if (instance.type === 'local') {
    result.online = true
    try {
      const services = await handlers.get_services_status()
      result.gatewayRunning = services?.[0]?.running === true
    } catch {}
    try {
      const ver = await handlers.get_version_info()
      result.version = ver?.current
    } catch {}
    return result
  }
  // Docker 类型实例：通过 Docker API 检查容器状态
  if (instance.type === 'docker' && instance.containerId) {
    try {
      const nodes = readDockerNodes()
      const node = instance.nodeId ? nodes.find(n => n.id === instance.nodeId) : nodes[0]
      if (node) {
        const resp = await dockerRequest('GET', `/containers/${instance.containerId}/json`, null, node.endpoint)
        if (resp.status < 400 && resp.data?.State?.Running) {
          result.online = true
          result.gatewayRunning = true
        }
      }
    } catch {}
    return result
  }

  if (!instance.endpoint) return result
  try {
    const resp = await fetch(`${instance.endpoint}/__api/check_installation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(5000),
    })
    if (resp.ok) {
      const data = await resp.json()
      result.online = true
      result.version = data?.version || null
    }
  } catch {}
  if (result.online) {
    try {
      const resp = await fetch(`${instance.endpoint}/__api/get_services_status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(5000),
      })
      if (resp.ok) {
        const services = await resp.json()
        result.gatewayRunning = services?.[0]?.running === true
      }
    } catch {}
  }
  return result
}

// 始终在本机处理的命令（不代理到远程实例）
const ALWAYS_LOCAL = new Set([
  'instance_list', 'instance_add', 'instance_remove', 'instance_set_active',
  'instance_health_check', 'instance_health_all',
  'docker_info', 'docker_list_containers', 'docker_create_container',
  'docker_start_container', 'docker_stop_container', 'docker_restart_container',
  'docker_remove_container', 'docker_rebuild_container', 'docker_container_logs', 'docker_container_exec', 'docker_init_worker', 'docker_gateway_chat', 'docker_agent', 'docker_agent_broadcast', 'docker_dispatch_task', 'docker_dispatch_broadcast', 'docker_task_status', 'docker_task_list', 'docker_pull_image', 'docker_pull_status',
  'docker_list_images', 'docker_list_nodes', 'docker_add_node', 'docker_remove_node',
  'docker_cluster_overview',
  'auth_check', 'auth_login', 'auth_logout',
  'read_panel_config', 'write_panel_config', 'read_swarm_sessions', 'write_swarm_sessions',
  'get_openclaw_dir', 'doctor_check', 'doctor_fix',
  'diagnose_channel', 'repair_qqbot_channel_setup', 'calibrate_openclaw_config',
  'get_deploy_mode',
  'assistant_exec', 'assistant_read_file', 'assistant_write_file',
  'assistant_list_dir', 'assistant_system_info', 'assistant_list_processes',
  'assistant_check_port', 'assistant_web_search', 'assistant_fetch_url',
  'assistant_ensure_data_dir', 'assistant_save_image', 'assistant_load_image', 'assistant_delete_image',
  'invest_upload_document', 'invest_backfill_pool_from_excel', 'invest_cli',
])

// === 工具函数 ===

// Anthropic Messages 兼容 API 的认证 header
// Kimi Code（api.kimi.com / sk-kimi- key）使用 Bearer，原生 Anthropic 使用 x-api-key
function _addAnthropicAuth(headers, apiKey, baseUrl) {
  if (!apiKey) return
  if ((baseUrl && baseUrl.includes('kimi.com')) || apiKey.startsWith('sk-kimi-')) {
    headers['Authorization'] = `Bearer ${apiKey}`
  } else {
    headers['x-api-key'] = apiKey
  }
}

// 清理 base URL：去掉尾部斜杠和已知端点路径，防止路径重复
function _normalizeBaseUrl(raw) {
  let base = (raw || '').replace(/\/+$/, '')
  base = base.replace(/\/(api\/chat|api\/generate|api\/tags|api|chat\/completions|completions|responses|messages|models)\/?$/, '')
  base = base.replace(/\/+$/, '')
  if (/:11434$/i.test(base)) return `${base}/v1`
  return base
}

const QQBOT_DEFAULT_ACCOUNT_ID = 'default'
const OPENCLAW_QQBOT_EXTENSION_FOLDER = 'openclaw-qqbot'
const QQ_OPENCLAW_FAQ_URL = 'https://q.qq.com/qqbot/openclaw/faq.html'

function channelStorageKey(platform) {
  if (platform === 'dingtalk' || platform === 'dingtalk-connector') return 'dingtalk-connector'
  if (platform === 'weixin' || platform === 'openclaw-weixin') return 'openclaw-weixin'
  return platform
}

function channelListId(platform) {
  if (platform === 'dingtalk-connector') return 'dingtalk'
  if (platform === 'openclaw-weixin') return 'weixin'
  return platform
}

function qqbotChannelHasCredentials(val) {
  if (!val || typeof val !== 'object') return false
  return !!(val.appId || val.clientSecret || val.appSecret || val.token)
}

function ensurePluginsConfig(cfg) {
  if (!cfg.plugins || typeof cfg.plugins !== 'object') cfg.plugins = {}
  if (!Array.isArray(cfg.plugins.allow)) cfg.plugins.allow = []
  if (!cfg.plugins.entries || typeof cfg.plugins.entries !== 'object') cfg.plugins.entries = {}
  return cfg.plugins
}

function ensurePluginAllowed(cfg, pluginId) {
  const plugins = ensurePluginsConfig(cfg)
  if (!plugins.allow.includes(pluginId)) plugins.allow.push(pluginId)
  if (!plugins.entries[pluginId] || typeof plugins.entries[pluginId] !== 'object') {
    plugins.entries[pluginId] = {}
  }
  plugins.entries[pluginId].enabled = true
}

function disableLegacyPlugin(cfg, pluginId) {
  const plugins = ensurePluginsConfig(cfg)
  plugins.allow = plugins.allow.filter(v => v !== pluginId)
  if (plugins.entries[pluginId] && typeof plugins.entries[pluginId] === 'object') {
    plugins.entries[pluginId].enabled = false
  }
}

function ensureChatCompletionsEnabled(cfg) {
  if (!cfg.gateway || typeof cfg.gateway !== 'object') cfg.gateway = {}
  if (!cfg.gateway.http || typeof cfg.gateway.http !== 'object') cfg.gateway.http = {}
  if (!cfg.gateway.http.endpoints || typeof cfg.gateway.http.endpoints !== 'object') cfg.gateway.http.endpoints = {}
  if (!cfg.gateway.http.endpoints.chatCompletions || typeof cfg.gateway.http.endpoints.chatCompletions !== 'object') {
    cfg.gateway.http.endpoints.chatCompletions = {}
  }
  cfg.gateway.http.endpoints.chatCompletions.enabled = true
}

function stripLegacyQqbotPluginConfigKeys(cfg) {
  const plugins = ensurePluginsConfig(cfg)
  plugins.allow = plugins.allow.filter(v => v !== OPENCLAW_QQBOT_EXTENSION_FOLDER)
}

function ensureOpenclawQqbotPlugin(cfg) {
  stripLegacyQqbotPluginConfigKeys(cfg)
  ensurePluginAllowed(cfg, 'qqbot')
}

function qqbotPluginsAllowFlags(cfg) {
  const allow = Array.isArray(cfg?.plugins?.allow) ? cfg.plugins.allow : []
  return {
    allowQqbot: allow.includes('qqbot'),
    allowLegacy: allow.includes(OPENCLAW_QQBOT_EXTENSION_FOLDER),
  }
}

function qqbotEntryEnabledOk(cfg, pluginId = 'qqbot') {
  const entry = cfg?.plugins?.entries?.[pluginId]
  if (!entry || typeof entry !== 'object') return true
  return entry.enabled !== false
}

function qqbotExtensionInstalled() {
  const candidates = [
    path.join(OPENCLAW_DIR, 'extensions', OPENCLAW_QQBOT_EXTENSION_FOLDER),
    path.join(OPENCLAW_DIR, 'extensions', 'qqbot'),
  ]
  for (const pluginDir of candidates) {
    const installed = fs.existsSync(pluginDir) && (
      fs.existsSync(path.join(pluginDir, 'package.json'))
      || fs.existsSync(path.join(pluginDir, 'index.js'))
      || fs.existsSync(path.join(pluginDir, 'dist', 'index.js'))
    )
    if (installed) return { installed: true, location: pluginDir }
  }
  return { installed: false, location: null }
}

function qqbotPluginDiagnose(cfg) {
  const { installed, location } = qqbotExtensionInstalled()
  const { allowQqbot, allowLegacy } = qqbotPluginsAllowFlags(cfg)
  const entryOk = qqbotEntryEnabledOk(cfg, 'qqbot')
  const pluginOk = installed && allowQqbot && entryOk
  let detail = `本地扩展：${installed ? '已检测到插件文件' : '未检测到（~/.openclaw/extensions/openclaw-qqbot 或旧版 …/qqbot）'}（目录：${location || '—'}）；plugins.allow：qqbot=${allowQqbot}、误识别 openclaw-qqbot=${allowLegacy}；plugins.entries.qqbot 未禁用=${entryOk}`
  if (allowLegacy && !allowQqbot) {
    detail += '。plugins.allow 仅有 openclaw-qqbot 不够，需包含 qqbot。'
  } else if (installed && allowQqbot && !entryOk) {
    detail += '。plugins.entries.qqbot 已存在但被禁用，请启用后重试。'
  }
  return { pluginOk, detail }
}

function canConnectTcp(host, port, timeoutMs = 2000) {
  return new Promise(resolve => {
    const socket = new net.Socket()
    let done = false
    const finish = (ok) => {
      if (done) return
      done = true
      try { socket.destroy() } catch {}
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(port, host)
  })
}

async function diagnoseQqbotChannel(accountId = null) {
  const port = readGatewayPort()
  const cfg = fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) : {}
  const checks = []

  const saved = handlers.read_platform_config({ platform: 'qqbot', accountId })
  const exists = !!saved?.exists
  const values = saved?.values || {}

  let credOk = false
  if (!exists) {
    checks.push({
      id: 'credentials',
      ok: false,
      title: 'QQ 凭证已写入配置',
      detail: '未在 openclaw.json 中找到 qqbot 渠道配置，请先在「消息渠道」页完成接入并保存。',
    })
  } else {
    try {
      const result = await handlers.verify_bot_token({ platform: 'qqbot', form: values })
      if (result?.valid) {
        checks.push({
          id: 'credentials',
          ok: true,
          title: 'QQ 开放平台凭证（getAppAccessToken）',
          detail: Array.isArray(result.details) && result.details.length
            ? result.details.join(' · ')
            : 'AppID / ClientSecret 可通过腾讯接口换取 access_token。',
        })
        credOk = true
      } else {
        checks.push({
          id: 'credentials',
          ok: false,
          title: 'QQ 开放平台凭证（getAppAccessToken）',
          detail: Array.isArray(result?.errors) && result.errors.length ? result.errors.join('；') : '凭证校验失败',
        })
      }
    } catch (e) {
      checks.push({
        id: 'credentials',
        ok: false,
        title: 'QQ 开放平台凭证（getAppAccessToken）',
        detail: String(e?.message || e),
      })
    }
  }

  const qqEnabled = cfg?.channels?.qqbot?.enabled !== false
  checks.push({
    id: 'qq_channel_enabled',
    ok: qqEnabled,
    title: '配置中 QQ 渠道已启用',
    detail: qqEnabled
      ? 'channels.qqbot.enabled 为 true（或未显式关闭）。'
      : 'channels.qqbot.enabled 为 false，Gateway 不会连接 QQ，请在渠道卡片中启用。',
  })

  const chatOn = cfg?.gateway?.http?.endpoints?.chatCompletions?.enabled === true
  checks.push({
    id: 'chat_completions',
    ok: chatOn,
    title: 'Gateway HTTP · chatCompletions 端点',
    detail: chatOn
      ? 'gateway.http.endpoints.chatCompletions.enabled 已开启。'
      : '未启用 chatCompletions 时，QQ 机器人常见表现是无法正常回复或返回 405。',
  })

  const { pluginOk, detail: pluginDetail } = qqbotPluginDiagnose(cfg)
  checks.push({
    id: 'qq_plugin',
    ok: pluginOk,
    title: 'QQ 机器人插件（qqbot / openclaw-qqbot）',
    detail: pluginDetail,
  })

  const tcpOk = await canConnectTcp('127.0.0.1', port, 2000)
  checks.push({
    id: 'gateway_tcp',
    ok: tcpOk,
    title: `本机 Gateway 端口 ${port}（TCP）`,
    detail: tcpOk
      ? `2 秒内可连接到 127.0.0.1:${port}。`
      : `无法连接 127.0.0.1:${port}。QQ 提示「灵魂不在线」时，最常见原因是本机 Gateway 未运行或端口未监听。`,
  })

  let httpOk = false
  let httpDetail = '已跳过（TCP 未连通）。'
  if (tcpOk) {
    for (const probePath of ['/__api/health', '/health']) {
      const url = `http://127.0.0.1:${port}${probePath}`
      try {
        const resp = await fetch(url, { signal: AbortSignal.timeout(3000) })
        httpDetail = `GET ${url} -> HTTP ${resp.status}`
        if (resp.ok || (resp.status >= 300 && resp.status < 400)) {
          httpOk = true
          break
        }
      } catch (e) {
        httpDetail = `请求 ${url} 失败: ${e.message}`
      }
    }
  }
  checks.push({
    id: 'gateway_http',
    ok: httpOk,
    title: 'Gateway HTTP 健康探测',
    detail: httpDetail,
  })

  return {
    platform: 'qqbot',
    gatewayPort: port,
    faqUrl: QQ_OPENCLAW_FAQ_URL,
    checks,
    overallReady: credOk && qqEnabled && chatOn && pluginOk && tcpOk && httpOk,
    userHints: [
      'QQ 客户端提示「灵魂不在线」通常表示腾讯侧能收到消息，但本机 OpenClaw Gateway 未就绪或 QQ 长连接未建立。',
      `请确认 Gateway 已启动，且配置中的 gateway.port（当前 ${port}）与实际监听端口一致。`,
      `如仍异常，请继续对照官方 FAQ：${QQ_OPENCLAW_FAQ_URL}`,
    ],
  }
}

function createAgentBinding(cfg, agentId, channel, accountId = null, bindingConfig = {}) {
  if (!Array.isArray(cfg.bindings)) cfg.bindings = []
  const match = { channel }
  if (accountId) match.accountId = accountId
  if (bindingConfig && typeof bindingConfig === 'object') {
    for (const [key, value] of Object.entries(bindingConfig)) {
      if (key === 'channel' || key === 'accountId') continue
      if (key === 'peer') {
        if (typeof value === 'string' && value.trim()) {
          match.peer = { kind: 'direct', id: value.trim() }
        } else if (value && typeof value === 'object' && value.id) {
          match.peer = { kind: value.kind || 'direct', id: value.id }
        }
      } else {
        match[key] = value
      }
    }
  }
  const next = { type: 'route', agentId, match }
  const idx = cfg.bindings.findIndex(b => b?.agentId === agentId
    && b?.match?.channel === channel
    && (b?.match?.accountId || null) === (accountId || null))
  if (idx >= 0) cfg.bindings[idx] = next
  else cfg.bindings.push(next)
}

// === API Handlers ===

const handlers = {
  // 配置读写
  read_openclaw_config() {
    if (!fs.existsSync(CONFIG_PATH)) throw new Error('openclaw.json 不存在，请先安装 OpenClaw')
    const content = fs.readFileSync(CONFIG_PATH, 'utf8')
    return JSON.parse(content)
  },

  write_openclaw_config({ config }) {
    const bak = CONFIG_PATH + '.bak'
    if (fs.existsSync(CONFIG_PATH)) fs.copyFileSync(CONFIG_PATH, bak)
    const cleaned = stripUiFields(config)
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cleaned, null, 2))
    return true
  },

  read_mcp_config() {
    if (!fs.existsSync(MCP_CONFIG_PATH)) return {}
    return JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, 'utf8'))
  },

  write_mcp_config({ config }) {
    fs.writeFileSync(MCP_CONFIG_PATH, JSON.stringify(config, null, 2))
    return true
  },

  // 服务管理
  async get_services_status() {
    const label = 'ai.openclaw.gateway'
    let { running, pid } = isMac ? macCheckService(label) : isLinux ? linuxCheckGateway() : await winCheckGateway()

    // 通用兜底：进程检测说没运行，但端口实际在监听 → Gateway 已在运行
    if (!running) {
      const port = readGatewayPort()
      const portOpen = await new Promise(resolve => {
        const sock = net.createConnection(port, '127.0.0.1', () => { sock.destroy(); resolve(true) })
        sock.on('error', () => resolve(false))
        sock.setTimeout(2000, () => { sock.destroy(); resolve(false) })
      })
      if (portOpen) { running = true }
    }

    let cliInstalled = false
    if (isWindows) {
      try { cliInstalled = fs.existsSync(path.join(process.env.APPDATA || '', 'npm', 'openclaw.cmd')) }
      catch { cliInstalled = false }
    } else {
      // macOS + Linux: 统一使用 findOpenclawBin()，支持 nvm/volta/fnm/.local 等路径
      cliInstalled = !!findOpenclawBin()
    }

    return [{ label, running, pid, description: 'OpenClaw Gateway', cli_installed: cliInstalled }]
  },

  start_service({ label }) {
    // 修复 #159: Docker 双容器模式下禁止本地启动 Gateway
    if (process.env.DISABLE_GATEWAY_SPAWN === '1' || process.env.DISABLE_GATEWAY_SPAWN === 'true') {
      throw new Error('本地 Gateway 启动已禁用（DISABLE_GATEWAY_SPAWN=1），请使用远程 Gateway')
    }
    if (isMac) { macStartService(label); return true }
    if (isLinux) { linuxStartGateway(); return true }
    winStartGateway()
    return true
  },

  async stop_service({ label }) {
    if (isMac) { macStopService(label); return true }
    if (isLinux) { linuxStopGateway(); return true }
    await winStopGateway()
    return true
  },

  async restart_service({ label }) {
    if (isMac) { macRestartService(label); return true }
    if (isLinux) {
      try { linuxStopGateway() } catch {}
      for (let i = 0; i < 10; i++) {
        const { running } = linuxCheckGateway()
        if (!running) break
        await new Promise(r => setTimeout(r, 500))
      }
      linuxStartGateway()
      return true
    }
    await winStopGateway()
    for (let i = 0; i < 10; i++) {
      const { running } = await winCheckGateway()
      if (!running) break
      await new Promise(r => setTimeout(r, 500))
    }
    winStartGateway()
    return true
  },

  reload_gateway() {
    if (isMac) {
      macRestartService('ai.openclaw.gateway')
      return 'Gateway 已重启'
    } else if (isLinux) {
      try { linuxStopGateway() } catch {}
      linuxStartGateway()
      return 'Gateway 已重启'
    } else {
      throw new Error('Windows 请使用 Tauri 桌面应用')
    }
  },

  restart_gateway() {
    if (isMac) {
      macRestartService('ai.openclaw.gateway')
      return 'Gateway 已重启'
    } else if (isLinux) {
      try { linuxStopGateway() } catch {}
      linuxStartGateway()
      return 'Gateway 已重启'
    } else {
      throw new Error('Windows 请使用 Tauri 桌面应用')
    }
  },

  // === 消息渠道管理 ===

  list_configured_platforms() {
    if (!fs.existsSync(CONFIG_PATH)) return []
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    const channels = cfg.channels || {}
    return Object.entries(channels).map(([id, val]) => ({
      id: channelListId(id),
      enabled: val?.enabled !== false,
      accounts: Object.entries(val?.accounts || {}).map(([accountId, acct]) => ({
        accountId,
        appId: acct?.appId || '',
      })),
    }))
  },

  read_platform_config({ platform, accountId = null }) {
    if (!fs.existsSync(CONFIG_PATH)) return { exists: false }
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    const storageKey = channelStorageKey(platform)
    const root = cfg.channels?.[storageKey]
    let saved = root
    if (accountId && root?.accounts?.[accountId]) saved = root.accounts[accountId]
    if (!saved) return { exists: false }
    const form = {}
    if (platform === 'qqbot') {
      const target = accountId
        ? root?.accounts?.[accountId]
        : qqbotChannelHasCredentials(root) ? root : root?.accounts?.[QQBOT_DEFAULT_ACCOUNT_ID] || root
      const token = target?.token || ''
      const [appId, ...rest] = String(token).split(':')
      if (target?.appId || appId) form.appId = target?.appId || appId
      if (target?.clientSecret || target?.appSecret || rest.length) form.clientSecret = target?.clientSecret || target?.appSecret || rest.join(':')
    } else if (platform === 'telegram') {
      if (saved.botToken) form.botToken = saved.botToken
      if (saved.allowFrom) form.allowedUsers = saved.allowFrom.join(', ')
    } else if (platform === 'discord') {
      if (saved.token) form.token = saved.token
      const gid = saved.guilds && Object.keys(saved.guilds)[0]
      if (gid) form.guildId = gid
      const cid = gid ? Object.keys(saved.guilds?.[gid]?.channels || {}).find(k => k !== '*') : ''
      if (cid) form.channelId = cid
    } else if (platform === 'feishu') {
      if (saved.appId) form.appId = saved.appId
      if (saved.appSecret) form.appSecret = saved.appSecret
      if ((root || saved).domain) form.domain = (root || saved).domain
    } else {
      for (const [k, v] of Object.entries(saved)) {
        if (k !== 'enabled' && typeof v === 'string') form[k] = v
      }
    }
    return { exists: true, values: form }
  },

  save_messaging_platform({ platform, form, accountId = null, agentId = null, originalAccountId = null }) {
    if (!fs.existsSync(CONFIG_PATH)) throw new Error('openclaw.json 不存在')
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    if (!cfg.channels) cfg.channels = {}
    const storageKey = channelStorageKey(platform)
    const entry = { enabled: true }
    if (platform === 'qqbot') {
      const acct = accountId || QQBOT_DEFAULT_ACCOUNT_ID
      if (!cfg.channels.qqbot || typeof cfg.channels.qqbot !== 'object') cfg.channels.qqbot = { enabled: true }
      cfg.channels.qqbot.enabled = true
      delete cfg.channels.qqbot.appId
      delete cfg.channels.qqbot.clientSecret
      delete cfg.channels.qqbot.appSecret
      delete cfg.channels.qqbot.token
      if (!cfg.channels.qqbot.accounts || typeof cfg.channels.qqbot.accounts !== 'object') cfg.channels.qqbot.accounts = {}
      cfg.channels.qqbot.accounts[acct] = {
        enabled: true,
        appId: form.appId,
        clientSecret: form.clientSecret || form.appSecret,
        token: `${form.appId}:${form.clientSecret || form.appSecret}`,
      }
      if (originalAccountId && originalAccountId !== acct) {
        delete cfg.channels.qqbot.accounts[originalAccountId]
      }
      ensureOpenclawQqbotPlugin(cfg)
      ensureChatCompletionsEnabled(cfg)
    } else if (platform === 'telegram') {
      entry.botToken = form.botToken
      if (form.allowedUsers) entry.allowFrom = form.allowedUsers.split(',').map(s => s.trim()).filter(Boolean)
      cfg.channels[storageKey] = entry
    } else if (platform === 'discord') {
      entry.token = form.token
      entry.groupPolicy = 'allowlist'
      entry.dm = { enabled: false }
      if (form.guildId) {
        const ck = form.channelId || '*'
        entry.guilds = { [form.guildId]: { users: ['*'], requireMention: true, channels: { [ck]: { allow: true, requireMention: true } } } }
      }
      cfg.channels[storageKey] = entry
    } else if (platform === 'feishu') {
      entry.appId = form.appId
      entry.appSecret = form.appSecret
      entry.connectionMode = 'websocket'
      if (form.domain) entry.domain = form.domain
      if (accountId) {
        if (!cfg.channels[storageKey] || typeof cfg.channels[storageKey] !== 'object') cfg.channels[storageKey] = { enabled: true }
        cfg.channels[storageKey].enabled = true
        if (form.domain) cfg.channels[storageKey].domain = form.domain
        cfg.channels[storageKey].connectionMode = 'websocket'
        if (!cfg.channels[storageKey].accounts || typeof cfg.channels[storageKey].accounts !== 'object') cfg.channels[storageKey].accounts = {}
        const acctEntry = { ...entry }
        delete acctEntry.domain
        delete acctEntry.connectionMode
        cfg.channels[storageKey].accounts[accountId] = acctEntry
        if (originalAccountId && originalAccountId !== accountId) {
          delete cfg.channels[storageKey].accounts[originalAccountId]
        }
      } else {
        cfg.channels[storageKey] = entry
      }
      ensurePluginAllowed(cfg, 'openclaw-lark')
      disableLegacyPlugin(cfg, 'feishu')
    } else if (platform === 'dingtalk' || platform === 'dingtalk-connector') {
      entry.clientId = form.clientId
      entry.clientSecret = form.clientSecret
      if (form.gatewayToken) entry.gatewayToken = form.gatewayToken
      if (form.gatewayPassword) entry.gatewayPassword = form.gatewayPassword
      cfg.channels[storageKey] = entry
      ensurePluginAllowed(cfg, 'dingtalk-connector')
      ensureChatCompletionsEnabled(cfg)
    } else {
      Object.assign(entry, form)
      cfg.channels[storageKey] = entry
    }
    if (agentId) createAgentBinding(cfg, agentId, storageKey, accountId || null)
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2))
    return { ok: true }
  },

  remove_messaging_platform({ platform, accountId = null }) {
    if (!fs.existsSync(CONFIG_PATH)) throw new Error('openclaw.json 不存在')
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    const storageKey = channelStorageKey(platform)
    if (cfg.channels) {
      if (accountId && cfg.channels?.[storageKey]?.accounts) {
        delete cfg.channels[storageKey].accounts[accountId]
      } else {
        delete cfg.channels[storageKey]
      }
    }
    if (Array.isArray(cfg.bindings)) {
      cfg.bindings = cfg.bindings.filter(b => {
        if (b?.match?.channel !== storageKey) return true
        if (!accountId) return false
        return b?.match?.accountId !== accountId
      })
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2))
    return { ok: true }
  },

  toggle_messaging_platform({ platform, enabled }) {
    if (!fs.existsSync(CONFIG_PATH)) throw new Error('openclaw.json 不存在')
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    const storageKey = channelStorageKey(platform)
    if (!cfg.channels?.[storageKey]) throw new Error(`平台 ${platform} 未配置`)
    cfg.channels[storageKey].enabled = enabled
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2))
    return { ok: true }
  },

  async verify_bot_token({ platform, form }) {
    if (platform === 'feishu') {
      const domain = (form.domain || '').trim()
      const base = domain === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn'
      try {
        const resp = await fetch(`${base}/open-apis/auth/v3/tenant_access_token/internal`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ app_id: form.appId, app_secret: form.appSecret }),
          signal: AbortSignal.timeout(15000),
        })
        const body = await resp.json()
        if (body.code === 0) return { valid: true, errors: [], details: [`App ID: ${form.appId}`] }
        return { valid: false, errors: [body.msg || '凭证无效'] }
      } catch (e) {
        return { valid: false, errors: [`飞书 API 连接失败: ${e.message}`] }
      }
    }
    if (platform === 'qqbot') {
      try {
        const resp = await fetch('https://bots.qq.com/app/getAppAccessToken', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appId: form.appId, clientSecret: form.clientSecret || form.appSecret }),
          signal: AbortSignal.timeout(15000),
        })
        const body = await resp.json()
        if (body.access_token) return { valid: true, errors: [], details: [`AppID: ${form.appId}`] }
        return { valid: false, errors: [body.message || body.msg || '凭证无效'] }
      } catch (e) {
        return { valid: false, errors: [`QQ Bot API 连接失败: ${e.message}`] }
      }
    }
    if (platform === 'telegram') {
      try {
        const resp = await fetch(`https://api.telegram.org/bot${form.botToken}/getMe`, { signal: AbortSignal.timeout(15000) })
        const body = await resp.json()
        if (body.ok) return { valid: true, errors: [], details: [`Bot: @${body.result?.username}`] }
        return { valid: false, errors: [body.description || 'Token 无效'] }
      } catch (e) {
        return { valid: false, errors: [`Telegram API 连接失败: ${e.message}`] }
      }
    }
    if (platform === 'discord') {
      try {
        const resp = await fetch('https://discord.com/api/v10/users/@me', {
          headers: { Authorization: `Bot ${form.token}` },
          signal: AbortSignal.timeout(15000),
        })
        if (resp.status === 401) return { valid: false, errors: ['Bot Token 无效'] }
        const body = await resp.json()
        if (body.bot) return { valid: true, errors: [], details: [`Bot: @${body.username}`] }
        return { valid: false, errors: ['提供的 Token 不属于 Bot 账号'] }
      } catch (e) {
        return { valid: false, errors: [`Discord API 连接失败: ${e.message}`] }
      }
    }
    return { valid: true, warnings: ['该平台暂不支持在线校验'] }
  },

  async diagnose_channel({ platform, accountId = null }) {
    if (platform !== 'qqbot') {
      throw new Error(`暂不支持平台「${platform}」的深度诊断（当前仅实现 qqbot）`)
    }
    return diagnoseQqbotChannel(accountId || null)
  },

  repair_qqbot_channel_setup() {
    const bin = findOpenclawBin() || 'openclaw'
    const { installed } = qqbotExtensionInstalled()
    if (!installed) {
      try {
        execSync(`${bin} plugins install @tencent-connect/openclaw-qqbot@latest`, {
          timeout: 120000,
          cwd: homedir(),
          stdio: 'pipe',
        })
      } catch (e) {
        throw new Error('QQBot 插件安装失败: ' + (e.stderr?.toString() || e.message || e))
      }
      const cfg = fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) : {}
      ensureOpenclawQqbotPlugin(cfg)
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2))
      return { ok: true, action: 'installed', message: '已安装腾讯 openclaw-qqbot 插件并补齐配置' }
    }

    const cfg = fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) : {}
    ensureOpenclawQqbotPlugin(cfg)
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2))
    return { ok: true, action: 'config_repaired', message: '已补齐 QQ 插件配置' }
  },

  calibrate_openclaw_config({ mode } = {}) {
    return calibrateOpenclawConfig(mode)
  },

  install_qqbot_plugin() {
    const bin = findOpenclawBin() || 'openclaw'
    try {
      execSync(`${bin} plugins install @tencent-connect/openclaw-qqbot@latest`, { timeout: 120000, cwd: homedir() })
      const cfg = fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) : {}
      ensureOpenclawQqbotPlugin(cfg)
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2))
      return '安装成功'
    } catch (e) {
      throw new Error('QQBot 插件安装失败: ' + (e.message || e))
    }
  },

  get_channel_plugin_status({ pluginId }) {
    if (!pluginId || !pluginId.trim()) throw new Error('pluginId 不能为空')
    const pid = pluginId.trim()
    const pluginDir = pid === 'qqbot'
      ? (fs.existsSync(path.join(OPENCLAW_DIR, 'extensions', OPENCLAW_QQBOT_EXTENSION_FOLDER))
          ? path.join(OPENCLAW_DIR, 'extensions', OPENCLAW_QQBOT_EXTENSION_FOLDER)
          : path.join(OPENCLAW_DIR, 'extensions', 'qqbot'))
      : path.join(OPENCLAW_DIR, 'extensions', pid)
    const installed = fs.existsSync(pluginDir) && (
      fs.existsSync(path.join(pluginDir, 'package.json'))
      || fs.existsSync(path.join(pluginDir, 'index.js'))
      || fs.existsSync(path.join(pluginDir, 'dist', 'index.js'))
    )
    // 检测是否为内置插件
    const bin = findOpenclawBin() || 'openclaw'
    let builtin = false
    try {
      const result = spawnSync(bin, ['plugins', 'list'], { timeout: 10000, encoding: 'utf8', cwd: homedir() })
      const output = (result.stdout || '') + (result.stderr || '')
      if (output.includes(pid) && output.includes('built-in')) builtin = true
    } catch {}
    const cfg = fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) : {}
    const allowArr = cfg.plugins?.allow || []
    const allowed = allowArr.includes(pid)
    const enabled = !!cfg.plugins?.entries?.[pid]?.enabled
    const backupDir = path.join(OPENCLAW_DIR, 'plugin-backups', pid)
    const legacyBackup = path.join(OPENCLAW_DIR, 'extensions', `${pid}.__clawpanel_backup`)
    return {
      installed, builtin, path: pluginDir,
      allowed, enabled,
      legacyBackupDetected: fs.existsSync(backupDir) || fs.existsSync(legacyBackup),
    }
  },

  install_channel_plugin({ packageName, pluginId }) {
    if (!packageName || !pluginId) throw new Error('packageName 和 pluginId 不能为空')
    const bin = findOpenclawBin() || 'openclaw'
    try {
      execSync(`${bin} plugins install ${packageName.trim()}`, { timeout: 120000, cwd: homedir() })
      return '安装成功'
    } catch (e) {
      throw new Error(`插件 ${pluginId} 安装失败: ` + (e.message || e))
    }
  },

  async check_weixin_plugin_status() {
    const extDir = path.join(OPENCLAW_DIR, 'extensions', 'openclaw-weixin')
    let installed = false
    let installedVersion = null
    const pkgPath = path.join(extDir, 'package.json')
    if (fs.existsSync(pkgPath)) {
      installed = true
      try {
        installedVersion = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))?.version || null
      } catch {}
    }

    let latestVersion = null
    try {
      const resp = await fetch('https://registry.npmjs.org/@tencent-weixin/openclaw-weixin/latest', {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      })
      if (resp.ok) {
        latestVersion = (await resp.json())?.version || null
      }
    } catch {}

    return {
      installed,
      installedVersion,
      latestVersion,
      updateAvailable: !!(installedVersion && latestVersion && versionCompare(latestVersion, installedVersion) > 0),
      extensionDir: extDir,
    }
  },

  run_channel_action({ platform, action }) {
    const targetPlatform = String(platform || '').trim()
    const targetAction = String(action || '').trim()
    if (!targetPlatform || !targetAction) throw new Error('platform 和 action 不能为空')
    if (targetPlatform === 'weixin' && targetAction === 'install') {
      execSync('npx -y @tencent-weixin/openclaw-weixin-cli@latest install', { timeout: 600000, cwd: homedir(), stdio: 'pipe' })
      return '微信插件安装完成'
    }
    const bin = findOpenclawBin() || 'openclaw'
    const channelId = targetPlatform === 'weixin' ? 'openclaw-weixin' : targetPlatform
    if (targetAction === 'login') {
      execSync(`${bin} channels login --channel ${channelId}`, { timeout: 600000, cwd: homedir(), stdio: 'pipe' })
      if (targetPlatform === 'weixin') {
        const cfg = fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) : {}
        if (!cfg.channels) cfg.channels = {}
        cfg.channels['openclaw-weixin'] = { ...(cfg.channels['openclaw-weixin'] || {}), enabled: true }
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2))
      }
      return '登录完成'
    }
    throw new Error(`不支持的渠道动作: ${targetAction}`)
  },

  list_all_bindings() {
    if (!fs.existsSync(CONFIG_PATH)) return { bindings: [] }
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    return { bindings: Array.isArray(cfg.bindings) ? cfg.bindings : [] }
  },

  save_agent_binding({ agentId, channel, accountId = null, bindingConfig = {} }) {
    if (!fs.existsSync(CONFIG_PATH)) throw new Error('openclaw.json 不存在')
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    createAgentBinding(cfg, agentId, channel, accountId || null, bindingConfig || {})
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2))
    return { ok: true, warnings: [] }
  },

  delete_agent_binding({ agentId, channel, accountId = null }) {
    if (!fs.existsSync(CONFIG_PATH)) throw new Error('openclaw.json 不存在')
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    if (!Array.isArray(cfg.bindings)) cfg.bindings = []
    cfg.bindings = cfg.bindings.filter(binding => {
      if (binding?.agentId !== agentId) return true
      if (binding?.match?.channel !== channel) return true
      return (binding?.match?.accountId || null) !== (accountId || null)
    })
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2))
    return { ok: true }
  },

  async pairing_list_channel({ channel }) {
    if (!channel || !channel.trim()) throw new Error('channel 不能为空')
    const bin = findOpenclawBin() || 'openclaw'
    try {
      const output = execSync(`${bin} pairing list ${channel.trim()}`, { timeout: 15000, encoding: 'utf8', cwd: homedir() })
      return output.trim() || '暂无待审批请求'
    } catch (e) {
      throw new Error('执行 openclaw pairing list 失败: ' + (e.stderr || e.message || e))
    }
  },

  async pairing_approve_channel({ channel, code, notify }) {
    if (!channel || !channel.trim()) throw new Error('channel 不能为空')
    if (!code || !code.trim()) throw new Error('配对码不能为空')
    const bin = findOpenclawBin() || 'openclaw'
    const args = ['pairing', 'approve', channel.trim(), code.trim().toUpperCase()]
    if (notify) args.push('--notify')
    try {
      const output = execSync(`${bin} ${args.join(' ')}`, { timeout: 15000, encoding: 'utf8', cwd: homedir() })
      return output.trim() || '操作完成'
    } catch (e) {
      throw new Error('执行 openclaw pairing approve 失败: ' + (e.stderr || e.message || e))
    }
  },

  // === 实例管理 ===

  instance_list() {
    const data = readInstances()
    return data
  },

  instance_add({ name, type, endpoint, gatewayPort, containerId, nodeId, note }) {
    if (!name) throw new Error('实例名称不能为空')
    if (!endpoint) throw new Error('端点地址不能为空')
    const data = readInstances()
    const id = type === 'docker' ? `docker-${(containerId || Date.now().toString(36)).slice(0, 12)}` : `remote-${Date.now().toString(36)}`
    if (data.instances.find(i => i.endpoint === endpoint)) throw new Error('该端点已存在')
    data.instances.push({
      id, name, type: type || 'remote', endpoint,
      gatewayPort: gatewayPort || 18789,
      containerId: containerId || null,
      nodeId: nodeId || null,
      addedAt: Math.floor(Date.now() / 1000),
      note: note || '',
    })
    saveInstances(data)
    return { id, name }
  },

  instance_remove({ id }) {
    if (id === 'local') throw new Error('本机实例不可删除')
    const data = readInstances()
    data.instances = data.instances.filter(i => i.id !== id)
    if (data.activeId === id) data.activeId = 'local'
    saveInstances(data)
    return true
  },

  instance_set_active({ id }) {
    const data = readInstances()
    if (!data.instances.find(i => i.id === id)) throw new Error('实例不存在')
    data.activeId = id
    saveInstances(data)
    return { activeId: id }
  },

  async instance_health_check({ id }) {
    const data = readInstances()
    const instance = data.instances.find(i => i.id === id)
    if (!instance) throw new Error('实例不存在')
    return instanceHealthCheck(instance)
  },

  async instance_health_all() {
    const data = readInstances()
    const results = await Promise.allSettled(data.instances.map(i => instanceHealthCheck(i)))
    return results.map((r, idx) => r.status === 'fulfilled' ? r.value : { id: data.instances[idx].id, online: false, lastCheck: Date.now() })
  },

  // === Docker 集群管理 ===

  async docker_test_endpoint({ endpoint } = {}) {
    if (!endpoint) throw new Error('请提供端点地址')
    const resp = await dockerRequest('GET', '/info', null, endpoint)
    if (resp.status !== 200) throw new Error('Docker 守护进程未响应')
    const d = resp.data
    return {
      ServerVersion: d.ServerVersion,
      Containers: d.Containers,
      Images: d.Images,
      OS: d.OperatingSystem,
    }
  },

  async docker_info({ nodeId } = {}) {
    const nodes = readDockerNodes()
    const node = nodeId ? nodes.find(n => n.id === nodeId) : nodes[0]
    if (!node) throw new Error('节点不存在')
    const resp = await dockerRequest('GET', '/info', null, node.endpoint)
    if (resp.status !== 200) throw new Error('Docker 守护进程未响应')
    const d = resp.data
    return {
      nodeId: node.id, nodeName: node.name,
      containers: d.Containers, containersRunning: d.ContainersRunning,
      containersPaused: d.ContainersPaused, containersStopped: d.ContainersStopped,
      images: d.Images, serverVersion: d.ServerVersion,
      os: d.OperatingSystem, arch: d.Architecture,
      cpus: d.NCPU, memory: d.MemTotal,
    }
  },

  async docker_list_containers({ nodeId, all = true } = {}) {
    const nodes = readDockerNodes()
    const node = nodeId ? nodes.find(n => n.id === nodeId) : nodes[0]
    if (!node) throw new Error('节点不存在')
    const query = all ? '?all=true' : ''
    const resp = await dockerRequest('GET', `/containers/json${query}`, null, node.endpoint)
    if (resp.status !== 200) throw new Error('获取容器列表失败')
    return (resp.data || []).map(c => ({
      id: c.Id?.slice(0, 12),
      name: (c.Names?.[0] || '').replace(/^\//, ''),
      image: c.Image,
      state: c.State,
      status: c.Status,
      ports: (c.Ports || []).map(p => p.PublicPort ? `${p.PublicPort}→${p.PrivatePort}` : `${p.PrivatePort}`).join(', '),
      created: c.Created,
      nodeId: node.id, nodeName: node.name,
    }))
  },

  async docker_create_container({ nodeId, name, image, tag = 'latest', panelPort = 1420, gatewayPort = 18789, envVars = {}, volume = true } = {}) {
    const nodes = readDockerNodes()
    const node = nodeId ? nodes.find(n => n.id === nodeId) : nodes[0]
    if (!node) throw new Error('节点不存在')
    const imgFull = `${image || OPENCLAW_IMAGE}:${tag}`
    const containerName = name || `openclaw-${Date.now().toString(36)}`
    const env = Object.entries(envVars).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`)
    const portBindings = {}
    const exposedPorts = {}
    if (panelPort) {
      portBindings['1420/tcp'] = [{ HostPort: String(panelPort) }]
      exposedPorts['1420/tcp'] = {}
    }
    if (gatewayPort) {
      portBindings['18789/tcp'] = [{ HostPort: String(gatewayPort) }]
      exposedPorts['18789/tcp'] = {}
    }
    const config = {
      Image: imgFull,
      Env: env,
      ExposedPorts: exposedPorts,
      HostConfig: {
        PortBindings: portBindings,
        RestartPolicy: { Name: 'unless-stopped' },
        Binds: volume ? [`openclaw-data-${containerName}:/root/.openclaw`] : [],
      },
    }
    const query = `?name=${encodeURIComponent(containerName)}`
    const resp = await dockerRequest('POST', `/containers/create${query}`, config, node.endpoint)
    if (resp.status === 404) {
      // Image not found, need to pull first
      throw new Error(`镜像 ${imgFull} 不存在，请先拉取`)
    }
    if (resp.status !== 201) throw new Error(resp.data?.message || '创建容器失败')
    // Auto-start
    const startResp = await dockerRequest('POST', `/containers/${resp.data.Id}/start`, null, node.endpoint)
    if (startResp.status !== 204 && startResp.status !== 304) {
      throw new Error('容器已创建但启动失败')
    }
    const containerId = resp.data.Id?.slice(0, 12)

    // 自动注册为可管理实例
    if (panelPort) {
      const endpoint = `http://127.0.0.1:${panelPort}`
      const instData = readInstances()
      if (!instData.instances.find(i => i.endpoint === endpoint)) {
        instData.instances.push({
          id: `docker-${containerId}`,
          name: containerName,
          type: 'docker',
          endpoint,
          gatewayPort: gatewayPort || 18789,
          containerId,
          nodeId: node.id,
          addedAt: Math.floor(Date.now() / 1000),
          note: `Image: ${imgFull}`,
        })
        saveInstances(instData)
      }
    }

    return { id: containerId, name: containerName, started: true, instanceId: `docker-${containerId}` }
  },

  async docker_start_container({ nodeId, containerId } = {}) {
    const nodes = readDockerNodes()
    const node = nodeId ? nodes.find(n => n.id === nodeId) : nodes[0]
    if (!node) throw new Error('节点不存在')
    const resp = await dockerRequest('POST', `/containers/${containerId}/start`, null, node.endpoint)
    if (resp.status !== 204 && resp.status !== 304) throw new Error(resp.data?.message || '启动失败')
    return true
  },

  async docker_stop_container({ nodeId, containerId } = {}) {
    const nodes = readDockerNodes()
    const node = nodeId ? nodes.find(n => n.id === nodeId) : nodes[0]
    if (!node) throw new Error('节点不存在')
    const resp = await dockerRequest('POST', `/containers/${containerId}/stop`, null, node.endpoint)
    if (resp.status !== 204 && resp.status !== 304) throw new Error(resp.data?.message || '停止失败')
    return true
  },

  async docker_restart_container({ nodeId, containerId } = {}) {
    const nodes = readDockerNodes()
    const node = nodeId ? nodes.find(n => n.id === nodeId) : nodes[0]
    if (!node) throw new Error('节点不存在')
    const resp = await dockerRequest('POST', `/containers/${containerId}/restart`, null, node.endpoint)
    if (resp.status !== 204) throw new Error(resp.data?.message || '重启失败')
    return true
  },

  async docker_remove_container({ nodeId, containerId, force = false } = {}) {
    const nodes = readDockerNodes()
    const node = nodeId ? nodes.find(n => n.id === nodeId) : nodes[0]
    if (!node) throw new Error('节点不存在')
    const query = force ? '?force=true&v=true' : '?v=true'
    const resp = await dockerRequest('DELETE', `/containers/${containerId}${query}`, null, node.endpoint)
    if (resp.status !== 204) throw new Error(resp.data?.message || '删除失败')

    // 自动移除对应的实例注册
    const instData = readInstances()
    const instId = `docker-${containerId}`
    const before = instData.instances.length
    instData.instances = instData.instances.filter(i => i.id !== instId && i.containerId !== containerId)
    if (instData.instances.length < before) {
      if (instData.activeId === instId) instData.activeId = 'local'
      saveInstances(instData)
    }

    return true
  },

  // 重建容器（保留配置，拉取最新镜像重新创建）
  async docker_rebuild_container({ nodeId, containerId, pullLatest = true } = {}) {
    if (!containerId) throw new Error('缺少 containerId')
    const nodes = readDockerNodes()
    const node = nodeId ? nodes.find(n => n.id === nodeId) : nodes[0]
    if (!node) throw new Error('节点不存在')

    // 1. 检查容器详情
    const inspectResp = await dockerRequest('GET', `/containers/${containerId}/json`, null, node.endpoint)
    if (inspectResp.status >= 400) throw new Error('容器不存在或无法访问')
    const info = inspectResp.data
    const oldName = (info.Name || '').replace(/^\//, '')
    const oldImage = info.Config?.Image || ''
    const oldEnv = info.Config?.Env || []
    const oldPortBindings = info.HostConfig?.PortBindings || {}
    const oldBinds = info.HostConfig?.Binds || []
    const oldRestartPolicy = info.HostConfig?.RestartPolicy || { Name: 'unless-stopped' }
    const oldExposedPorts = info.Config?.ExposedPorts || {}

    // 从名字推断角色
    const role = (() => {
      const n = oldName.toLowerCase()
      for (const r of ['coder', 'translator', 'writer', 'analyst', 'custom']) {
        if (n.includes(r)) return r
      }
      return 'general'
    })()

    console.log(`[rebuild] ${oldName} (${containerId.slice(0, 12)}) — image: ${oldImage}`)

    // 2. 拉取最新镜像（可选）
    if (pullLatest && oldImage) {
      const [img, tag] = oldImage.includes(':') ? oldImage.split(':') : [oldImage, 'latest']
      try {
        const pullResp = await dockerRequest('POST', `/images/create?fromImage=${encodeURIComponent(img)}&tag=${encodeURIComponent(tag)}`, null, node.endpoint)
        if (pullResp.status < 300) console.log(`[rebuild] 镜像已更新: ${oldImage}`)
      } catch (e) {
        console.warn(`[rebuild] 镜像拉取失败(继续使用本地): ${e.message}`)
      }
    }

    // 3. 停止并移除旧容器
    await dockerRequest('POST', `/containers/${containerId}/stop`, null, node.endpoint).catch(() => {})
    await new Promise(r => setTimeout(r, 1000))
    const rmResp = await dockerRequest('DELETE', `/containers/${containerId}?force=true`, null, node.endpoint)
    if (rmResp.status !== 204 && rmResp.status !== 404) {
      throw new Error(`移除旧容器失败: ${rmResp.data?.message || rmResp.status}`)
    }

    // 移除旧实例注册
    const instData = readInstances()
    const instId = `docker-${containerId.slice(0, 12)}`
    instData.instances = instData.instances.filter(i => i.id !== instId && i.containerId !== containerId)
    saveInstances(instData)

    // 4. 创建新容器（相同配置）
    const newConfig = {
      Image: oldImage,
      Env: oldEnv,
      ExposedPorts: oldExposedPorts,
      HostConfig: {
        PortBindings: oldPortBindings,
        RestartPolicy: oldRestartPolicy,
        Binds: oldBinds,
      },
    }
    const query = `?name=${encodeURIComponent(oldName)}`
    const createResp = await dockerRequest('POST', `/containers/create${query}`, newConfig, node.endpoint)
    if (createResp.status !== 201) throw new Error(`创建新容器失败: ${createResp.data?.message || createResp.status}`)
    const newId = createResp.data?.Id

    // 5. 启动新容器
    const startResp = await dockerRequest('POST', `/containers/${newId}/start`, null, node.endpoint)
    if (startResp.status !== 204 && startResp.status !== 304) throw new Error('新容器启动失败')

    const newCid = newId?.slice(0, 12) || newId

    // 6. 注册实例
    const panelPort = oldPortBindings['1420/tcp']?.[0]?.HostPort
    if (panelPort) {
      const endpoint = `http://127.0.0.1:${panelPort}`
      if (!instData.instances.find(i => i.endpoint === endpoint)) {
        instData.instances.push({
          id: `docker-${newCid}`, name: oldName, type: 'docker',
          endpoint, gatewayPort: oldPortBindings['18789/tcp']?.[0]?.HostPort || 18789,
          containerId: newCid, nodeId: node.id,
          addedAt: Math.floor(Date.now() / 1000), note: `Rebuilt: ${oldImage}`,
        })
        saveInstances(instData)
      }
    }

    // 7. 初始化（同步配置 + 注入 agent）
    await new Promise(r => setTimeout(r, 3000))
    try {
      await handlers.docker_init_worker({ nodeId, containerId: newId, role })
    } catch (e) {
      console.warn(`[rebuild] 初始化警告: ${e.message}`)
    }

    console.log(`[rebuild] ${oldName} 重建完成: ${containerId.slice(0, 12)} → ${newCid}`)
    return { id: newCid, name: oldName, rebuilt: true, role }
  },

  async docker_gateway_chat({ nodeId, containerId, message, timeout = DOCKER_TASK_TIMEOUT_MS } = {}) {
    if (!containerId || !message) throw new Error('缺少 containerId 或 message')
    // 1. 查找容器的 Gateway 端口
    const nodes = readDockerNodes()
    const node = nodeId ? nodes.find(n => n.id === nodeId) : nodes[0]
    if (!node) throw new Error('节点不存在')
    const resp = await dockerRequest('GET', `/containers/${containerId}/json`, null, node.endpoint)
    if (resp.status >= 400) throw new Error('容器不存在或无法访问')
    const ports = resp.data?.NetworkSettings?.Ports || {}
    const gwBinding = ports['18789/tcp']
    if (!gwBinding || !gwBinding[0]?.HostPort) throw new Error('该容器没有暴露 Gateway 端口 (18789)')
    const gwPort = gwBinding[0].HostPort

    // 2. TCP 端口预检 — 快速判断 Gateway 是否在监听，失败则自动修复
    const containerName = resp.data?.Name?.replace(/^\//, '') || containerId.slice(0, 12)
    const tcpCheck = (port) => new Promise((resolve, reject) => {
      const sock = net.connect({ host: '127.0.0.1', port, timeout: 5000 })
      sock.on('connect', () => { sock.destroy(); resolve() })
      sock.on('timeout', () => { sock.destroy(); reject(new Error('timeout')) })
      sock.on('error', (e) => reject(e))
    })
    try {
      await tcpCheck(gwPort)
    } catch {
      // Gateway 未运行 → 自动修复：同步配置 + 重启 Gateway
      console.log(`[gateway-chat] ${containerName}: Gateway 未响应，自动修复中...`)
      try {
        await handlers.docker_init_worker({ nodeId, containerId, role: 'general' })
        // 等待 Gateway 启动
        await new Promise(r => setTimeout(r, 8000))
        await tcpCheck(gwPort)
        console.log(`[gateway-chat] ${containerName}: 自动修复成功`)
      } catch (e2) {
        throw new Error(`${containerName}: Gateway 自动修复失败 — ${e2.message}`)
      }
    }

    // 3. Raw WebSocket 连接 Gateway（带 Origin header + 固定 CLUSTER_TOKEN，含重试）
    let socket
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        socket = await rawWsConnect('127.0.0.1', parseInt(gwPort), '/ws')
        break
      } catch (e) {
        if (attempt === 3) throw new Error(`${containerName}: WebSocket 连接失败 — ${e.message}`)
        console.log(`[gateway-chat] ${containerName}: WS 连接失败(${attempt}/3)，${attempt * 2}s 后重试...`)
        await new Promise(r => setTimeout(r, attempt * 2000))
      }
    }
    console.log(`[gateway-chat] WebSocket 已连接 ws://127.0.0.1:${gwPort}/ws`)

    // 3a. 读取 connect.challenge
    const challengeRaw = await wsReadFrame(socket, 8000)
    const challenge = JSON.parse(challengeRaw)
    if (challenge.event !== 'connect.challenge') throw new Error('Gateway 未发送 challenge')

    // 3b. 发送 connect 帧（固定 token + 完整设备签名）
    const connectFrame = handlers.create_connect_frame({ nonce: challenge.payload?.nonce || '', gatewayToken: CLUSTER_TOKEN })
    wsSendFrame(socket, JSON.stringify(connectFrame))

    // 3c. 读取 connect 响应
    const connectRespRaw = await wsReadFrame(socket, 8000)
    const connectResp = JSON.parse(connectRespRaw)
    if (!connectResp.ok) {
      socket.destroy()
      const errMsg = connectResp.error?.message || 'Gateway 握手失败'
      throw new Error(`${containerName}: ${errMsg}`)
    }
    console.log(`[gateway-chat] 握手成功: ${containerName}`)
    const defaults = connectResp.payload?.snapshot?.sessionDefaults
    const sessionKey = defaults?.mainSessionKey || `agent:${defaults?.defaultAgentId || 'main'}:cluster-task`

    // 4. 发送聊天消息
    const chatId = `chat-${Date.now().toString(36)}`
    wsSendFrame(socket, JSON.stringify({
      type: 'req', id: chatId, method: 'chat.send',
      params: { sessionKey, message, deliver: false, idempotencyKey: chatId }
    }))

    // 5. 读取聊天回复流
    console.log(`[gateway-chat] 消息已发送，等待 AI 回复: ${containerName}`)
    return new Promise((resolve, reject) => {
      let result = '', done = false
      const cancel = wsReadLoop(socket, (data) => {
        let msg
        try { msg = JSON.parse(data) } catch { return }
        // 诊断日志：显示所有收到的消息类型
        const msgInfo = msg.type === 'event' ? `event:${msg.event} state=${msg.payload?.state || ''}` : `${msg.type} id=${msg.id} ok=${msg.ok}`
        console.log(`[gateway-chat] ${containerName} ← ${msgInfo}`)
        if (msg.type === 'event' && msg.event === 'chat') {
          const p = msg.payload
          if (p?.state === 'delta') {
            const content = p.message?.content
            if (typeof content === 'string' && content.length > result.length) result = content
          }
          if (p?.state === 'final') {
            const content = p.message?.content
            if (typeof content === 'string' && content) result = content
            done = true; cancel()
            resolve({ ok: true, result })
          }
          if (p?.state === 'error') {
            done = true; cancel()
            const errDetail = p.error?.message || p.message?.content || p.errorMessage || JSON.stringify(p).slice(0, 300)
            console.error(`[gateway-chat] ${containerName} AI error payload:`, JSON.stringify(p).slice(0, 500))
            reject(new Error(`${containerName}: AI 错误 — ${errDetail}`))
          }
        }
        if (msg.type === 'res' && !msg.ok) {
          done = true; cancel()
          const errMsg = msg.error?.message || '任务发送失败'
          if (errMsg.includes('no model') || errMsg.includes('model'))
            reject(new Error(`${containerName}: 未配置模型 — 请先在容器面板中配置 AI 模型`))
          else
            reject(new Error(`${containerName}: ${errMsg}`))
        }
      }, timeout)
      // 超时兜底
      setTimeout(() => {
        if (!done) { done = true; cancel(); resolve({ ok: true, result: result || '（无回复）' }) }
      }, timeout)
    })
  },

  // === Docker Agent 通道（容器内专属控制代理）===
  async docker_agent({ nodeId, containerId, cmd } = {}) {
    if (!containerId) throw new Error('缺少 containerId')
    if (!cmd || !cmd.cmd) throw new Error('缺少 cmd')
    const nodes = readDockerNodes()
    const node = nodeId ? nodes.find(n => n.id === nodeId) : nodes[0]
    if (!node) throw new Error('节点不存在')

    const cmdJson = JSON.stringify(cmd)
    const timeout = cmd.timeout || (cmd.cmd === 'task.run' ? DOCKER_TASK_TIMEOUT_MS : 30000)
    const cid12 = containerId.slice(0, 12)

    const runAgent = async () => {
      const execResult = await dockerExecRun(
        containerId,
        ['node', '/app/clawpanel-agent.cjs', cmdJson],
        node.endpoint,
        timeout,
      )
      return execResult
    }

    const cExec = createContainerShellExec(containerId, node.endpoint)

    console.log(`[agent] ${cid12} → ${cmd.cmd}`)
    let execResult
    try {
      await syncAgentToContainerIfNeeded(containerId, node.endpoint, cExec)
      execResult = await runAgent()
    } catch (e) {
      // exec 本身失败（如 node 未找到模块），尝试自动注入
      throw new Error(`容器代理执行失败: ${e.message}`)
    }

    // 检查 agent 是否缺失（stdout 空 + stderr 含 "Cannot find module"）
    if (!execResult.stdout.trim() && execResult.stderr.includes('Cannot find module')) {
      console.log(`[agent] ${cid12}: agent 未安装，自动注入中...`)
      const injected = await injectAgentToContainer(containerId, node.endpoint, cExec)
      if (!injected) throw new Error('容器代理未安装且无法自动注入 — 请先执行征召(init-worker)')
      execResult = await runAgent()
    }

    // 解析 NDJSON 输出
    const lines = execResult.stdout.split('\n').filter(l => l.trim())
    const events = []
    for (const line of lines) {
      try { events.push(JSON.parse(line)) } catch {}
    }

    if (execResult.stderr) {
      console.warn(`[agent] ${cid12} stderr: ${execResult.stderr.slice(0, 300)}`)
    }

    // 提取最终结果
    const error = events.find(e => e.type === 'error')
    if (error) {
      const err = new Error(error.message || '容器代理执行失败')
      err.events = events
      throw err
    }

    const final = events.find(e => e.type === 'final')
    const result = events.find(e => e.type === 'result')

    if (final) return { ok: true, result: final.text, events }
    if (result) {
      if (result.ok) return { ok: true, ...result, events }
      const err = new Error(result.message || '容器代理执行失败')
      err.events = events
      throw err
    }

    const tailTypes = events.slice(-3).map(e => e.type || 'unknown').join(', ')
    const err = new Error(
      tailTypes
        ? `容器代理未返回最终结果（最后事件: ${tailTypes}）`
        : '容器代理未返回任何结果',
    )
    err.events = events
    throw err
  },

  // === Docker Agent 批量广播 ===
  async docker_agent_broadcast({ nodeId, containerIds, message, timeout = DOCKER_TASK_TIMEOUT_MS } = {}) {
    if (!containerIds || !containerIds.length) throw new Error('缺少 containerIds')
    if (!message) throw new Error('缺少 message')

    const cmd = { cmd: 'task.run', message, timeout }
    const results = await Promise.allSettled(
      containerIds.map(cid =>
        handlers.docker_agent({ nodeId, containerId: cid, cmd })
          .then(r => ({ containerId: cid, ...r }))
      )
    )

    return results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value
      return { containerId: containerIds[i], ok: false, error: r.reason?.message || '未知错误' }
    })
  },

  // === 异步任务派发（非阻塞，立即返回 taskId） ===
  async docker_dispatch_task({ nodeId, containerId, containerName, message, timeout = DOCKER_TASK_TIMEOUT_MS } = {}) {
    if (!containerId) throw new Error('缺少 containerId')
    if (!message) throw new Error('缺少 message')

    const task = createTask(containerId, containerName, nodeId, message)
    console.log(`[dispatch] 任务已派发 → ${task.containerName} (${task.id})`)

    // 后台异步执行，不阻塞返回
    const cmd = { cmd: 'task.run', message, timeout }
    handlers.docker_agent({ nodeId, containerId, cmd })
      .then(r => {
        task.status = 'completed'
        task.result = r
        task.events = r.events || []
        task.completedAt = Date.now()
        console.log(`[dispatch] 任务完成 ✓ ${task.containerName} (${task.id}) — ${((task.completedAt - task.startedAt) / 1000).toFixed(1)}s`)
      })
      .catch(e => {
        task.status = 'error'
        task.error = e.message || String(e)
        task.events = e.events || []
        task.completedAt = Date.now()
        console.error(`[dispatch] 任务失败 ✗ ${task.containerName} (${task.id}): ${task.error}`)
      })

    return { taskId: task.id, containerId, containerName: task.containerName, status: 'running' }
  },

  // 批量异步派发（多个容器）
  async docker_dispatch_broadcast({ nodeId, targets, message, timeout = DOCKER_TASK_TIMEOUT_MS } = {}) {
    if (!targets || !targets.length) throw new Error('缺少 targets')
    if (!message) throw new Error('缺少 message')

    const taskIds = []
    for (const t of targets) {
      const result = await handlers.docker_dispatch_task({
        nodeId: t.nodeId || nodeId,
        containerId: t.containerId,
        containerName: t.containerName,
        message,
        timeout,
      })
      taskIds.push(result)
    }
    return taskIds
  },

  // 查询单个任务状态
  docker_task_status({ taskId } = {}) {
    if (!taskId) throw new Error('缺少 taskId')
    const task = _taskStore.get(taskId)
    if (!task) throw new Error('任务不存在')
    return {
      id: task.id,
      containerId: task.containerId,
      containerName: task.containerName,
      message: task.message,
      status: task.status,
      result: task.result,
      error: task.error,
      events: task.events,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      elapsed: task.completedAt ? task.completedAt - task.startedAt : Date.now() - task.startedAt,
    }
  },

  // 查询所有任务列表
  docker_task_list({ containerId, status } = {}) {
    let tasks = [..._taskStore.values()]
    if (containerId) tasks = tasks.filter(t => t.containerId === containerId)
    if (status) tasks = tasks.filter(t => t.status === status)
    // 按时间倒序
    tasks.sort((a, b) => b.startedAt - a.startedAt)
    return tasks.map(t => ({
      id: t.id,
      containerId: t.containerId,
      containerName: t.containerName,
      message: t.message,
      status: t.status,
      error: t.error,
      startedAt: t.startedAt,
      completedAt: t.completedAt,
      elapsed: t.completedAt ? t.completedAt - t.startedAt : Date.now() - t.startedAt,
      hasResult: !!t.result,
    }))
  },

  async docker_init_worker({ nodeId, containerId, role = 'general' } = {}) {
    if (!containerId) throw new Error('缺少 containerId')
    const nodes = readDockerNodes()
    const node = nodeId ? nodes.find(n => n.id === nodeId) : nodes[0]
    if (!node) throw new Error('节点不存在')

    const results = { config: false, personality: false, files: [] }

    // helper: base64 encode string
    const b64 = (s) => Buffer.from(s, 'utf8').toString('base64')

    // helper: exec command in container
    const cExec = async (cmd) => {
      const createResp = await dockerRequest('POST', `/containers/${containerId}/exec`, {
        AttachStdout: true, AttachStderr: true, Cmd: ['sh', '-c', cmd]
      }, node.endpoint)
      if (createResp.status >= 400) throw new Error(`exec 失败: ${createResp.status}`)
      const execId = createResp.data?.Id
      if (!execId) return
      await dockerRequest('POST', `/exec/${execId}/start`, { Detach: true }, node.endpoint)
      // 给 exec 一点时间完成
      await new Promise(r => setTimeout(r, 300))
    }

    // 1. 同步 openclaw.json（模型 + API Key 配置）
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const localConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
        // 只同步 OpenClaw 认识的字段，避免 Unrecognized key 导致 Gateway 崩溃
        const syncConfig = {}
        if (localConfig.meta) syncConfig.meta = localConfig.meta // 保持原始 meta，不加自定义字段
        if (localConfig.env) syncConfig.env = localConfig.env
        if (localConfig.models) {
          // 容器内 127.0.0.1/localhost 指向容器自身，需替换为 host.docker.internal 访问宿主机
          syncConfig.models = JSON.parse(JSON.stringify(localConfig.models, (k, v) => {
            if (k === 'baseUrl' && typeof v === 'string') {
              return v.replace(/\/\/127\.0\.0\.1([:/])/g, '//host.docker.internal$1')
                      .replace(/\/\/localhost([:/])/g, '//host.docker.internal$1')
            }
            return v
          }))
        }
        if (localConfig.auth) syncConfig.auth = localConfig.auth
        // Gateway 配置：只设置 controlUi（允许连接），不复制 host/bind 等本机特定字段
        syncConfig.gateway = {
          port: 18789,
          mode: 'local',
          bind: 'lan',
          auth: { mode: 'token', token: CLUSTER_TOKEN },
          controlUi: { allowedOrigins: ['*'], allowInsecureAuth: true },
        }

        const configB64 = b64(JSON.stringify(syncConfig, null, 2))
        await cExec(`mkdir -p /root/.openclaw && echo '${configB64}' | base64 -d > /root/.openclaw/openclaw.json`)
        results.config = true
        results.files.push('openclaw.json')
        console.log(`[init-worker] 配置已同步 → ${containerId.slice(0, 12)}`)
      }
    } catch (e) {
      console.warn(`[init-worker] 配置同步失败: ${e.message}`)
    }

    // 2. 注入设备配对信息（绕过 Gateway 手动配对要求）
    try {
      const { deviceId, publicKey } = getOrCreateDeviceKey()
      const platform = process.platform === 'darwin' ? 'macos' : process.platform
      const nowMs = Date.now()
      const pairedData = {}
      pairedData[deviceId] = {
        deviceId, publicKey, platform, deviceFamily: 'desktop',
        clientId: 'openclaw-control-ui', clientMode: 'ui',
        role: 'operator', roles: ['operator'],
        scopes: SCOPES, approvedScopes: SCOPES, tokens: {},
        createdAtMs: nowMs, approvedAtMs: nowMs,
      }
      const pairedB64 = b64(JSON.stringify(pairedData, null, 2))
      await cExec(`mkdir -p /root/.openclaw/devices && echo '${pairedB64}' | base64 -d > /root/.openclaw/devices/paired.json`)
      results.files.push('devices/paired.json')
      console.log(`[init-worker] 设备配对已注入 → ${containerId.slice(0, 12)}`)
    } catch (e) {
      console.warn(`[init-worker] 设备配对注入失败: ${e.message}`)
    }

    // 3. 角色性格注入（SOUL.md + IDENTITY.md + AGENTS.md）
    try {
      // 角色性格模板
      const ROLE_SOULS = {
        general: { identity: '# 龙虾步兵\n通用作战单位，隶属统帅龙虾军团', soul: '# 龙虾步兵 · 性格\n\n## 核心\n- 忠诚可靠，执行力强\n- 能处理各类任务：写作、编程、翻译、分析\n- 回复简洁专业\n- 主动报告任务进展\n\n## 边界\n- 尊重隐私，不泄露信息\n- 不确定时先询问统帅\n- 每次回复聚焦任务本身' },
        coder: { identity: '# 龙虾突击兵\n编程作战专家，隶属统帅龙虾军团', soul: '# 龙虾突击兵 · 性格\n\n## 核心\n- 精通多种编程语言和框架\n- 代码质量第一，回复包含可运行示例\n- 擅长调试、重构、Code Review\n- 主动提示潜在问题和最佳实践\n\n## 边界\n- 修改文件前先理解上下文\n- 不跳过测试\n- 不引入不必要的依赖' },
        translator: { identity: '# 龙虾翻译官\n多语言作战专家，隶属统帅龙虾军团', soul: '# 龙虾翻译官 · 性格\n\n## 核心\n- 精通中英日韩法德西等主流语言互译\n- 追求信达雅，翻译精准\n- 保留原文语境和风格\n- 对专业术语严格把关\n\n## 边界\n- 不确定的术语标注原文\n- 不过度意译\n- 保持文体一致性' },
        writer: { identity: '# 龙虾文书官\n写作任务专家，隶属统帅龙虾军团', soul: '# 龙虾文书官 · 性格\n\n## 核心\n- 文思敏捷，创意丰富\n- 能调整语气适应不同场景\n- 精通博客、技术文档、营销文案等\n- 善于讲故事，引人入胜\n\n## 边界\n- 不抄袭\n- 保持原创性\n- 注重可读性和准确性' },
        analyst: { identity: '# 龙虾参谋\n数据分析专家，隶属统帅龙虾军团', soul: '# 龙虾参谋 · 性格\n\n## 核心\n- 逻辑清晰，善用数据说话\n- 结论有理有据，给出可行建议\n- 善用图表和结构化格式呈现\n- 擅长统计分析、商业分析、竞品分析\n\n## 边界\n- 不编造数据\n- 区分相关性和因果性\n- 标注不确定性' },
        custom: { identity: '# 龙虾特种兵\n特殊任务执行者，隶属统帅龙虾军团', soul: '# 龙虾特种兵 · 性格\n\n## 核心\n- 灵活多变，适应力强\n- 按需配置技能\n- 不拘泥形式，主动寻找最优解\n\n## 边界\n- 行动前确认方向\n- 不超出授权范围' },
      }

      const roleSoul = ROLE_SOULS[role] || ROLE_SOULS.general

      // 每个兵种独立的 AGENTS.md（操作指令）
      const ROLE_AGENTS = {
        general: '# 操作指令\n\n你是龙虾军团的步兵，接受统帅通过 Privix 下达的任务指令。\n\n## 规则\n- 收到任务后立即执行，完成后简要汇报结果\n- 如果任务不清楚，先确认再行动\n- 保持回复简洁，重点突出\n- 你有独立的记忆空间，会自动记录重要信息',
        coder: '# 操作指令\n\n你是龙虾军团的突击兵，专精编程作战。\n\n## 规则\n- 收到编程任务后，先分析需求再写代码\n- 代码必须可运行，包含必要的注释\n- 主动进行错误处理和边界检查\n- 如果涉及多个文件，说明修改顺序\n- 完成后给出测试建议\n\n## 专长\n- 全栈开发、API 设计、数据库优化\n- Bug 定位与修复、代码重构\n- 性能优化、安全审计',
        translator: '# 操作指令\n\n你是龙虾军团的翻译官，专精多语言互译。\n\n## 规则\n- 翻译要信达雅，保持原文风格\n- 专业术语保留原文标注\n- 长文分段翻译，保持上下文一致\n- 文学作品注重意境传达\n- 技术文档注重准确性\n\n## 专长\n- 中英日韩法德西等主流语言\n- 技术文档、文学作品、商务邮件',
        writer: '# 操作指令\n\n你是龙虾军团的文书官，专精写作任务。\n\n## 规则\n- 根据场景调整语气和风格\n- 注重结构清晰、逻辑连贯\n- 创意写作要有个性和亮点\n- 技术文档要准确严谨\n- 营销文案要抓住痛点\n\n## 专长\n- 博客文章、技术文档、营销文案\n- 故事创作、剧本、诗歌\n- SEO 优化、社交媒体内容',
        analyst: '# 操作指令\n\n你是龙虾军团的参谋，专精数据分析和战略规划。\n\n## 规则\n- 用数据说话，结论必须有依据\n- 区分事实、推断和假设\n- 善用表格和结构化格式呈现\n- 给出可执行的建议\n- 标注不确定性和风险\n\n## 专长\n- 市场分析、竞品研究、用户画像\n- 数据可视化、统计分析\n- 商业计划、策略建议',
        custom: '# 操作指令\n\n你是龙虾军团的特种兵，执行特殊任务。\n\n## 规则\n- 灵活应对各类非标准任务\n- 行动前确认方向\n- 不超出授权范围\n- 主动寻找最优解决方案',
      }

      const wsFiles = {
        'SOUL.md': roleSoul.soul,
        'IDENTITY.md': roleSoul.identity,
        'AGENTS.md': ROLE_AGENTS[role] || ROLE_AGENTS.general,
      }

      // 写入兵种专属文件（不复制本机的 TOOLS.md/USER.md/记忆，每个士兵独立发展）
      await cExec('mkdir -p /root/.openclaw/workspace')
      for (const [fname, content] of Object.entries(wsFiles)) {
        const encoded = b64(content)
        await cExec(`echo '${encoded}' | base64 -d > /root/.openclaw/workspace/${fname}`)
        results.files.push(`workspace/${fname}`)
      }
      results.personality = true
      console.log(`[init-worker] 兵种配置注入完成 (${role}) → ${containerId.slice(0, 12)}`)
    } catch (e) {
      console.warn(`[init-worker] 兵种配置注入失败: ${e.message}`)
    }

    // 4.5 注入 Privix Agent（容器内专属控制代理）
    try {
      await injectAgentToContainer(containerId, node.endpoint, cExec)
      results.files.push('clawpanel-agent.cjs')
    } catch (e) {
      console.warn(`[init-worker] Agent 注入失败: ${e.message}`)
    }

    // 5. 重启 Gateway
    try {
      // 停止旧 Gateway
      await cExec('pkill -f openclaw-gateway 2>/dev/null; pkill -f "openclaw gateway" 2>/dev/null; sleep 1')
      // 启动新 Gateway — 作为独立 Detach exec 的主进程（不能 nohup &，shell 退出会 SIGTERM 杀子进程）
      // --force 确保端口被占用时也能启动
      await cExec('mkdir -p /root/.openclaw/logs && exec openclaw gateway --force >> /root/.openclaw/logs/gateway.log 2>&1')
      console.log(`[init-worker] Gateway 已重启 → ${containerId.slice(0, 12)}`)
    } catch (e) {
      console.warn(`[init-worker] Gateway 重启失败: ${e.message}`)
    }

    return results
  },

  async docker_container_exec({ nodeId, containerId, cmd } = {}) {
    const nodes = readDockerNodes()
    const node = nodeId ? nodes.find(n => n.id === nodeId) : nodes[0]
    if (!node) throw new Error('节点不存在')
    if (!containerId) throw new Error('缺少 containerId')
    if (!cmd || !Array.isArray(cmd)) throw new Error('cmd 必须是字符串数组')
    // Step 1: 创建 exec 实例
    const createResp = await dockerRequest('POST', `/containers/${containerId}/exec`, {
      AttachStdout: true, AttachStderr: true, Cmd: cmd
    }, node.endpoint)
    if (createResp.status >= 400) throw new Error(`exec 创建失败: ${JSON.stringify(createResp.data)}`)
    const execId = createResp.data?.Id
    if (!execId) throw new Error('exec 创建失败: 无 ID')
    // Step 2: 启动 exec
    const startResp = await dockerRequest('POST', `/exec/${execId}/start`, { Detach: true }, node.endpoint)
    if (startResp.status >= 400) throw new Error(`exec 启动失败: ${JSON.stringify(startResp.data)}`)
    return { ok: true, execId }
  },

  async docker_container_logs({ nodeId, containerId, tail = 200 } = {}) {
    const nodes = readDockerNodes()
    const node = nodeId ? nodes.find(n => n.id === nodeId) : nodes[0]
    if (!node) throw new Error('节点不存在')
    const resp = await dockerRequest('GET', `/containers/${containerId}/logs?stdout=true&stderr=true&tail=${tail}`, null, node.endpoint)
    // Docker logs 返回带 stream header 的原始字节，简单清理
    let logs = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data)
    // 去除 Docker stream 帧头（每 8 字节一个 header）
    logs = logs.replace(/[\x00-\x08]/g, '').replace(/\r/g, '')
    return logs
  },

  async docker_pull_image({ nodeId, image, tag = 'latest', requestId } = {}) {
    const nodes = readDockerNodes()
    const node = nodeId ? nodes.find(n => n.id === nodeId) : nodes[0]
    if (!node) throw new Error('节点不存在')
    const imgFull = `${image || OPENCLAW_IMAGE}:${tag}`
    const rid = requestId || `pull-${Date.now()}`
    _pullProgress.set(rid, { status: 'connecting', image: imgFull, layers: {}, message: '连接 Docker...', percent: 0 })
    const endpoint = node.endpoint
    const apiPath = `/images/create?fromImage=${encodeURIComponent(image || OPENCLAW_IMAGE)}&tag=${tag}`
    try {
      await new Promise((resolve, reject) => {
        const opts = { path: apiPath, method: 'POST', headers: { 'Content-Type': 'application/json' } }
        if (endpoint && endpoint.startsWith('tcp://')) {
          const url = new URL(endpoint.replace('tcp://', 'http://'))
          opts.hostname = url.hostname
          opts.port = parseInt(url.port) || 2375
        } else {
          opts.socketPath = endpoint || DOCKER_SOCKET
        }
        const req = http.request(opts, (res) => {
          if (res.statusCode !== 200) {
            let errData = ''
            res.on('data', chunk => errData += chunk)
            res.on('end', () => {
              const err = (() => { try { return JSON.parse(errData).message } catch { return `HTTP ${res.statusCode}` } })()
              _pullProgress.set(rid, { ..._pullProgress.get(rid), status: 'error', message: err })
              reject(new Error(err))
            })
            return
          }
          _pullProgress.set(rid, { ..._pullProgress.get(rid), status: 'pulling', message: '正在拉取镜像层...' })
          let lastError = null
          res.on('data', (chunk) => {
            const text = chunk.toString()
            for (const line of text.split('\n').filter(Boolean)) {
              try {
                const obj = JSON.parse(line)
                if (obj.error) { lastError = obj.error; continue }
                const p = _pullProgress.get(rid)
                if (obj.id && obj.progressDetail) {
                  p.layers[obj.id] = {
                    status: obj.status || '',
                    current: obj.progressDetail.current || 0,
                    total: obj.progressDetail.total || 0,
                  }
                }
                if (obj.status) p.message = obj.id ? `${obj.id}: ${obj.status}` : obj.status
                // 计算总体进度
                const layers = Object.values(p.layers)
                if (layers.length > 0) {
                  const totalBytes = layers.reduce((s, l) => s + (l.total || 0), 0)
                  const currentBytes = layers.reduce((s, l) => s + (l.current || 0), 0)
                  p.percent = totalBytes > 0 ? Math.round((currentBytes / totalBytes) * 100) : 0
                  p.layerCount = layers.length
                  p.completedLayers = layers.filter(l => l.status === 'Pull complete' || l.status === 'Already exists').length
                }
                _pullProgress.set(rid, p)
              } catch {}
            }
          })
          res.on('end', () => {
            if (lastError) {
              _pullProgress.set(rid, { ..._pullProgress.get(rid), status: 'error', message: lastError })
              reject(new Error(lastError))
            } else {
              _pullProgress.set(rid, { ..._pullProgress.get(rid), status: 'done', message: '拉取完成', percent: 100 })
              resolve()
            }
          })
        })
        req.on('error', (e) => {
          _pullProgress.set(rid, { ..._pullProgress.get(rid), status: 'error', message: e.message })
          reject(new Error('Docker 连接失败: ' + e.message))
        })
        req.setTimeout(600000, () => {
          _pullProgress.set(rid, { ..._pullProgress.get(rid), status: 'error', message: '超时' })
          req.destroy()
          reject(new Error('镜像拉取超时（10分钟）'))
        })
        req.end()
      })
    } finally {
      // 30秒后清理进度数据
      setTimeout(() => _pullProgress.delete(rid), 30000)
    }
    return { message: `镜像 ${imgFull} 拉取完成`, requestId: rid }
  },

  docker_pull_status({ requestId } = {}) {
    if (!requestId) return { status: 'unknown' }
    return _pullProgress.get(requestId) || { status: 'unknown' }
  },

  async docker_list_images({ nodeId } = {}) {
    const nodes = readDockerNodes()
    const node = nodeId ? nodes.find(n => n.id === nodeId) : nodes[0]
    if (!node) throw new Error('节点不存在')
    const resp = await dockerRequest('GET', '/images/json', null, node.endpoint)
    if (resp.status !== 200) throw new Error('获取镜像列表失败')
    return (resp.data || [])
      .filter(img => (img.RepoTags || []).some(t => t.includes('openclaw')))
      .map(img => ({
        id: img.Id?.replace('sha256:', '').slice(0, 12),
        tags: img.RepoTags || [],
        size: img.Size,
        created: img.Created,
      }))
  },

  // Docker 节点管理
  docker_list_nodes() {
    return readDockerNodes()
  },

  async docker_add_node({ name, endpoint }) {
    if (!name || !endpoint) throw new Error('节点名称和地址不能为空')
    // 验证连接
    try {
      await dockerRequest('GET', '/info', null, endpoint)
    } catch (e) {
      throw new Error(`无法连接到 ${endpoint}: ${e.message}`)
    }
    const nodes = readDockerNodes()
    const id = 'node-' + Date.now().toString(36)
    const type = endpoint.startsWith('tcp://') ? 'tcp' : 'socket'
    nodes.push({ id, name, type, endpoint })
    saveDockerNodes(nodes)
    return { id, name, type, endpoint }
  },

  docker_remove_node({ nodeId }) {
    if (nodeId === 'local') throw new Error('不能删除本机节点')
    const nodes = readDockerNodes().filter(n => n.id !== nodeId)
    saveDockerNodes(nodes)
    return true
  },

  // 集群概览（聚合所有节点）
  async docker_cluster_overview() {
    const nodes = readDockerNodes()
    const results = []
    for (const node of nodes) {
      try {
        const infoResp = await dockerRequest('GET', '/info', null, node.endpoint)
        const ctResp = await dockerRequest('GET', '/containers/json?all=true', null, node.endpoint)
        const containers = (ctResp.data || []).map(c => ({
          id: c.Id?.slice(0, 12),
          name: (c.Names?.[0] || '').replace(/^\//, ''),
          image: c.Image, state: c.State, status: c.Status,
          ports: (c.Ports || []).map(p => p.PublicPort ? `${p.PublicPort}→${p.PrivatePort}` : `${p.PrivatePort}`).join(', '),
        }))
        const d = infoResp.data || {}
        results.push({
          ...node, online: true,
          dockerVersion: d.ServerVersion, os: d.OperatingSystem,
          cpus: d.NCPU, memory: d.MemTotal,
          totalContainers: d.Containers, runningContainers: d.ContainersRunning,
          stoppedContainers: d.ContainersStopped,
          containers,
        })
      } catch (e) {
        results.push({ ...node, online: false, error: e.message, containers: [] })
      }
    }
    return results
  },

  // 部署模式检测
  get_deploy_mode() {
    const inDocker = fs.existsSync('/.dockerenv') || (process.env.CLAWPANEL_MODE === 'docker')
    const dockerAvailable = isDockerAvailable()
    return { inDocker, dockerAvailable, mode: inDocker ? 'docker' : 'local' }
  },

  // 安装检测
  check_installation() {
    const inDocker = fs.existsSync('/.dockerenv')
    return { installed: fs.existsSync(CONFIG_PATH), path: OPENCLAW_DIR, platform: isMac ? 'macos' : process.platform, inDocker }
  },

  check_git() {
    try {
      const ver = execSync('git --version', { encoding: 'utf8', timeout: 5000, windowsHide: true }).trim()
      const match = ver.match(/(\d+\.\d+[\.\d]*)/)
      return { installed: true, version: match ? match[1] : ver }
    } catch {
      return { installed: false }
    }
  },

  auto_install_git() {
    // Web 模式下不自动安装系统软件，返回指引
    throw new Error('Web 部署模式下请手动安装 Git：\n- Ubuntu/Debian: sudo apt install git\n- CentOS/RHEL: sudo yum install git\n- macOS: xcode-select --install')
  },

  configure_git_https() {
    try {
      const success = configureGitHttpsRules()
      if (!success) throw new Error('Git 未安装或写入失败')
      return `已配置 Git HTTPS 替代 SSH（${success}/${GIT_HTTPS_REWRITES.length} 条规则）`
    } catch (e) {
      throw new Error('配置失败: ' + (e.message || e))
    }
  },

  guardian_status() {
    // Web 模式没有 Guardian 守护进程
    return { enabled: false, giveUp: false }
  },

  reset_guardian() {
    // Web 模式无 Guardian，空操作
    return null
  },

  invalidate_path_cache() {
    return true
  },

  check_node() {
    try {
      const ver = execSync('node --version 2>&1', { windowsHide: true }).toString().trim()
      return { installed: true, version: ver }
    } catch {
      return { installed: false, version: null }
    }
  },

  // 运行时状态摘要（openclaw status --json）
  get_status_summary() {
    try {
      const raw = execSync('openclaw status --json 2>&1', { windowsHide: true, timeout: 10000 }).toString()
      // 提取第一个 JSON 对象
      const idx = raw.indexOf('{')
      if (idx >= 0) {
        try { return JSON.parse(raw.slice(idx)) } catch {}
        // 流式解析：找到匹配的 } 结束
        let depth = 0
        for (let i = idx; i < raw.length; i++) {
          if (raw[i] === '{') depth++
          else if (raw[i] === '}') { depth--; if (depth === 0) { try { return JSON.parse(raw.slice(idx, i + 1)) } catch { break } } }
        }
      }
      return { error: '解析失败' }
    } catch (e) {
      return { error: e.message || String(e) }
    }
  },

  // 版本信息
  async get_version_info() {
    let source = detectInstalledSource()
    const current = getLocalOpenclawVersion()
    // 兜底：版本号含 -zh 则一定是汉化版
    if (current && current.includes('-zh') && source !== 'chinese') source = 'chinese'
    const cli_path = findOpenclawBin() || null
    // unknown 来源跳过 npm 查询（避免无效网络请求）
    const latest = source === 'unknown' ? null : await getLatestVersionFor(source)
    const recommended = source === 'unknown' ? null : recommendedVersionFor(source)
    return {
      current,
      latest,
      recommended,
      update_available: current && recommended ? recommendedIsNewer(recommended, current) : !!recommended,
      latest_update_available: current && latest ? recommendedIsNewer(latest, current) : !!latest,
      is_recommended: !!current && !!recommended && versionsMatch(current, recommended),
      ahead_of_recommended: !!current && !!recommended && recommendedIsNewer(current, recommended),
      panel_version: PANEL_VERSION,
      source,
      cli_path,
      cli_source: null,
      all_installations: null,
    }
  },

  // 模型测试
  async test_model({ baseUrl, apiKey, modelId, apiType = 'openai-completions' }) {
    const type = ['anthropic', 'anthropic-messages'].includes(apiType) ? 'anthropic-messages'
      : apiType === 'google-gemini' ? 'google-gemini'
      : 'openai-completions'
    let base = _normalizeBaseUrl(baseUrl)
    // 仅 Anthropic 强制补 /v1，OpenAI 兼容类不强制（火山引擎等用 /v3）
    if (type === 'anthropic-messages' && !/\/v1$/i.test(base)) base += '/v1'
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)
    try {
      let resp
      if (type === 'anthropic-messages') {
        const headers = { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' }
        _addAnthropicAuth(headers, apiKey, base)
        resp = await fetch(`${base}/messages`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: modelId,
            messages: [{ role: 'user', content: 'Hi' }],
            max_tokens: 16,
          }),
          signal: controller.signal
        })
      } else if (type === 'google-gemini') {
        resp = await fetch(`${base}/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey || '')}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Hi' }] }] }),
          signal: controller.signal
        })
      } else {
        const headers = { 'Content-Type': 'application/json' }
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
        resp = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: modelId,
            messages: [{ role: 'user', content: 'Hi' }],
            max_tokens: 16,
            stream: false
          }),
          signal: controller.signal
        })
      }
      clearTimeout(timeout)
      if (!resp.ok) {
        const text = await resp.text()
        let msg = `HTTP ${resp.status}`
        try {
          const parsed = JSON.parse(text)
          msg = parsed.error?.message || parsed.message || msg
        } catch {}
        if (resp.status === 401 || resp.status === 403) throw new Error(msg)
        return `⚠ 连接正常（API 返回 ${resp.status}，部分模型对简单测试不兼容，不影响实际使用）`
      }
      const data = await resp.json()
      const anthropicText = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
      const geminiText = data.candidates?.[0]?.content?.parts?.map?.(p => p.text).filter(Boolean).join('') || ''
      const content = data.choices?.[0]?.message?.content
      const reasoning = data.choices?.[0]?.message?.reasoning_content
      return anthropicText || geminiText || content || (reasoning ? `[reasoning] ${reasoning}` : '（无回复内容）')
    } catch (e) {
      clearTimeout(timeout)
      if (e.name === 'AbortError') throw new Error('请求超时 (30s)')
      throw e
    }
  },

  // ClawSwarm 直连 LLM API（Web 开发模式）
  async swarm_chat_complete({ messages, model, api_type, api_key, base_url, max_tokens = 4096 }) {
    const type = ['anthropic', 'anthropic-messages'].includes(api_type) ? 'anthropic-messages'
      : api_type === 'google-gemini' ? 'google-gemini'
      : 'openai-completions'
    let base = _normalizeBaseUrl(base_url || '')
    if (type === 'anthropic-messages' && !/\/v1$/i.test(base)) base += '/v1'
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120000)
    try {
      let resp
      if (type === 'anthropic-messages') {
        // Anthropic: 分离 system 消息
        const systemMsgs = messages.filter(m => m.role === 'system').map(m => m.content)
        const chatMsgs = messages.filter(m => m.role !== 'system')
        const body = { model, messages: chatMsgs, max_tokens }
        if (systemMsgs.length) body.system = systemMsgs.join('\n\n')
        const headers = { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' }
        _addAnthropicAuth(headers, api_key, base)
        resp = await fetch(`${base}/messages`, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal })
      } else if (type === 'google-gemini') {
        const contents = messages.filter(m => m.role !== 'system').map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }]
        }))
        const systemText = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n')
        if (systemText && contents.length) {
          contents[0].parts[0].text = systemText + '\n\n' + contents[0].parts[0].text
        }
        resp = await fetch(
          `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(api_key || '')}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents, generationConfig: { maxOutputTokens: max_tokens } }), signal: controller.signal }
        )
      } else {
        const headers = { 'Content-Type': 'application/json' }
        if (api_key) headers['Authorization'] = `Bearer ${api_key}`
        resp = await fetch(`${base}/chat/completions`, {
          method: 'POST', headers,
          body: JSON.stringify({ model, messages, max_tokens, stream: false }),
          signal: controller.signal
        })
      }
      clearTimeout(timeout)
      if (!resp.ok) {
        const text = await resp.text()
        let msg = `HTTP ${resp.status}`
        try { const p = JSON.parse(text); msg = p.error?.message || p.message || msg } catch {}
        throw new Error(`LLM 请求失败 (${resp.status}): ${msg}`)
      }
      const data = await resp.json()
      // 提取内容
      let content = ''
      const anthropicText = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
      const geminiText = data.candidates?.[0]?.content?.parts?.map?.(p => p.text).filter(Boolean).join('') || ''
      const openaiText = data.choices?.[0]?.message?.content || ''
      content = anthropicText || geminiText || openaiText
      if (!content) throw new Error('无法从 LLM 响应中提取文本内容')
      // 提取 usage
      const usage = data.usage || data.usageMetadata || {}
      const input = usage.input_tokens || usage.prompt_tokens || usage.promptTokenCount || 0
      const output = usage.output_tokens || usage.completion_tokens || usage.candidatesTokenCount || 0
      return { content, usage: { input, output }, model }
    } catch (e) {
      clearTimeout(timeout)
      if (e.name === 'AbortError') throw new Error('请求超时 (120s)，请检查网络或尝试更短的提示')
      throw e
    }
  },

  async list_remote_models({ baseUrl, apiKey, apiType = 'openai-completions' }) {
    const type = ['anthropic', 'anthropic-messages'].includes(apiType) ? 'anthropic-messages'
      : apiType === 'google-gemini' ? 'google-gemini'
      : 'openai-completions'
    let base = _normalizeBaseUrl(baseUrl)
    // 仅 Anthropic 强制补 /v1，OpenAI 兼容类不强制（火山引擎等用 /v3）
    if (type === 'anthropic-messages' && !/\/v1$/i.test(base)) base += '/v1'
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    try {
      let resp
      if (type === 'anthropic-messages') {
        const headers = { 'anthropic-version': '2023-06-01' }
        _addAnthropicAuth(headers, apiKey, base)
        resp = await fetch(`${base}/models`, { headers, signal: controller.signal })
      } else if (type === 'google-gemini') {
        resp = await fetch(`${base}/models?key=${encodeURIComponent(apiKey || '')}`, { signal: controller.signal })
      } else {
        const headers = {}
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
        resp = await fetch(`${base}/models`, { headers, signal: controller.signal })
      }
      clearTimeout(timeout)
      if (!resp.ok) {
        const text = await resp.text().catch(() => '')
        let msg = `HTTP ${resp.status}`
        try {
          const parsed = JSON.parse(text)
          msg = parsed.error?.message || parsed.message || msg
        } catch {}
        throw new Error(msg)
      }
      const data = await resp.json()
      const ids = (data.data || []).map(m => m.id)
        .concat((data.models || []).map(m => (m.name || '').replace(/^models\//, '')))
        .filter(Boolean)
        .sort()
      if (!ids.length) throw new Error('该服务商返回了空的模型列表')
      return ids
    } catch (e) {
      clearTimeout(timeout)
      if (e.name === 'AbortError') throw new Error('请求超时 (15s)')
      throw e
    }
  },

  // 日志
  read_log_tail({ logName, lines = 100 }) {
    const logFiles = {
      'gateway': 'gateway.log',
      'gateway-err': 'gateway.err.log',
      'guardian': 'guardian.log',
      'guardian-backup': 'guardian-backup.log',
      'config-audit': 'config-audit.log',
    }
    const file = logFiles[logName] || logFiles['gateway']
    const logPath = path.join(LOGS_DIR, file)
    if (!fs.existsSync(logPath)) return ''
    try {
      return execSync(`tail -${lines} "${logPath}" 2>&1`, { windowsHide: true }).toString()
    } catch {
      const content = fs.readFileSync(logPath, 'utf8')
      return content.split('\n').slice(-lines).join('\n')
    }
  },

  search_log({ logName, query, maxResults = 50 }) {
    const logFiles = {
      'gateway': 'gateway.log',
      'gateway-err': 'gateway.err.log',
    }
    const file = logFiles[logName] || logFiles['gateway']
    const logPath = path.join(LOGS_DIR, file)
    if (!fs.existsSync(logPath)) return []
    // 纯 JS 实现，避免 shell 命令注入
    const content = fs.readFileSync(logPath, 'utf8')
    const queryLower = (query || '').toLowerCase()
    const matched = content.split('\n').filter(line => line.toLowerCase().includes(queryLower))
    return matched.slice(-maxResults)
  },

  // Agent 管理
  list_agents() {
    return listConfiguredAgentsData()
  },

  // 用户自定义 CSS 主题(Agent Studio)—— ~/.privix/user.css
  read_user_css() {
    const cssPath = path.join(os.homedir(), '.privix', 'user.css')
    if (!fs.existsSync(cssPath)) return ''
    try {
      return fs.readFileSync(cssPath, 'utf8')
    } catch (e) {
      throw new Error(`读取 user.css 失败: ${e.message}`)
    }
  },
  write_user_css({ content }) {
    const dir = path.join(os.homedir(), '.privix')
    try {
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'user.css'), content ?? '', 'utf8')
    } catch (e) {
      throw new Error(`写入 user.css 失败: ${e.message}`)
    }
  },
  get_user_css_path() {
    return path.join(os.homedir(), '.privix', 'user.css')
  },

  // CLI Agent 自动检测(Agent Studio)
  detect_agents() {
    const knownAgents = [
      { id: 'claude', label: 'Claude Code', binaries: ['claude'], versionArgs: ['--version'],
        description: 'Anthropic 官方 CLI,Claude 4.5/4.6 驱动',
        homepage: 'https://claude.com/claude-code',
        installUrl: 'https://docs.claude.com/en/docs/claude-code/quickstart' },
      { id: 'codex', label: 'OpenAI Codex', binaries: ['codex'], versionArgs: ['--version'],
        description: 'OpenAI 开源 CLI Agent',
        homepage: 'https://developers.openai.com/codex/cli',
        installUrl: 'https://github.com/openai/codex' },
      { id: 'gemini', label: 'Gemini CLI', binaries: ['gemini'], versionArgs: ['--version'],
        description: 'Google 官方 Gemini CLI Agent',
        homepage: 'https://github.com/google-gemini/gemini-cli',
        installUrl: 'https://github.com/google-gemini/gemini-cli' },
      { id: 'qwen', label: 'Qwen Code', binaries: ['qwen'], versionArgs: ['--version'],
        description: '阿里通义千问 CLI Agent',
        homepage: 'https://github.com/QwenLM/qwen-code',
        installUrl: 'https://github.com/QwenLM/qwen-code' },
      { id: 'goose', label: 'Goose', binaries: ['goose'], versionArgs: ['--version'],
        description: 'Block 开源 AI Agent 框架',
        homepage: 'https://block.github.io/goose/',
        installUrl: 'https://block.github.io/goose/docs/getting-started/installation' },
      { id: 'openclaw', label: 'OpenClaw', binaries: ['openclaw'], versionArgs: ['--version'],
        description: 'OpenClaw 多 Agent 编排引擎(Privix 内置)',
        homepage: 'https://www.openclaw.ai',
        installUrl: 'https://www.openclaw.ai' },
      { id: 'iflow', label: 'iFlow CLI', binaries: ['iflow'], versionArgs: ['--version'],
        description: '心流 AI CLI Agent',
        homepage: 'https://iflow.cn',
        installUrl: 'https://iflow.cn' },
      { id: 'kimi', label: 'Kimi CLI', binaries: ['kimi'], versionArgs: ['--version'],
        description: 'Moonshot Kimi for Coding CLI',
        homepage: 'https://www.kimi.com/code',
        installUrl: 'https://www.kimi.com/code' },
      { id: 'opencode', label: 'OpenCode', binaries: ['opencode'], versionArgs: ['--version'],
        description: 'SST 开源 Terminal AI Coder',
        homepage: 'https://opencode.ai',
        installUrl: 'https://opencode.ai/docs' },
      { id: 'droid', label: 'Factory Droid', binaries: ['droid'], versionArgs: ['--version'],
        description: 'Factory 企业级 Droid CLI',
        homepage: 'https://www.factory.ai',
        installUrl: 'https://docs.factory.ai' },
      { id: 'qoder', label: 'Qoder CLI', binaries: ['qoder'], versionArgs: ['--version'],
        description: 'Qoder 代码助手 CLI',
        homepage: 'https://qoder.com',
        installUrl: 'https://qoder.com' },
      { id: 'codebuddy', label: 'CodeBuddy', binaries: ['codebuddy'], versionArgs: ['--version'],
        description: '腾讯 CodeBuddy AI 助手',
        homepage: 'https://copilot.tencent.com',
        installUrl: 'https://copilot.tencent.com' },
    ]
    const pathSep = process.platform === 'win32' ? ';' : ':'
    const exts = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : ['']
    const findInPath = (binary) => {
      const pathEnv = process.env.PATH || ''
      for (const dir of pathEnv.split(pathSep)) {
        const trimmed = (dir || '').trim()
        if (!trimmed) continue
        for (const ext of exts) {
          const candidate = path.join(trimmed, `${binary}${ext}`)
          try {
            if (fs.statSync(candidate).isFile()) return candidate
          } catch {}
        }
      }
      return null
    }
    const probeVersion = (binaryPath, args) => {
      try {
        // 使用 execFileSync 避免 shell 注入(不经过 shell 解析,参数直接传递)
        const out = execFileSync(binaryPath, args, {
          timeout: 3000,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        }).toString()
        const first = out.split('\n')[0].trim()
        return first && first.length < 200 ? first : null
      } catch (e) {
        // stderr 里也可能有版本信息
        const stderr = (e.stderr || '').toString().split('\n')[0].trim()
        return stderr && stderr.length < 200 ? stderr : null
      }
    }
    return knownAgents.map(agent => {
      let foundPath = null
      let binaryUsed = agent.binaries[0]
      for (const bin of agent.binaries) {
        const p = findInPath(bin)
        if (p) {
          foundPath = p
          binaryUsed = bin
          break
        }
      }
      if (foundPath) {
        return {
          id: agent.id,
          label: agent.label,
          description: agent.description,
          homepage: agent.homepage,
          installUrl: agent.installUrl,
          installed: true,
          version: probeVersion(foundPath, agent.versionArgs),
          path: foundPath,
          binary: binaryUsed,
        }
      }
      return {
        id: agent.id,
        label: agent.label,
        description: agent.description,
        homepage: agent.homepage,
        installUrl: agent.installUrl,
        installed: false,
        version: null,
        path: null,
        binary: binaryUsed,
      }
    })
  },

  // 记忆文件
  list_memory_files({ category, agent_id }) {
    const suffix = agent_id && agent_id !== 'main' ? `/agents/${agent_id}` : ''
    const dir = path.join(OPENCLAW_DIR, 'workspace' + suffix, category || 'memory')
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir).filter(f => f.endsWith('.md'))
  },

  read_memory_file({ path: filePath, agent_id }) {
    if (isUnsafePath(filePath)) throw new Error('非法路径')
    const suffix = agent_id && agent_id !== 'main' ? `/agents/${agent_id}` : ''
    const full = path.join(OPENCLAW_DIR, 'workspace' + suffix, filePath)
    if (!fs.existsSync(full)) return ''
    return fs.readFileSync(full, 'utf8')
  },

  write_memory_file({ path: filePath, content, category, agent_id }) {
    if (isUnsafePath(filePath)) throw new Error('非法路径')
    const suffix = agent_id && agent_id !== 'main' ? `/agents/${agent_id}` : ''
    const full = path.join(OPENCLAW_DIR, 'workspace' + suffix, filePath)
    const dir = path.dirname(full)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(full, content)
    return true
  },

  delete_memory_file({ path: filePath, agent_id }) {
    if (isUnsafePath(filePath)) throw new Error('非法路径')
    const suffix = agent_id && agent_id !== 'main' ? `/agents/${agent_id}` : ''
    const full = path.join(OPENCLAW_DIR, 'workspace' + suffix, filePath)
    if (fs.existsSync(full)) fs.unlinkSync(full)
    return true
  },

  export_memory_zip({ category, agent_id }) {
    throw new Error('ZIP 导出仅在 Tauri 桌面应用中可用')
  },

  // 备份管理
  list_backups() {
    if (!fs.existsSync(BACKUPS_DIR)) return []
    return fs.readdirSync(BACKUPS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(name => {
        const stat = fs.statSync(path.join(BACKUPS_DIR, name))
        return { name, size: stat.size, created_at: Math.floor((stat.birthtimeMs || stat.mtimeMs) / 1000) }
      })
      .sort((a, b) => b.created_at - a.created_at)
  },

  create_backup() {
    if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true })
    const now = new Date()
    const pad = n => String(n).padStart(2, '0')
    const name = `openclaw-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.json`
    fs.copyFileSync(CONFIG_PATH, path.join(BACKUPS_DIR, name))
    return { name, size: fs.statSync(path.join(BACKUPS_DIR, name)).size }
  },

  restore_backup({ name }) {
    if (name.includes('..') || name.includes('/') || name.includes('\\')) throw new Error('非法文件名')
    const src = path.join(BACKUPS_DIR, name)
    if (!fs.existsSync(src)) throw new Error('备份不存在')
    if (fs.existsSync(CONFIG_PATH)) handlers.create_backup()
    fs.copyFileSync(src, CONFIG_PATH)
    return true
  },

  delete_backup({ name }) {
    if (name.includes('..') || name.includes('/') || name.includes('\\')) throw new Error('非法文件名')
    const p = path.join(BACKUPS_DIR, name)
    if (fs.existsSync(p)) fs.unlinkSync(p)
    return true
  },

  // Vision 补丁
  patch_model_vision() {
    if (!fs.existsSync(CONFIG_PATH)) return false
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    let changed = false
    const providers = config?.models?.providers
    if (providers) {
      for (const p of Object.values(providers)) {
        if (!Array.isArray(p.models)) continue
        for (const m of p.models) {
          if (typeof m === 'object' && !m.input) {
            m.input = ['text', 'image']
            changed = true
          }
        }
      }
    }
    if (changed) {
      fs.copyFileSync(CONFIG_PATH, CONFIG_PATH + '.bak')
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
    }
    return changed
  },

  // Gateway 安装/卸载
  install_gateway() {
    try { execSync('openclaw --version 2>&1', { windowsHide: true }) } catch { throw new Error('openclaw CLI 未安装') }
    return execSync('openclaw gateway install 2>&1', { windowsHide: true }).toString() || 'Gateway 服务已安装'
  },

  async list_openclaw_versions({ source = 'chinese' } = {}) {
    const pkg = npmPackageName(source)
    const encodedPkg = pkg.replace('/', '%2F').replace('@', '%40')
    const firstRegistry = pickRegistryForPackage(pkg)
    const registries = [...new Set([firstRegistry, 'https://registry.npmjs.org'])]
    let lastError = null
    for (const registry of registries) {
      try {
        const resp = await fetch(`${registry}/${encodedPkg}`, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(10000) })
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const data = await resp.json()
        const versions = Object.keys(data.versions || {})
        versions.sort((a, b) => versionCompare(b, a))
        const recommended = recommendedVersionFor(source)
        if (recommended) {
          const pos = versions.indexOf(recommended)
          if (pos >= 0) {
            versions.splice(pos, 1)
            versions.unshift(recommended)
          } else {
            versions.unshift(recommended)
          }
        }
        return versions
      } catch (e) {
        lastError = e
      }
    }
    throw new Error('查询版本失败: ' + (lastError?.message || lastError || 'unknown error'))
  },

  async upgrade_openclaw({ source = 'chinese', version, method = 'auto' } = {}) {
    const currentSource = detectInstalledSource()
    const pkg = npmPackageName(source)
    const recommended = recommendedVersionFor(source)
    const ver = version || recommended || 'latest'
    const oldPkg = npmPackageName(currentSource)
    const needUninstallOld = currentSource !== source
    const npmBin = isWindows ? 'npm.cmd' : 'npm'
    const registry = pickRegistryForPackage(pkg)
    const gitConfigured = configureGitHttpsRules()
    const gitEnv = buildGitInstallEnv()
    const logs = []

    const tryStandalone = source !== 'official' && ['auto', 'standalone-r2', 'standalone-github'].includes(method)
    if (tryStandalone) {
      try {
        const githubBase = method === 'standalone-github'
          ? `https://github.com/qingchencloud/openclaw-standalone/releases/download/v${ver}`
          : null
        const saResult = await _tryStandaloneInstall(ver, logs, githubBase)
        if (saResult) {
          const label = method === 'standalone-github' ? 'GitHub' : 'CDN'
          logs.push(`✅ standalone (${label}) 安装完成`)
          return logs.join('\n')
        }
      } catch (e) {
        if (method === 'auto') logs.push(`standalone 不可用（${e.message}），降级到 npm 安装...`)
        else throw new Error(`standalone 安装失败: ${e.message}`)
      }
    }

    if (!version && recommended) {
      logs.push(`Privix ${PANEL_VERSION} 默认绑定 OpenClaw 稳定版: ${recommended}`)
    }
    logs.push(`Git HTTPS 规则已就绪 (${gitConfigured}/${GIT_HTTPS_REWRITES.length})`)
    const runInstall = (targetRegistry) => execSync(
      `${npmBin} install -g ${pkg}@${ver} --force --registry ${targetRegistry} --verbose 2>&1`,
      { timeout: 120000, windowsHide: true, env: gitEnv }
    ).toString()
    try {
      let out
      try {
        out = runInstall(registry)
      } catch (e) {
        if (registry !== 'https://registry.npmjs.org') {
          logs.push('镜像源安装失败，自动切换到 npm 官方源重试...')
          out = runInstall('https://registry.npmjs.org')
        } else {
          throw e
        }
      }
      if (needUninstallOld) {
        try { execSync(`${npmBin} uninstall -g ${oldPkg} 2>&1`, { timeout: 60000, windowsHide: true }) } catch {}
      }
      logs.push(`安装完成 (${pkg}@${ver})`)
      return `${logs.join('\n')}\n${out.slice(-400)}`
    } catch (e) {
      throw new Error('安装失败: ' + (e.stderr?.toString() || e.message).slice(-300))
    }
  },

  uninstall_openclaw({ cleanConfig = false } = {}) {
    const npmBin = isWindows ? 'npm.cmd' : 'npm'
    const saDir = standaloneInstallDir()
    if (fs.existsSync(saDir)) {
      try { fs.rmSync(saDir, { recursive: true, force: true }) } catch {}
    }
    try { execSync(`${npmBin} uninstall -g openclaw 2>&1`, { timeout: 60000, windowsHide: true }) } catch {}
    try { execSync(`${npmBin} uninstall -g @qingchencloud/openclaw-zh 2>&1`, { timeout: 60000, windowsHide: true }) } catch {}
    if (cleanConfig && fs.existsSync(OPENCLAW_DIR)) {
      try { fs.rmSync(OPENCLAW_DIR, { recursive: true, force: true }) } catch {}
    }
    return cleanConfig ? 'OpenClaw 已完全卸载（包括配置文件）' : 'OpenClaw 已卸载（配置文件保留）'
  },

  uninstall_gateway() {
    if (isMac) {
      const uid = getUid()
      try { execSync(`launchctl bootout gui/${uid}/ai.openclaw.gateway 2>&1`) } catch {}
      const plist = path.join(homedir(), 'Library/LaunchAgents/ai.openclaw.gateway.plist')
      if (fs.existsSync(plist)) fs.unlinkSync(plist)
    }
    return 'Gateway 服务已卸载'
  },

  // 自动初始化配置文件（CLI 已装但 openclaw.json 不存在时）
  init_openclaw_config() {
    if (fs.existsSync(CONFIG_PATH)) return { created: false, message: '配置文件已存在' }
    if (!fs.existsSync(OPENCLAW_DIR)) fs.mkdirSync(OPENCLAW_DIR, { recursive: true })
    const lastTouchedVersion = recommendedVersionFor('chinese') || '2026.1.1'
    const defaultConfig = {
      "$schema": "https://openclaw.ai/schema/config.json",
      meta: { lastTouchedVersion },
      models: { providers: {} },
      gateway: {
        mode: "local",
        port: 18789,
        auth: { mode: "none" },
        controlUi: { allowedOrigins: ["*"], allowInsecureAuth: true }
      },
      tools: { profile: "full", sessions: { visibility: "all" } }
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2))
    return { created: true, message: '配置文件已创建' }
  },

  get_deploy_config() {
    try {
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
      const gw = config.gateway || {}
      return { gatewayUrl: `http://127.0.0.1:${gw.port || 18789}`, authToken: gw.auth?.token || '', version: null }
    } catch {
      return { gatewayUrl: 'http://127.0.0.1:18789', authToken: '', version: null }
    }
  },

  get_npm_registry() {
    const regFile = path.join(OPENCLAW_DIR, 'npm-registry.txt')
    if (fs.existsSync(regFile)) return fs.readFileSync(regFile, 'utf8').trim() || 'https://registry.npmmirror.com'
    return 'https://registry.npmmirror.com'
  },

  set_npm_registry({ registry }) {
    fs.writeFileSync(path.join(OPENCLAW_DIR, 'npm-registry.txt'), registry.trim())
    return true
  },

  // Skills 管理（纯本地扫描 + SkillHub SDK）
  skills_list({ agent_id } = {}) {
    const agentDir = resolveAgentSkillsDir(agent_id)
    return scanLocalSkillsFallback(agentDir)
  },
  skills_info({ name, agent_id } = {}) {
    const n = String(name || '').trim()
    const agentDir = resolveAgentSkillsDir(agent_id)
    const fallback = scanLocalSkillsFallback(agentDir).skills.find(skill => skill.name === n)
    if (fallback) return fallback
    throw new Error(`Skill「${n}」不存在`)
  },
  skills_check() {
    const data = scanLocalSkillsFallback()
    return {
      total: data.skills.length,
      ready: data.skills.filter(s => s.eligible).length,
      missingDeps: data.skills.filter(s => !s.eligible).length,
      skills: data.skills,
    }
  },
  skills_install_dep({ kind, spec }) {
    const cmds = {
      brew: `brew install ${spec?.formula || ''}`,
      node: `npm install -g ${spec?.package || ''}`,
      go: `go install ${spec?.module || ''}`,
      uv: `uv tool install ${spec?.package || ''}`,
    }
    const cmd = cmds[kind]
    if (!cmd) throw new Error(`不支持的安装类型: ${kind}`)
    try {
      const out = execSync(cmd, { encoding: 'utf8', timeout: 120000 })
      return { success: true, output: out.trim() }
    } catch (e) {
      throw new Error(`安装失败: ${e.message || e}`)
    }
  },
  skills_uninstall({ name, agent_id } = {}) {
    if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) throw new Error('无效的 Skill 名称')
    const agentDir = resolveAgentSkillsDir(agent_id)
    const baseDir = agentDir || path.join(OPENCLAW_DIR, 'skills')
    const skillDir = path.join(baseDir, name)
    if (!fs.existsSync(skillDir)) throw new Error(`Skill「${name}」不存在`)
    fs.rmSync(skillDir, { recursive: true, force: true })
    return { success: true, name }
  },
  // SkillHub SDK（内置 HTTP，不依赖 CLI）
  async skillhub_search({ query, limit }) {
    return await skillhubSdk.search(query, limit || 20)
  },
  async skillhub_index() {
    return await skillhubSdk.fetchIndex()
  },
  async skillhub_install({ slug, agent_id } = {}) {
    const agentDir = resolveAgentSkillsDir(agent_id)
    const skillsDir = agentDir || path.join(OPENCLAW_DIR, 'skills')
    if (!fs.existsSync(skillsDir)) fs.mkdirSync(skillsDir, { recursive: true })
    const installedPath = await skillhubSdk.install(slug, skillsDir)
    return { success: true, slug, path: installedPath }
  },

  // 设备配对 + Gateway 握手
  auto_pair_device() {
    const originsChanged = patchGatewayOrigins()
    const { deviceId, publicKey } = getOrCreateDeviceKey()
    if (!fs.existsSync(DEVICES_DIR)) fs.mkdirSync(DEVICES_DIR, { recursive: true })
    let paired = {}
    if (fs.existsSync(PAIRED_PATH)) paired = JSON.parse(fs.readFileSync(PAIRED_PATH, 'utf8'))
    const platform = process.platform === 'darwin' ? 'macos' : process.platform
    if (paired[deviceId]) {
      if (paired[deviceId].platform !== platform) {
        paired[deviceId].platform = platform
        paired[deviceId].deviceFamily = 'desktop'
        fs.writeFileSync(PAIRED_PATH, JSON.stringify(paired, null, 2))
        return { message: '设备已配对（已修正平台字段）', changed: true }
      }
      return { message: '设备已配对', changed: originsChanged }
    }
    const nowMs = Date.now()
    paired[deviceId] = {
      deviceId, publicKey, platform, deviceFamily: 'desktop',
      clientId: 'openclaw-control-ui', clientMode: 'ui',
      role: 'operator', roles: ['operator'],
      scopes: SCOPES, approvedScopes: SCOPES, tokens: {},
      createdAtMs: nowMs, approvedAtMs: nowMs,
    }
    fs.writeFileSync(PAIRED_PATH, JSON.stringify(paired, null, 2))
    return { message: '设备配对成功', changed: true }
  },

  check_pairing_status() {
    if (!fs.existsSync(DEVICE_KEY_FILE)) return { paired: false }
    const keyData = JSON.parse(fs.readFileSync(DEVICE_KEY_FILE, 'utf8'))
    if (!fs.existsSync(PAIRED_PATH)) return { paired: false }
    const paired = JSON.parse(fs.readFileSync(PAIRED_PATH, 'utf8'))
    return { paired: !!paired[keyData.deviceId] }
  },

  create_connect_frame({ nonce, gatewayToken }) {
    const { deviceId, publicKey, privateKey } = getOrCreateDeviceKey()
    const signedAt = Date.now()
    const platform = process.platform === 'darwin' ? 'macos' : process.platform
    const scopesStr = SCOPES.join(',')
    const payloadStr = `v3|${deviceId}|openclaw-control-ui|ui|operator|${scopesStr}|${signedAt}|${gatewayToken || ''}|${nonce || ''}|${platform}|desktop`
    const signature = crypto.sign(null, Buffer.from(payloadStr), privateKey)
    const sigB64 = Buffer.from(signature).toString('base64url')
    const idHex = (signedAt & 0xFFFFFFFF).toString(16).padStart(8, '0')
    const rndHex = Math.floor(Math.random() * 0xFFFF).toString(16).padStart(4, '0')
    return {
      type: 'req',
      id: `connect-${idHex}-${rndHex}`,
      method: 'connect',
      params: {
        minProtocol: 3, maxProtocol: 3,
        client: { id: 'openclaw-control-ui', version: '1.0.0', platform, deviceFamily: 'desktop', mode: 'ui' },
        role: 'operator', scopes: SCOPES, caps: [],
        auth: { token: gatewayToken || '' },
        device: { id: deviceId, publicKey, signedAt, nonce: nonce || '', signature: sigB64 },
        locale: 'zh-CN', userAgent: 'Privix/1.0.0 (web)',
      },
    }
  },
  // 数据目录 & 图片存储
  assistant_ensure_data_dir() {
    const dataDir = path.join(OPENCLAW_DIR, 'clawpanel')
    for (const sub of ['images', 'sessions', 'cache']) {
      const dir = path.join(dataDir, sub)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    }
    return dataDir
  },

  assistant_save_image({ id, data }) {
    const dir = path.join(OPENCLAW_DIR, 'clawpanel', 'images')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const pureB64 = data.includes(',') ? data.split(',')[1] : data
    const ext = data.startsWith('data:image/png') ? 'png'
      : data.startsWith('data:image/gif') ? 'gif'
      : data.startsWith('data:image/webp') ? 'webp' : 'jpg'
    const filepath = path.join(dir, `${id}.${ext}`)
    fs.writeFileSync(filepath, Buffer.from(pureB64, 'base64'))
    return filepath
  },

  assistant_load_image({ id }) {
    const dir = path.join(OPENCLAW_DIR, 'clawpanel', 'images')
    for (const ext of ['jpg', 'png', 'gif', 'webp', 'jpeg']) {
      const filepath = path.join(dir, `${id}.${ext}`)
      if (fs.existsSync(filepath)) {
        const bytes = fs.readFileSync(filepath)
        const mime = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
        return `data:${mime};base64,${bytes.toString('base64')}`
      }
    }
    throw new Error(`图片 ${id} 不存在`)
  },

  assistant_delete_image({ id }) {
    const dir = path.join(OPENCLAW_DIR, 'clawpanel', 'images')
    for (const ext of ['jpg', 'png', 'gif', 'webp', 'jpeg']) {
      const filepath = path.join(dir, `${id}.${ext}`)
      if (fs.existsSync(filepath)) fs.unlinkSync(filepath)
    }
    return null
  },

  // === AI 助手工具（Web 模式真实执行） ===

  assistant_exec({ command, cwd }) {
    if (!command) throw new Error('命令不能为空')
    // 安全限制：禁止危险命令
    const dangerous = ['rm -rf /', 'mkfs', 'dd if=', ':(){', 'format ', 'del /f /s /q C:']
    if (dangerous.some(d => command.includes(d))) throw new Error('危险命令已被拦截')
    const opts = { timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true }
    if (cwd) opts.cwd = cwd
    try {
      const output = execSync(command, opts).toString()
      return output || '（命令已执行，无输出）'
    } catch (e) {
      const stderr = e.stderr?.toString() || ''
      const stdout = e.stdout?.toString() || ''
      return `退出码: ${e.status || 1}\n${stdout}${stderr ? '\n[stderr] ' + stderr : ''}`
    }
  },

  assistant_read_file({ path: filePath }) {
    if (!filePath) throw new Error('路径不能为空')
    const expanded = filePath.startsWith('~/') ? path.join(homedir(), filePath.slice(2)) : filePath
    if (!fs.existsSync(expanded)) throw new Error(`文件不存在: ${filePath}`)
    const stat = fs.statSync(expanded)
    if (stat.size > 1024 * 1024) throw new Error(`文件过大 (${(stat.size / 1024 / 1024).toFixed(1)}MB)，最大 1MB`)
    return fs.readFileSync(expanded, 'utf8')
  },

  assistant_write_file({ path: filePath, content }) {
    if (!filePath) throw new Error('路径不能为空')
    const expanded = filePath.startsWith('~/') ? path.join(homedir(), filePath.slice(2)) : filePath
    const dir = path.dirname(expanded)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(expanded, content || '')
    return `已写入 ${filePath} (${Buffer.byteLength(content || '', 'utf8')} 字节)`
  },

  assistant_list_dir({ path: dirPath }) {
    if (!dirPath) throw new Error('路径不能为空')
    const expanded = dirPath.startsWith('~/') ? path.join(homedir(), dirPath.slice(2)) : dirPath
    if (!fs.existsSync(expanded)) throw new Error(`目录不存在: ${dirPath}`)
    const entries = fs.readdirSync(expanded, { withFileTypes: true })
    return entries.map(e => {
      if (e.isDirectory()) return `[DIR]  ${e.name}/`
      try {
        const stat = fs.statSync(path.join(expanded, e.name))
        const size = stat.size < 1024 ? `${stat.size} B` : stat.size < 1048576 ? `${(stat.size / 1024).toFixed(1)} KB` : `${(stat.size / 1048576).toFixed(1)} MB`
        return `[FILE] ${e.name} (${size})`
      } catch {
        return `[FILE] ${e.name}`
      }
    }).join('\n') || '（空目录）'
  },

  assistant_system_info() {
    const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux'
    const arch = process.arch
    const home = homedir()
    const hostname = os.hostname()
    const shell = process.platform === 'win32' ? 'powershell / cmd' : (process.env.SHELL || '/bin/bash')
    const sep = path.sep
    const totalMem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1)
    const freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(1)
    const cpus = os.cpus()
    const cpuModel = cpus[0]?.model || '未知'
    const lines = [
      `OS: ${platform}`,
      `Arch: ${arch}`,
      `Home: ${home}`,
      `Hostname: ${hostname}`,
      `Shell: ${shell}`,
      `Path separator: ${sep}`,
      `CPU: ${cpuModel} (${cpus.length} 核)`,
      `Memory: ${freeMem}GB free / ${totalMem}GB total`,
    ]
    // Node.js 版本
    try {
      const nodeVer = execSync('node --version 2>&1', { windowsHide: true }).toString().trim()
      lines.push(`Node.js: ${nodeVer}`)
    } catch {}
    return lines.join('\n')
  },

  assistant_list_processes({ filter }) {
    try {
      if (isWindows) {
        const cmd = filter
          ? `tasklist /FI "IMAGENAME eq ${filter}*" /FO CSV /NH 2>nul`
          : 'tasklist /FO CSV /NH 2>nul | more +1'
        const output = execSync(cmd, { timeout: 5000, windowsHide: true }).toString().trim()
        return output || '（无匹配进程）'
      } else {
        const cmd = filter
          ? `ps aux | head -1 && ps aux | grep -i "${filter}" | grep -v grep`
          : 'ps aux | head -20'
        const output = execSync(cmd, { timeout: 5000 }).toString().trim()
        return output || '（无匹配进程）'
      }
    } catch (e) {
      return e.stdout?.toString() || '（无匹配进程）'
    }
  },

  assistant_check_port({ port }) {
    if (!port) throw new Error('端口号不能为空')
    try {
      if (isWindows) {
        const output = execSync(`netstat -ano | findstr :${port}`, { timeout: 5000, windowsHide: true }).toString().trim()
        return output ? `端口 ${port} 已被占用（正在监听）\n${output}` : `端口 ${port} 未被占用（空闲）`
      } else {
        const output = execSync(`ss -tlnp 'sport = :${port}' 2>/dev/null || lsof -i :${port} 2>/dev/null`, { timeout: 5000 }).toString().trim()
        // ss 输出第一行是表头，需要检查是否有第二行
        const lines = output.split('\n').filter(l => l.trim())
        if (lines.length > 1 || output.includes(`:${port}`)) {
          return `端口 ${port} 已被占用（正在监听）\n${output}`
        }
        return `端口 ${port} 未被占用（空闲）`
      }
    } catch {
      return `端口 ${port} 未被占用（空闲）`
    }
  },

  // === AI 助手联网搜索工具 ===

  async assistant_web_search({ query, max_results = 5 }) {
    if (!query) throw new Error('搜索关键词不能为空')
    try {
      // 使用 DuckDuckGo HTML 搜索
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
      const https = require('https')
      const http = require('http')
      const fetchModule = url.startsWith('https') ? https : http
      const html = await new Promise((resolve, reject) => {
        const req = fetchModule.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }, timeout: 10000 }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            // 跟随重定向
            const rUrl = res.headers.location.startsWith('http') ? res.headers.location : `https://html.duckduckgo.com${res.headers.location}`
            fetchModule.get(rUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 }, (res2) => {
              let d = ''; res2.on('data', c => d += c); res2.on('end', () => resolve(d))
            }).on('error', reject)
            return
          }
          let data = ''; res.on('data', c => data += c); res.on('end', () => resolve(data))
        })
        req.on('error', reject)
        req.on('timeout', () => { req.destroy(); reject(new Error('搜索超时')) })
      })

      // 解析搜索结果
      const results = []
      const regex = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi
      let match
      while ((match = regex.exec(html)) !== null && results.length < max_results) {
        const rawUrl = match[1]
        const title = match[2].replace(/<[^>]+>/g, '').trim()
        const snippet = match[3].replace(/<[^>]+>/g, '').trim()
        // DuckDuckGo 的 URL 需要解码
        let finalUrl = rawUrl
        try {
          const uddg = new URL(rawUrl, 'https://duckduckgo.com').searchParams.get('uddg')
          if (uddg) finalUrl = decodeURIComponent(uddg)
        } catch {}
        if (title && finalUrl) {
          results.push({ title, url: finalUrl, snippet })
        }
      }

      if (results.length === 0) {
        return `搜索「${query}」未找到相关结果。`
      }

      let output = `搜索「${query}」找到 ${results.length} 条结果：\n\n`
      results.forEach((r, i) => {
        output += `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}\n\n`
      })
      return output
    } catch (err) {
      return `搜索失败: ${err.message}。请检查网络连接。`
    }
  },

  async assistant_fetch_url({ url }) {
    if (!url) throw new Error('URL 不能为空')
    if (!url.startsWith('http://') && !url.startsWith('https://')) throw new Error('URL 必须以 http:// 或 https:// 开头')

    try {
      // 优先使用 Jina Reader API（免费，返回 Markdown）
      const jinaUrl = 'https://r.jina.ai/' + url
      const https = require('https')
      const content = await new Promise((resolve, reject) => {
        const req = https.get(jinaUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/plain' },
          timeout: 15000,
        }, (res) => {
          let data = ''
          res.on('data', c => {
            data += c
            if (data.length > 100000) { req.destroy(); resolve(data.slice(0, 100000) + '\n\n[内容已截断，超过 100KB 限制]') }
          })
          res.on('end', () => resolve(data))
        })
        req.on('error', reject)
        req.on('timeout', () => { req.destroy(); reject(new Error('抓取超时')) })
      })

      return content || '（页面内容为空）'
    } catch (err) {
      return `抓取失败: ${err.message}`
    }
  },

  // === 面板配置（Web 模式） ===

  read_panel_config() {
    return readPanelConfig()
  },

  write_panel_config({ config }) {
    writePanelConfigFile(config)
    return true
  },

  // === ClawSwarm 会话持久化 ===

  read_swarm_sessions() {
    const p = path.join(PANEL_RUNTIME_DIR, 'swarm-sessions.json')
    if (!fs.existsSync(p)) return {}
    try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return {} }
  },

  write_swarm_sessions({ data }) {
    ensureDir(PANEL_RUNTIME_DIR)
    const p = path.join(PANEL_RUNTIME_DIR, 'swarm-sessions.json')
    if (fs.existsSync(p)) {
      try { fs.copyFileSync(p, p + '.bak') } catch {}
    }
    fs.writeFileSync(p, JSON.stringify(data, null, 2))
    return true
  },

  get_openclaw_dir() {
    const panelConfig = readPanelConfig()
    const custom = typeof panelConfig?.openclawDir === 'string' && panelConfig.openclawDir.trim()
      ? panelConfig.openclawDir.trim()
      : null
    return {
      path: custom || OPENCLAW_DIR,
      resolved: custom || OPENCLAW_DIR,
      default: path.join(homedir(), '.openclaw'),
      custom,
      isCustom: !!custom,
    }
  },

  doctor_check() {
    const bin = findOpenclawBin() || 'openclaw'
    try {
      const output = execSync(`${bin} doctor`, { timeout: 30000, cwd: homedir(), stdio: 'pipe' }).toString()
      return { success: true, output: output.trim(), errors: '', exitCode: 0 }
    } catch (e) {
      return {
        success: false,
        output: (e.stdout?.toString() || '').trim(),
        errors: (e.stderr?.toString() || e.message || String(e)).trim(),
        exitCode: typeof e.status === 'number' ? e.status : 1,
      }
    }
  },

  doctor_fix() {
    const bin = findOpenclawBin() || 'openclaw'
    try {
      const output = execSync(`${bin} doctor --fix`, { timeout: 30000, cwd: homedir(), stdio: 'pipe' }).toString()
      return { success: true, output: output.trim(), errors: '', exitCode: 0 }
    } catch (e) {
      return {
        success: false,
        output: (e.stdout?.toString() || '').trim(),
        errors: (e.stderr?.toString() || e.message || String(e)).trim(),
        exitCode: typeof e.status === 'number' ? e.status : 1,
      }
    }
  },

  test_proxy({ url }) {
    const cfg = readPanelConfig()
    const proxyUrl = cfg?.networkProxy?.url
    if (!proxyUrl) throw new Error('未配置代理地址')
    return { ok: true, status: 200, elapsed_ms: 0, proxy: proxyUrl, target: url || 'N/A (Web模式不支持代理测试)' }
  },

  // === Agent 管理（Web 模式） ===

  add_agent({ name, model, workspace }) {
    if (!name) throw new Error('Agent 名称不能为空')
    const agentsDir = path.join(OPENCLAW_DIR, 'agents')
    const agentDir = path.join(agentsDir, name)
    if (fs.existsSync(agentDir)) throw new Error(`Agent "${name}" 已存在`)
    fs.mkdirSync(agentDir, { recursive: true })
    const resolvedWorkspace = workspace || defaultWorkspaceForAgent(name)
    fs.mkdirSync(resolvedWorkspace, { recursive: true })
    const meta = { id: name, model: model || null, workspace: resolvedWorkspace }
    fs.writeFileSync(path.join(agentDir, 'agent.json'), JSON.stringify(meta, null, 2))
    const config = readOpenclawConfigSafe()
    if (!config.agents) config.agents = {}
    if (!Array.isArray(config.agents.list)) config.agents.list = []
    config.agents.list = config.agents.list.filter(item => item?.id !== name)
    config.agents.list.push({
      id: name,
      workspace: resolvedWorkspace,
      model: model ? { primary: model } : undefined,
    })
    if (!fs.existsSync(OPENCLAW_DIR)) fs.mkdirSync(OPENCLAW_DIR, { recursive: true })
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
    return true
  },

  delete_agent({ id }) {
    if (!id || id === 'main') throw new Error('不能删除默认 Agent')
    const agentDir = path.join(OPENCLAW_DIR, 'agents', id)
    if (!fs.existsSync(agentDir)) throw new Error(`Agent "${id}" 不存在`)
    fs.rmSync(agentDir, { recursive: true, force: true })
    return true
  },

  update_agent_identity({ id, name, emoji }) {
    if (!id) throw new Error('Agent ID 不能为空')
    if (!fs.existsSync(CONFIG_PATH)) throw new Error('openclaw.json 不存在')
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    if (!config.agents) config.agents = {}
    if (!Array.isArray(config.agents.list)) config.agents.list = []
    let target = config.agents.list.find(item => item?.id === id)
    if (!target && id !== 'main') {
      target = { id, workspace: defaultWorkspaceForAgent(id) }
      config.agents.list.push(target)
    }
    if (id === 'main') {
      if (!config.agents.defaults) config.agents.defaults = {}
      if (!config.agents.defaults.identity) config.agents.defaults.identity = {}
      if (name) config.agents.defaults.identity.name = name
      if (emoji) config.agents.defaults.identity.emoji = emoji
    } else if (target) {
      if (!target.identity) target.identity = {}
      if (name) target.identity.name = name
      if (emoji) target.identity.emoji = emoji
    }
    fs.copyFileSync(CONFIG_PATH, CONFIG_PATH + '.bak')
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
    return true
  },

  update_agent_model({ id, model }) {
    if (!id) throw new Error('Agent ID 不能为空')
    if (!fs.existsSync(CONFIG_PATH)) throw new Error('openclaw.json 不存在')
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    if (!config.agents) config.agents = {}
    if (!Array.isArray(config.agents.list)) config.agents.list = []
    let target = config.agents.list.find(item => item?.id === id)
    if (!target && id !== 'main') {
      target = { id, workspace: defaultWorkspaceForAgent(id) }
      config.agents.list.push(target)
    }
    if (id === 'main') {
      if (!config.agents.defaults) config.agents.defaults = {}
      config.agents.defaults.model = model ? { primary: model } : undefined
    } else if (target) {
      target.model = model ? { primary: model } : undefined
    }
    fs.copyFileSync(CONFIG_PATH, CONFIG_PATH + '.bak')
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
    return true
  },

  preview_agent_workspace_generation({ payload }) {
    const mode = payload?.mode || 'configure'
    const sourceScope = payload?.sourceScope || 'core_and_common'
    const currentAgentId = payload?.agentId || null
    const parentAgentId = payload?.parentAgentId || null
    const readTargetSources = payload?.readTargetSources !== false
    const readParentSources = payload?.readParentSources !== false
    const context = { mode, sourceScope, agentId: currentAgentId, parentAgentId }
    const sources = []

    if (mode === 'configure' && currentAgentId) {
      const workspace = resolveAgentWorkspace(currentAgentId)
      context.workspace = workspace
      if (readTargetSources) {
        sources.push(...collectAgentSourceFiles(workspace, sourceScope, 'target'))
      }
    } else if (payload?.createSpec) {
      const workspace = deriveWorkspaceFromCreateSpec(payload.createSpec)
      context.workspace = workspace
      context.targetExists = fs.existsSync(workspace)
      if (readTargetSources) {
        sources.push(...collectAgentSourceFiles(workspace, sourceScope, 'target'))
      }
    }

    if (parentAgentId) {
      const parentWorkspace = resolveAgentWorkspace(parentAgentId)
      context.parentWorkspace = parentWorkspace
      if (readParentSources) {
        sources.push(...collectAgentSourceFiles(parentWorkspace, sourceScope, 'parent'))
      }
    }

    const previewTargets = []
    for (const target of payload?.generatedTargets || []) {
      const agentId = target.agentId || target.createSpec?.agentId || target.createSpec?.id || null
      const workspace = target.agentId ? resolveAgentWorkspace(target.agentId) : deriveWorkspaceFromCreateSpec(target.createSpec || {})
      const files = target.files || {}
      const diffs = {}
      const backupFiles = []
      for (const [fileName, content] of Object.entries(files)) {
        assertAllowedTargetFileName(fileName)
        const full = path.join(workspace, fileName)
        const current = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null
        if (current !== null) backupFiles.push(fileName)
        diffs[fileName] = diffSummary(current, content || '')
      }
      previewTargets.push({
        key: target.key || 'target',
        label: target.label || agentId || 'Agent',
        agentId,
        workspace,
        exists: fs.existsSync(workspace),
        diffs,
        backupPlan: {
          root: PANEL_AGENT_BACKUPS_DIR,
          files: backupFiles,
        },
      })
    }

    return {
      sourceScope,
      sources,
      context,
      previewTargets,
      targetFiles: TARGET_AGENT_OUTPUT_FILES,
    }
  },

  apply_agent_workspace_generation({ payload }) {
    const generatedTargets = Array.isArray(payload?.generatedTargets) ? payload.generatedTargets : []
    if (!generatedTargets.length) throw new Error('generatedTargets 不能为空')

    const pad = n => String(n).padStart(2, '0')
    const now = new Date()
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    const backupRoot = path.join(PANEL_AGENT_BACKUPS_DIR, stamp)
    fs.mkdirSync(backupRoot, { recursive: true })

    const createdAgents = []
    const writtenFiles = []

    for (const target of generatedTargets) {
      const createSpec = target.createSpec || null
      if (createSpec?.agentId || createSpec?.id) {
        const newAgentId = String(createSpec.agentId || createSpec.id).trim()
        const exists = listConfiguredAgentsData().some(item => item.id === newAgentId)
        if (!exists) {
          handlers.add_agent({
            name: newAgentId,
            model: createSpec.model || '',
            workspace: createSpec.workspace || deriveWorkspaceFromCreateSpec(createSpec),
          })
          createdAgents.push({ agentId: newAgentId })
        }
      }

      const agentId = target.agentId || target.createSpec?.agentId || target.createSpec?.id || null
      const workspace = target.agentId ? resolveAgentWorkspace(target.agentId) : deriveWorkspaceFromCreateSpec(target.createSpec || {})
      fs.mkdirSync(workspace, { recursive: true })
      const backupDir = path.join(backupRoot, agentId || target.key || 'target')
      fs.mkdirSync(backupDir, { recursive: true })

      for (const [fileName, content] of Object.entries(target.files || {})) {
        assertAllowedTargetFileName(fileName)
        const full = path.join(workspace, fileName)
        if (fs.existsSync(full)) {
          fs.copyFileSync(full, path.join(backupDir, fileName))
        }
        fs.writeFileSync(full, content || '')
        writtenFiles.push({ agentId, file: fileName, path: full })
      }
    }

    return {
      backupRoot,
      createdAgents,
      writtenFiles,
    }
  },

  backup_agent({ id }) {
    if (!id) throw new Error('Agent ID 不能为空')
    const suffix = id !== 'main' ? `/agents/${id}` : ''
    const wsDir = path.join(OPENCLAW_DIR, 'workspace' + suffix)
    if (!fs.existsSync(wsDir)) return '工作区为空，无需备份'
    if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true })
    const now = new Date()
    const pad = n => String(n).padStart(2, '0')
    const name = `agent-${id}-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.tar`
    try {
      execSync(`tar -cf "${path.join(BACKUPS_DIR, name)}" -C "${wsDir}" .`, { timeout: 30000 })
      return `已备份: ${name}`
    } catch (e) {
      throw new Error('备份失败: ' + (e.message || e))
    }
  },

  // === 初始设置工具（Web 模式） ===

  check_node_at_path({ nodeDir }) {
    const nodeBin = path.join(nodeDir, isWindows ? 'node.exe' : 'node')
    if (!fs.existsSync(nodeBin)) throw new Error(`未在 ${nodeDir} 找到 node`)
    try {
      const ver = execSync(`"${nodeBin}" --version 2>&1`, { timeout: 5000, windowsHide: true }).toString().trim()
      return { installed: true, version: ver, path: nodeBin }
    } catch (e) {
      throw new Error('node 检测失败: ' + e.message)
    }
  },

  scan_node_paths() {
    const results = []
    const candidates = isWindows
      ? ['C:\\Program Files\\nodejs', 'C:\\Program Files (x86)\\nodejs']
      : ['/usr/local/bin', '/usr/bin', '/opt/homebrew/bin', path.join(homedir(), '.nvm/versions/node'), path.join(homedir(), '.volta/bin')]
    for (const p of candidates) {
      const nodeBin = path.join(p, isWindows ? 'node.exe' : 'node')
      if (fs.existsSync(nodeBin)) {
        try {
          const ver = execSync(`"${nodeBin}" --version 2>&1`, { timeout: 5000, windowsHide: true }).toString().trim()
          results.push({ path: p, version: ver })
        } catch {}
      }
    }
    return results
  },

  save_custom_node_path({ nodeDir }) {
    const cfg = readPanelConfig()
    cfg.nodePath = nodeDir
    writePanelConfigFile(cfg)
    return true
  },

  // === 访问密码认证 ===
  auth_check() {
    const pw = getAccessPassword()
    return { required: !!pw, authenticated: false /* 由中间件覆写 */ }
  },
  auth_login() { throw new Error('由中间件处理') },
  auth_logout() { throw new Error('由中间件处理') },
  auth_set_password({ password }) {
    const cfg = readPanelConfig()
    cfg.accessPassword = password || ''
    writePanelConfigFile(cfg)
    // 清除所有 session（密码变更后强制重新登录）
    _sessions.clear()
    return true
  },

  check_panel_update() { return { latest: null, url: 'https://github.com/privix-community/privix/releases' } },

  async check_frontend_update() {
    return { currentVersion: PANEL_VERSION, latestVersion: PANEL_VERSION, hasUpdate: false, compatible: true, updateReady: false, manifest: { version: PANEL_VERSION } }
  },
  download_frontend_update() { return { success: true, files: 12, path: FRONTEND_UPDATE_DIR } },
  rollback_frontend_update() { return { success: true } },
  get_update_status() {
    return { currentVersion: PANEL_VERSION, updateReady: false, updateVersion: '', updateDir: FRONTEND_UPDATE_DIR }
  },
  write_env_file({ path: p, config }) {
    const expanded = p.startsWith('~/') ? path.join(homedir(), p.slice(2)) : p
    if (!expanded.startsWith(OPENCLAW_DIR)) throw new Error('只允许写入 ~/.openclaw/ 下的文件')
    const dir = path.dirname(expanded)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(expanded, config)
    return true
  },

  // === Hermes Agent 管理（Web 模式桩） ===
  check_python() {
    // 检测本机 Python 环境
    const { execSync } = require('child_process')
    let installed = false, version = '', versionOk = false, hasUv = false, hasGit = false
    try {
      version = execSync('python3 --version 2>&1 || python --version 2>&1', { encoding: 'utf8' }).trim().replace('Python ', '')
      installed = true
      const parts = version.split('.').map(Number)
      versionOk = parts[0] >= 3 && parts[1] >= 10
    } catch {}
    try { execSync('uv --version', { encoding: 'utf8' }); hasUv = true } catch {}
    try { execSync('git --version', { encoding: 'utf8' }); hasGit = true } catch {}
    return { installed, version, versionOk, hasUv, hasGit }
  },
  // Web 模式桩:为 UI 截图与开发演示,Hermes 检查统一返回就绪态
  // (Tauri 桌面版走 Rust commands,绕过 dev-api.js,生产零影响)
  check_hermes() {
    return { installed: true, version: 'v0.13.0', configExists: true, gatewayRunning: true, gatewayPort: 8642 }
  },
  install_hermes({ method, extras } = {}) { return { success: true, method } },
  configure_hermes({ provider, apiKey, model, baseUrl } = {}) { return { success: true } },
  hermes_gateway_action({ action } = {}) { return { success: true, action } },
  hermes_health_check() { return { healthy: true, model: 'QC-B01', baseUrl: 'https://gpt.qt.cool/v1', uptime: 3820 } },
  hermes_api_proxy({ method, path: p, body, headers } = {}) { return { error: 'Web 模式下 Hermes API 代理不可用' } },
  hermes_agent_run({ input, sessionId } = {}) { return { error: 'Web 模式下 Hermes Agent 运行不可用' } },
  hermes_read_config() {
    // 截图/开发演示用的就绪 config (gateway + provider + model 全配好)
    const mockConfig = [
      'gateway:',
      '  port: 8642',
      '  host: 127.0.0.1',
      'provider:',
      '  name: openai',
      '  model: QC-B01',
      '  base_url: https://gpt.qt.cool/v1',
      'memory:',
      '  path: ~/.hermes/memories',
      ''
    ].join('\n')
    return { config: mockConfig, env: { OPENAI_API_KEY: 'sk-mock-****' } }
  },
  hermes_fetch_models({ baseUrl, apiKey, apiType } = {}) {
    return ['QC-B01', 'QC-B02', 'gpt-4o', 'claude-sonnet-4.5', 'deepseek-v3']
  },
  hermes_update_model({ model } = {}) { return { success: true } },
  hermes_detect_environments() {
    return {
      wsl2: { available: false },
      docker: { available: true, version: '27.3.1', socketReachable: true }
    }
  },
  hermes_set_gateway_url({ url } = {}) { return { success: true } },
  update_hermes() { return { success: true } },
  uninstall_hermes({ cleanConfig } = {}) { return { success: true } },

  // 约定：list 类命令在目录/资源缺失时返回 [],detail/read 类命令在目标缺失时 throw——
  // 匹配前端 "空列表 = 无数据;详情报错 = 用户提示" 的消费模式
  hermes_sessions_list({ source, limit } = {}) {
    const sessions = exportHermesSessions(source)
    sessions.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    if (limit && limit > 0) return sessions.slice(0, limit)
    return sessions
  },

  hermes_session_detail({ sessionId } = {}) {
    if (!sessionId) throw new Error('sessionId is required')
    const found = exportHermesSessions(null, sessionId)
    if (!found.length) throw new Error('Session not found')
    return found[0]
  },

  hermes_session_delete({ sessionId } = {}) {
    if (!sessionId) throw new Error('sessionId is required')
    runHermesSubcommand(['sessions', 'delete', sessionId, '--yes'], 'delete session')
    return 'ok'
  },

  hermes_session_rename({ sessionId, title } = {}) {
    if (!sessionId || !title) throw new Error('sessionId and title are required')
    runHermesSubcommand(['sessions', 'rename', sessionId, title], 'rename session')
    return 'ok'
  },

  hermes_logs_list() {
    const logsDir = hermesPath('logs')
    if (!fs.existsSync(logsDir)) return []
    try {
      return fs.readdirSync(logsDir)
        .filter(f => f.endsWith('.log') || f.endsWith('.txt') || f.endsWith('.jsonl'))
        .map(f => {
          const stat = fs.statSync(path.join(logsDir, f))
          return { name: f, size: stat.size, modified: stat.mtime.toISOString() }
        })
        .sort((a, b) => b.modified.localeCompare(a.modified))
    } catch { return [] }
  },

  hermes_logs_read({ name, lines, level } = {}) {
    if (!name) throw new Error('name is required')
    const maxLines = lines || 200
    const logsDir = path.resolve(hermesPath('logs'))
    const logPath = path.resolve(logsDir, name)
    if (!logPath.startsWith(logsDir + path.sep) && logPath !== logsDir) {
      throw new Error('Access denied')
    }

    // 大日志文件走 tail(1) 避免把整个文件拉进内存;tail 不可用时回退到全文读取
    const tailLines = tailFile(logPath, maxLines)
    const levelUpper = (level || '').toUpperCase()
    const entries = []
    for (const line of tailLines) {
      const t = line.trim()
      if (!t) continue
      const parsed = parseLogLine(t)
      if (levelUpper && levelUpper !== 'ALL') {
        if (!parsed.level || parsed.level.toUpperCase() !== levelUpper) continue
      }
      if (parsed.timestamp && parsed.level && parsed.message !== undefined) {
        entries.push({ timestamp: parsed.timestamp, level: parsed.level, message: parsed.message, raw: t })
      } else {
        entries.push({ raw: t })
      }
    }
    return entries
  },

  hermes_skills_list() {
    const skillsDir = hermesPath('skills')
    if (!fs.existsSync(skillsDir)) return []
    const categories = []
    try {
      for (const name of fs.readdirSync(skillsDir)) {
        const p = path.join(skillsDir, name)
        const stat = fs.statSync(p)
        if (stat.isDirectory()) {
          const catSkills = []
          for (const fname of fs.readdirSync(p)) {
            if (!fname.endsWith('.md')) continue
            const fpath = path.join(p, fname)
            catSkills.push({ file: fname, ...parseSkillMeta(fpath, fname), path: fpath })
          }
          if (catSkills.length) categories.push({ category: name, skills: catSkills })
        } else if (name.endsWith('.md')) {
          categories.push({ category: '_root', skills: [{ file: name, ...parseSkillMeta(p, name), path: p }] })
        }
      }
    } catch {}
    return categories
  },

  hermes_skill_detail({ filePath } = {}) {
    if (!filePath) throw new Error('filePath is required')
    const skillsDir = path.resolve(hermesPath('skills'))
    const canonical = path.resolve(filePath)
    if (!canonical.startsWith(skillsDir + path.sep) && canonical !== skillsDir) {
      throw new Error('Access denied')
    }
    return fs.readFileSync(canonical, 'utf8')
  },

  hermes_memory_read({ type } = {}) {
    const filePath = hermesPath('memories', memoryFileName(type))
    if (!fs.existsSync(filePath)) return ''
    return fs.readFileSync(filePath, 'utf8')
  },

  hermes_memory_write({ type, content } = {}) {
    const memDir = hermesPath('memories')
    fs.mkdirSync(memDir, { recursive: true })
    fs.writeFileSync(path.join(memDir, memoryFileName(type)), content || '', 'utf8')
    return 'ok'
  },
}

// Hermes 辅助:目录路径、CLI 调用、文件名映射、单文件尾部读取
function hermesPath(...segs) { return path.join(homedir(), '.hermes', ...segs) }

function memoryFileName(type) { return type === 'user' ? 'USER.md' : 'MEMORY.md' }

function runHermesSubcommand(args, action) {
  const r = spawnSync('hermes', args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`Failed to ${action}: ${r.stderr?.trim() || 'unknown error'}`)
  return r.stdout || ''
}

// 导出 Hermes sessions;filterId 命中则只返回含 messages 的详情,否则返回概要列表
function exportHermesSessions(source, filterId) {
  const args = ['sessions', 'export', '-']
  if (source) args.push('--source', source)
  const r = spawnSync('hermes', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  if (r.status !== 0) return filterId ? [] : []
  const out = []
  for (const line of (r.stdout || '').split('\n')) {
    const t = line.trim()
    if (!t) continue
    let obj
    try { obj = JSON.parse(t) } catch { continue }
    const id = obj.session_id || obj.id || ''
    if (filterId && id !== filterId) continue
    if (filterId) {
      out.push({
        id,
        title: obj.title || obj.name || '',
        source: obj.source || '',
        model: obj.model || '',
        created_at: obj.created_at || '',
        messages: (obj.messages || []).map(m => ({
          role: m.role || '',
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content || ''),
          timestamp: m.timestamp || m.created_at || '',
        })),
      })
      break
    } else {
      out.push({
        id,
        title: obj.title || obj.name || '',
        source: obj.source || '',
        model: obj.model || '',
        created_at: obj.created_at || obj.createdAt || '',
        updated_at: obj.updated_at || obj.updatedAt || '',
        message_count: obj.message_count || (obj.messages ? obj.messages.length : 0),
      })
    }
  }
  return out
}

// 单次遍历提取 skill 名(首个 "# " 标题)与描述(首个正文行,截断至 200 字符)
function parseSkillMeta(filePath, fallbackFile) {
  let name = '', description = ''
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n')
    for (const line of lines) {
      if (!name && line.startsWith('# ')) {
        name = line.slice(2).trim()
      } else if (!description && !line.startsWith('#') && line.trim().length > 10) {
        description = line.trim()
      }
      if (name && description) break
    }
  } catch {}
  if (!name) name = fallbackFile.replace(/\.md$/, '')
  if (description.length > 200) description = description.slice(0, 200) + '...'
  return { name, description }
}

// 读取文件尾部 N 行。优先用 tail(1)——大日志时避免 readFileSync 把整个文件加载进内存
function tailFile(filePath, maxLines) {
  const tail = spawnSync('tail', ['-n', String(maxLines), filePath], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (tail.status === 0 && typeof tail.stdout === 'string') {
    return tail.stdout.split('\n')
  }
  // Windows 或 tail 缺失:回退到全文读取(可能有 OOM 风险,但保持功能可用)
  const content = fs.readFileSync(filePath, 'utf8')
  return content.split('\n').slice(-maxLines)
}

// Hermes 日志行解析:尝试从 "YYYY-MM-DD HH:MM:SS LEVEL message" 或 "HH:MM:SS LEVEL message" 提取结构化字段
function parseLogLine(line) {
  const parts = line.split(/\s+/)
  if (parts.length >= 3) {
    const d = parts[0], tm = parts[1]
    if (d.length === 10 && d.includes('-') && tm.length >= 8 && tm.includes(':')) {
      return { timestamp: `${d} ${tm}`, level: parts[2], message: parts.slice(3).join(' ') }
    }
  }
  if (parts.length >= 2 && parts[0].includes(':') && parts[0].length >= 8) {
    return { timestamp: parts[0], level: parts[1], message: parts.slice(2).join(' ') }
  }
  return { timestamp: null, level: null, message: undefined }
}

// === Vite 插件 ===

// 初始化：密码检测 + 启动日志 + 定时清理
function _initApi() {
  const cfg = readPanelConfig()
  if (!cfg.accessPassword && !cfg.ignoreRisk) {
    cfg.accessPassword = '123456'
    cfg.mustChangePassword = true
    writePanelConfigFile(cfg)
    console.log('[api] ⚠️  首次启动，默认访问密码: 123456')
    console.log('[api] ⚠️  首次登录后将强制要求修改密码')
  }
  const pw = getAccessPassword()
  console.log('[api] API 已启动，OpenClaw 配置目录:', OPENCLAW_DIR)
  console.log('[api] 当前产品 profile:', PRODUCT_PROFILE_ID)
  console.log('[api] 面板运行目录:', PANEL_RUNTIME_DIR)
  console.log('[api] 平台:', isMac ? 'macOS' : process.platform)
  console.log('[api] 访问密码:', pw ? '已设置' : (cfg.ignoreRisk ? '无视风险模式（无密码）' : '未设置'))

  // 定时清理过期 session 和登录限速记录（每 10 分钟）
  setInterval(() => {
    const now = Date.now()
    for (const [token, session] of _sessions) {
      if (now > session.expires) _sessions.delete(token)
    }
    for (const [ip, record] of _loginAttempts) {
      if (record.lockedUntil && now >= record.lockedUntil) _loginAttempts.delete(ip)
    }
  }, 10 * 60 * 1000)
}

// API 中间件（dev server 和 preview server 共用）
async function _apiMiddleware(req, res, next) {
  if (!req.url?.startsWith('/__api/')) return next()

  const cmd = req.url.slice(7).split('?')[0]

  // --- 健康检查（前端用于检测后端是否在线） ---
  if (cmd === 'health') {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: true, ts: Date.now() }))
    return
  }

  // --- 认证特殊处理 ---
  if (cmd === 'auth_check') {
    const cfg = readPanelConfig()
    const pw = cfg.accessPassword || ''
    const isDefault = pw === '123456'
    const resp = {
      required: !!pw,
      authenticated: !pw || isAuthenticated(req),
      mustChangePassword: isDefault,
    }
    if (isDefault) resp.defaultPassword = '123456'
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(resp))
    return
  }

  if (cmd === 'auth_login') {
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || ''
    const rateLimitErr = checkLoginRateLimit(clientIp)
    if (rateLimitErr) {
      res.statusCode = 429
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: rateLimitErr }))
      return
    }
    const args = await readBody(req)
    const cfg = readPanelConfig()
    const pw = cfg.accessPassword || ''
    if (!pw) {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ success: true }))
      return
    }
    if (args.password !== pw) {
      recordLoginFailure(clientIp)
      res.statusCode = 401
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: '密码错误' }))
      return
    }
    clearLoginAttempts(clientIp)
    const token = crypto.randomUUID()
    _sessions.set(token, { expires: Date.now() + SESSION_TTL })
    res.setHeader('Set-Cookie', `clawpanel_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}`)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ success: true, mustChangePassword: !!cfg.mustChangePassword }))
    return
  }

  if (cmd === 'auth_change_password') {
    const args = await readBody(req)
    const cfg = readPanelConfig()
    const pw = cfg.accessPassword || ''
    if (pw && !isAuthenticated(req)) {
      res.statusCode = 401
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: '未登录' }))
      return
    }
    if (pw && args.oldPassword !== pw) {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: '当前密码错误' }))
      return
    }
    const weakErr = checkPasswordStrength(args.newPassword)
    if (weakErr) {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: weakErr }))
      return
    }
    if (args.newPassword === pw) {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: '新密码不能与旧密码相同' }))
      return
    }
    cfg.accessPassword = args.newPassword
    delete cfg.mustChangePassword
    delete cfg.ignoreRisk
    writePanelConfigFile(cfg)
    _sessions.clear()
    const token = crypto.randomUUID()
    _sessions.set(token, { expires: Date.now() + SESSION_TTL })
    res.setHeader('Set-Cookie', `clawpanel_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}`)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ success: true }))
    return
  }

  if (cmd === 'auth_status') {
    const cfg = readPanelConfig()
    if (cfg.accessPassword && !isAuthenticated(req)) {
      res.statusCode = 401
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: '未登录' }))
      return
    }
    const isDefault = cfg.accessPassword === '123456'
    const result = {
      hasPassword: !!cfg.accessPassword,
      mustChangePassword: isDefault,
      ignoreRisk: !!cfg.ignoreRisk,
    }
    if (isDefault) {
      result.defaultPassword = '123456'
    }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(result))
    return
  }

  if (cmd === 'auth_ignore_risk') {
    if (!isAuthenticated(req)) {
      res.statusCode = 401
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: '未登录' }))
      return
    }
    const args = await readBody(req)
    const cfg = readPanelConfig()
    if (args.enable) {
      delete cfg.accessPassword
      delete cfg.mustChangePassword
      cfg.ignoreRisk = true
      _sessions.clear()
    } else {
      delete cfg.ignoreRisk
    }
    writePanelConfigFile(cfg)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ success: true }))
    return
  }

  if (cmd === 'auth_logout') {
    const cookies = parseCookies(req)
    if (cookies.clawpanel_session) _sessions.delete(cookies.clawpanel_session)
    res.setHeader('Set-Cookie', 'clawpanel_session=; Path=/; HttpOnly; Max-Age=0')
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ success: true }))
    return
  }

  // --- 认证中间件：非豁免接口必须校验 ---
  if (!isAuthenticated(req)) {
    res.statusCode = 401
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: '未登录', code: 'AUTH_REQUIRED' }))
    return
  }

  // --- 实例代理：非 ALWAYS_LOCAL 命令，活跃实例非本机时代理转发 ---
  const activeInst = getActiveInstance()
  if (activeInst.type !== 'local' && activeInst.endpoint && !ALWAYS_LOCAL.has(cmd)) {
    try {
      const args = await readBody(req)
      const result = await proxyToInstance(activeInst, cmd, args)
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(result))
    } catch (e) {
      res.statusCode = 502
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: `实例「${activeInst.name}」不可达: ${e.message}` }))
    }
    return
  }

  const handler = handlers[cmd]

  if (!handler) {
    res.statusCode = 404
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: `未实现的命令: ${cmd}` }))
    return
  }

  try {
    const contentType = req.headers['content-type'] || ''
    const args = contentType.includes('multipart/form-data')
      ? await readMultipartForm(req).then(({ fields, file }) => ({ ...fields, file }))
      : await readBody(req)
    const result = await handler(args)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(result))
  } catch (e) {
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: e.message || String(e) }))
  }
}

// 导出供 serve.js 独立部署使用
export { _initApi, _apiMiddleware }

export function devApiPlugin() {
  let _inited = false
  function ensureInit() {
    if (_inited) return
    _inited = true
    _initApi()
  }
  return {
    name: 'privix-community-dev-api',
    configureServer(server) {
      ensureInit()
      server.middlewares.use(_apiMiddleware)
    },
    configurePreviewServer(server) {
      ensureInit()
      server.middlewares.use(_apiMiddleware)
    },
  }
}
