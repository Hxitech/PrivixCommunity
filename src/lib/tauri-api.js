/**
 * Tauri API 封装层
 * Tauri 环境用 invoke，Web 模式走 dev-api 后端
 */
// 社区版:无本地投资存储,无 active profile id


const isTauri = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__

// 仅在 Node.js 后端实现的命令（Tauri Rust 不处理），强制走 webInvoke
const WEB_ONLY_CMDS = new Set([
  'instance_list', 'instance_add', 'instance_remove', 'instance_set_active',
  'instance_health_check', 'instance_health_all',
  'get_deploy_mode',
])

// 预加载 Tauri invoke，避免每次 API 调用都做动态 import
const _invokeReady = isTauri
  ? import('@tauri-apps/api/core').then(m => m.invoke)
  : null

// 简单缓存：避免页面切换时重复请求后端
const _cache = new Map()
const CACHE_TTL = 15000 // 15秒

// 网络请求日志（用于调试）
const _requestLogs = []
const MAX_LOGS = 100

function logRequest(cmd, args, duration, cached = false) {
  const log = {
    timestamp: Date.now(),
    time: new Date().toLocaleTimeString('zh-CN', { hour12: false, fractionalSecondDigits: 3 }),
    cmd,
    args: JSON.stringify(args),
    duration: duration ? `${duration}ms` : '-',
    cached
  }
  _requestLogs.push(log)
  if (_requestLogs.length > MAX_LOGS) {
    _requestLogs.shift()
  }
}

// 导出日志供调试页面使用
export function getRequestLogs() {
  return _requestLogs.slice()
}

export function clearRequestLogs() {
  _requestLogs.length = 0
}

function extractErrorMessage(error) {
  if (error == null) return ''
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message || String(error)
  if (typeof error === 'object') {
    if (typeof error.message === 'string') return error.message
    if (typeof error.error === 'string') return error.error
    try {
      return JSON.stringify(error)
    } catch {
      // ignore serialization errors
    }
  }
  return String(error)
}

export function classifyBackendError(error) {
  const message = extractErrorMessage(error).trim()
  const normalized = message.toLowerCase()

  if (!message) {
    return { kind: 'unknown', message: '', debugReason: '' }
  }

  if (/^command .+ not found$/i.test(message) || /未实现的命令[:：]/.test(message)) {
    return {
      kind: 'unsupported_runtime',
      message: '当前运行环境不支持所需命令',
      debugReason: message,
    }
  }

  if (
    /后端服务未运行/.test(message)
    || /需要web部署模式/i.test(normalized)
    || /未登录/.test(message)
    || /需要登录/.test(message)
    || /auth_required/i.test(normalized)
    || /不可达/.test(message)
    || /networkerror/i.test(normalized)
    || /failed to fetch/.test(normalized)
    || /fetch failed/.test(normalized)
    || /timed out/.test(normalized)
    || /timeout/.test(normalized)
    || /econnrefused|econnreset|enotfound|502|503|504/.test(normalized)
    || /connection refused|connection reset|connection closed/.test(normalized)
  ) {
    return {
      kind: 'backend_unavailable',
      message: '当前后端或实例暂不可用',
      debugReason: message,
    }
  }

  return {
    kind: 'unknown',
    message,
    debugReason: message,
  }
}

function cachedInvoke(cmd, args = {}, ttl = CACHE_TTL) {
  const key = cmd + JSON.stringify(args)
  const cached = _cache.get(key)
  if (cached && Date.now() - cached.ts < ttl) {
    logRequest(cmd, args, 0, true)
    return Promise.resolve(cached.val)
  }
  return invoke(cmd, args).then(val => {
    _cache.set(key, { val, ts: Date.now() })
    return val
  })
}

// 清除指定命令的缓存（写操作后调用）;无参时清空整个 cache(引擎切换等场景)
function invalidate(...cmds) {
  if (cmds.length === 0) {
    _cache.clear()
    return
  }
  for (const [k] of _cache) {
    if (cmds.some(c => k.startsWith(c))) _cache.delete(k)
  }
}

// 导出 invalidate 供外部使用
export { invalidate }

async function invoke(cmd, args = {}) {
  const start = Date.now()
  if (_invokeReady && !WEB_ONLY_CMDS.has(cmd)) {
    const tauriInvoke = await _invokeReady
    const result = await tauriInvoke(cmd, args)
    const duration = Date.now() - start
    logRequest(cmd, args, duration, false)
    return result
  }
  // Web 模式：调用 dev-api 后端（真实数据）
  const result = await webInvoke(cmd, args)
  const duration = Date.now() - start
  logRequest(cmd, args, duration, false)
  return result
}

// Web 模式：通过 Vite 开发服务器的 API 端点调用真实后端
async function webInvoke(cmd, args) {
  const isLongCmd = false
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), isLongCmd ? 180000 : 60000)
  let resp
  try {
    resp = await fetch(`/__api/${cmd}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      signal: controller.signal,
    })
  } catch (e) {
    clearTimeout(timeout)
    if (e.name === 'AbortError') throw new Error(isLongCmd ? '请求超时 (180s)' : '请求超时 (60s)')
    throw e
  }
  clearTimeout(timeout)
  if (resp.status === 401) {
    // Tauri 模式下不触发登录浮层（Tauri 有自己的认证流程）
    if (!isTauri && window.__privix_community_show_login) window.__privix_community_show_login()
    throw new Error('需要登录')
  }
  // 检测后端是否可用：如果返回的是 HTML（非 JSON），说明后端未运行
  const ct = (resp.headers.get('content-type') || '').toLowerCase()
  if (ct.includes('text/html') || ct.includes('text/plain')) {
    throw new Error('后端服务未运行，该功能需要 Web 部署模式')
  }
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }))
    throw new Error(data.error || `HTTP ${resp.status}`)
  }
  return resp.json()
}

async function webUpload(cmd, formData) {
  const resp = await fetch(`/__api/${cmd}`, {
    method: 'POST',
    body: formData,
  })
  if (resp.status === 401) {
    if (!isTauri && window.__privix_community_show_login) window.__privix_community_show_login()
    throw new Error('需要登录')
  }
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }))
    throw new Error(data.error || `HTTP ${resp.status}`)
  }
  return resp.json()
}

// 后端连接状态
let _backendOnline = null // null=未检测, true=在线, false=离线
const _backendListeners = []

export function onBackendStatusChange(fn) {
  _backendListeners.push(fn)
  return () => { const i = _backendListeners.indexOf(fn); if (i >= 0) _backendListeners.splice(i, 1) }
}

export function isBackendOnline() { return _backendOnline }

function _setBackendOnline(v) {
  if (_backendOnline !== v) {
    _backendOnline = v
    _backendListeners.forEach(fn => { try { fn(v) } catch {} })
  }
}

// 后端健康检查
export async function checkBackendHealth() {
  if (isTauri) { _setBackendOnline(true); return true }
  try {
    const resp = await fetch('/__api/health', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const ok = resp.ok
    _setBackendOnline(ok)
    return ok
  } catch {
    _setBackendOnline(false)
    return false
  }
}

// 导出 API
export const api = {
  // 服务管理（状态用短缓存，操作不缓存）
  getServicesStatus: () => cachedInvoke('get_services_status', {}, 3000),
  startService: (label) => { invalidate('get_services_status'); return invoke('start_service', { label }) },
  stopService: (label) => { invalidate('get_services_status'); return invoke('stop_service', { label }) },
  restartService: (label) => { invalidate('get_services_status'); return invoke('restart_service', { label }) },
  claimGateway: () => { invalidate('get_services_status'); return invoke('claim_gateway') },
  probeGatewayPort: () => invoke('probe_gateway_port'),
  diagnoseGatewayConnection: () => invoke('diagnose_gateway_connection'),
  guardianStatus: () => invoke('guardian_status'),
  resetGuardian: () => invoke('reset_guardian'),

  // 配置（读缓存，写清缓存）
  getVersionInfo: () => cachedInvoke('get_version_info', {}, 30000),
  getStatusSummary: () => cachedInvoke('get_status_summary', {}, 5000),
  readOpenclawConfig: () => cachedInvoke('read_openclaw_config'),
  writeOpenclawConfig: (config) => { invalidate('read_openclaw_config'); return invoke('write_openclaw_config', { config }) },
  readMcpConfig: () => cachedInvoke('read_mcp_config'),
  writeMcpConfig: (config) => { invalidate('read_mcp_config'); return invoke('write_mcp_config', { config }) },
  reloadGateway: () => invoke('reload_gateway'),
  restartGateway: () => invoke('restart_gateway'),
  listOpenclawVersions: (source = 'chinese') => invoke('list_openclaw_versions', { source }),
  upgradeOpenclaw: (source = 'chinese', version = null, method = 'auto') => invoke('upgrade_openclaw', { source, version, method }),
  uninstallOpenclaw: (cleanConfig = false) => invoke('uninstall_openclaw', { cleanConfig }),
  installGateway: () => invoke('install_gateway'),
  uninstallGateway: () => invoke('uninstall_gateway'),
  getNpmRegistry: () => cachedInvoke('get_npm_registry', {}, 30000),
  setNpmRegistry: (registry) => { invalidate('get_npm_registry'); return invoke('set_npm_registry', { registry }) },
  testModel: (baseUrl, apiKey, modelId, apiType = null) => invoke('test_model', { baseUrl, apiKey, modelId, apiType }),
  listRemoteModels: (baseUrl, apiKey, apiType = null) => invoke('list_remote_models', { baseUrl, apiKey, apiType }),

  // Agent 管理
  listAgents: () => cachedInvoke('list_agents'),
  addAgent: (name, model, workspace) => { invalidate('list_agents'); return invoke('add_agent', { name, model, workspace: workspace || null }) },
  deleteAgent: (id) => { invalidate('list_agents'); return invoke('delete_agent', { id }) },
  updateAgentIdentity: (id, name, emoji) => { invalidate('list_agents'); return invoke('update_agent_identity', { id, name, emoji }) },
  updateAgentModel: (id, model) => { invalidate('list_agents'); return invoke('update_agent_model', { id, model }) },
  backupAgent: (id) => invoke('backup_agent', { id }),
  previewAgentWorkspaceGeneration: (payload) => invoke('preview_agent_workspace_generation', { payload }),
  applyAgentWorkspaceGeneration: (payload) => { invalidate('list_agents', 'list_memory_files', 'read_memory_file'); return invoke('apply_agent_workspace_generation', { payload }) },
  // CLI Agent 自动检测(Agent Studio)—— 扫描本机安装的 Claude/Codex/Qwen/Gemini 等 CLI
  detectAgents: () => cachedInvoke('detect_agents', {}, 300000),  // 5 分钟缓存,CLI 安装变化频率低;"重新扫描"按钮会 invalidate
  // 用户自定义 CSS 主题(Agent Studio)—— 读写 ~/.privix/user.css
  readUserCss: () => cachedInvoke('read_user_css', {}, 5000),
  writeUserCss: (content) => { invalidate('read_user_css'); return invoke('write_user_css', { content }) },
  getUserCssPath: () => cachedInvoke('get_user_css_path', {}, 60000),

  // 日志（短缓存）
  readLogTail: (logName, lines = 100) => cachedInvoke('read_log_tail', { logName, lines }, 5000),
  searchLog: (logName, query, maxResults = 50) => invoke('search_log', { logName, query, maxResults }),

  // 记忆文件
  listMemoryFiles: (category, agentId) => cachedInvoke('list_memory_files', { category, agentId: agentId || null }),
  readMemoryFile: (path, agentId) => cachedInvoke('read_memory_file', { path, agentId: agentId || null }, 5000),
  writeMemoryFile: (path, content, category, agentId) => { invalidate('list_memory_files', 'read_memory_file'); return invoke('write_memory_file', { path, content, category: category || 'memory', agentId: agentId || null }) },
  deleteMemoryFile: (path, agentId) => { invalidate('list_memory_files'); return invoke('delete_memory_file', { path, agentId: agentId || null }) },
  exportMemoryZip: (category, agentId) => invoke('export_memory_zip', { category, agentId: agentId || null }),

  // 消息渠道管理
  readPlatformConfig: (platform, accountId = null) => invoke('read_platform_config', { platform, accountId }),
  saveMessagingPlatform: (platform, form, accountId = null, agentId = null, originalAccountId = null) => { invalidate('list_configured_platforms', 'read_platform_config', 'list_all_bindings', 'read_openclaw_config'); return invoke('save_messaging_platform', { platform, form, accountId, agentId, originalAccountId }) },
  removeMessagingPlatform: (platform, accountId = null) => { invalidate('list_configured_platforms', 'read_platform_config', 'list_all_bindings', 'read_openclaw_config'); return invoke('remove_messaging_platform', { platform, accountId }) },
  toggleMessagingPlatform: (platform, enabled) => { invalidate('list_configured_platforms', 'read_openclaw_config', 'read_platform_config'); return invoke('toggle_messaging_platform', { platform, enabled }) },
  verifyBotToken: (platform, form) => invoke('verify_bot_token', { platform, form }),
  diagnoseChannel: (platform, accountId = null) => invoke('diagnose_channel', { platform, accountId }),
  repairQqbotChannelSetup: () => { invalidate('list_configured_platforms', 'read_platform_config', 'list_all_bindings', 'read_openclaw_config'); return invoke('repair_qqbot_channel_setup') },
  calibrateOpenclawConfig: (mode = 'inherit') => { invalidate('read_openclaw_config'); return invoke('calibrate_openclaw_config', { mode }) },
  listConfiguredPlatforms: () => cachedInvoke('list_configured_platforms', {}, 5000),
  getChannelPluginStatus: (pluginId) => invoke('get_channel_plugin_status', { pluginId }),
  listAllPlugins: () => cachedInvoke('list_all_plugins', {}, 5000),
  togglePlugin: (pluginId, enabled) => { invalidate('list_all_plugins'); return invoke('toggle_plugin', { pluginId, enabled }) },
  installPlugin: (packageName) => { invalidate('list_all_plugins'); return invoke('install_plugin', { packageName }) },
  installQqbotPlugin: () => invoke('install_qqbot_plugin'),
  installChannelPlugin: (packageName, pluginId) => invoke('install_channel_plugin', { packageName, pluginId }),
  checkWeixinPluginStatus: () => invoke('check_weixin_plugin_status'),
  checkPluginVersionStatus: (pluginId, npmPackage) => invoke('check_plugin_version_status', { pluginId, npmPackage }),
  runChannelAction: (platform, action) => invoke('run_channel_action', { platform, action }),
  listAllBindings: () => cachedInvoke('list_all_bindings', {}, 5000),
  saveAgentBinding: (agentId, channel, accountId = null, bindingConfig = {}) => { invalidate('list_all_bindings', 'read_openclaw_config'); return invoke('save_agent_binding', { agentId, channel, accountId, bindingConfig }) },
  deleteAgentBinding: (agentId, channel, accountId = null) => { invalidate('list_all_bindings', 'read_openclaw_config'); return invoke('delete_agent_binding', { agentId, channel, accountId }) },

  // 面板配置 (panel config)
  readPanelConfig: () => invoke('read_panel_config'),
  writePanelConfig: (config) => invoke('write_panel_config', { config }),
  readSwarmSessions: () => invoke('read_swarm_sessions'),
  writeSwarmSessions: (data) => invoke('write_swarm_sessions', { data }),
  getOpenclawDir: () => invoke('get_openclaw_dir'),
  doctorCheck: () => invoke('doctor_check'),
  doctorFix: () => invoke('doctor_fix'),
  testProxy: (url) => invoke('test_proxy', { url: url || null }),

  // 安装/部署
  checkInstallation: () => cachedInvoke('check_installation', {}, 60000),
  initOpenclawConfig: () => { invalidate('check_installation'); return invoke('init_openclaw_config') },
  checkNode: () => cachedInvoke('check_node', {}, 60000),
  checkNodeAtPath: (nodeDir) => invoke('check_node_at_path', { nodeDir }),
  scanNodePaths: () => invoke('scan_node_paths'),
  saveCustomNodePath: (nodeDir) => invoke('save_custom_node_path', { nodeDir }).then(r => { invalidate('check_node', 'get_services_status'); invoke('invalidate_path_cache').catch(() => {}); return r }),
  invalidatePathCache: () => invoke('invalidate_path_cache'),
  checkGit: () => cachedInvoke('check_git', {}, 60000),
  scanGitPaths: () => invoke('scan_git_paths'),
  autoInstallGit: () => invoke('auto_install_git'),
  configureGitHttps: () => invoke('configure_git_https'),
  getDeployConfig: () => cachedInvoke('get_deploy_config'),
  patchModelVision: () => invoke('patch_model_vision'),
  checkPanelUpdate: () => invoke('check_panel_update'),
  writeEnvFile: (path, config) => invoke('write_env_file', { path, config }),

  // 备份管理
  listBackups: () => cachedInvoke('list_backups'),
  createBackup: () => { invalidate('list_backups'); return invoke('create_backup') },
  restoreBackup: (name) => invoke('restore_backup', { name }),
  deleteBackup: (name) => { invalidate('list_backups'); return invoke('delete_backup', { name }) },

  // 设备密钥 + Gateway 握手
  createConnectFrame: (nonce, gatewayToken) => invoke('create_connect_frame', { nonce, gatewayToken }),

  // License 激活 — 社区版移除

  // 设备配对
  autoPairDevice: () => invoke('auto_pair_device'),
  checkPairingStatus: () => invoke('check_pairing_status'),
  pairingListChannel: (channel) => invoke('pairing_list_channel', { channel }),
  pairingApproveChannel: (channel, code, notify = false) => invoke('pairing_approve_channel', { channel, code, notify }),

  // AI 助手工具
  assistantExec: (command, cwd) => invoke('assistant_exec', { command, cwd: cwd || null }),
  assistantReadFile: (path) => invoke('assistant_read_file', { path }),
  assistantWriteFile: (path, content) => invoke('assistant_write_file', { path, content }),
  assistantListDir: (path) => invoke('assistant_list_dir', { path }),
  assistantSystemInfo: () => invoke('assistant_system_info'),
  assistantListProcesses: (filter) => invoke('assistant_list_processes', { filter: filter || null }),
  assistantCheckPort: (port) => invoke('assistant_check_port', { port }),
  assistantWebSearch: (query, maxResults) => invoke('assistant_web_search', { query, max_results: maxResults || 5 }),
  assistantFetchUrl: (url) => invoke('assistant_fetch_url', { url }),

  // ClawSwarm — 社区版移除

  // 文件夹选择对话框（Tauri 原生）
  pickFolder: async (title) => {
    if (!isTauri) return null
    const { open } = await import('@tauri-apps/plugin-dialog')
    return open({ directory: true, multiple: false, title: title || '选择文件夹' })
  },

  // Skills 管理（纯本地扫描 + SkillHub SDK）
  skillsList: (agentId) => invoke('skills_list', { agent_id: agentId || null }),
  skillsInfo: (name, agentId) => invoke('skills_info', { name, agent_id: agentId || null }),
  skillsCheck: () => invoke('skills_check'),
  skillsInstallDep: (kind, spec) => invoke('skills_install_dep', { kind, spec }),
  skillsUninstall: (name, agentId) => invoke('skills_uninstall', { name, agent_id: agentId || null }),
  skillsValidate: (name) => invoke('skills_validate', { name }),
  skillhubSearch: (query, limit) => invoke('skillhub_search', { query, limit: limit || 20 }),
  skillhubIndex: () => invoke('skillhub_index'),
  skillhubInstall: (slug, agentId) => invoke('skillhub_install', { slug, agent_id: agentId || null }),

  // 实例管理
  instanceList: () => cachedInvoke('instance_list', {}, 10000),
  instanceAdd: (instance) => { invalidate('instance_list'); return invoke('instance_add', instance) },
  instanceRemove: (id) => { invalidate('instance_list'); return invoke('instance_remove', { id }) },
  instanceSetActive: (id) => { invalidate('instance_list', 'read_openclaw_config', 'read_mcp_config', 'get_services_status', 'read_panel_config', 'check_installation', 'get_version_info', 'get_status_summary', 'list_configured_platforms', 'list_agents', 'list_all_bindings', 'list_all_plugins'); return invoke('instance_set_active', { id }) },
  instanceHealthCheck: (id) => invoke('instance_health_check', { id }),
  instanceHealthAll: () => invoke('instance_health_all'),


  // 前端热更新 — 社区版移除

  // 数据目录 & 图片存储
  ensureDataDir: () => invoke('assistant_ensure_data_dir'),
  saveImage: (id, data) => invoke('assistant_save_image', { id, data }),
  loadImage: (id) => invoke('assistant_load_image', { id }),
  deleteImage: (id) => invoke('assistant_delete_image', { id }),

  // === 知识库管理 ===
  kbListLibraries: () => invoke('kb_list_libraries'),
  kbCreateLibrary: (name, desc) => invoke('kb_create_library', { name, desc }),
  kbDeleteLibrary: (id) => invoke('kb_delete_library', { id }),
  kbUpdateLibrary: (id, name, desc, enabled) => invoke('kb_update_library', { id, name, desc, enabled }),
  kbListFiles: (kbId) => invoke('kb_list_files', { kbId }),
  kbAddText: (kbId, name, content) => invoke('kb_add_text', { kbId, name, content }),
  kbAddFile: (kbId, sourcePath) => invoke('kb_add_file', { kbId, sourcePath }),
  kbReadFile: (kbId, fileName) => invoke('kb_read_file', { kbId, fileName }),
  kbDeleteFile: (kbId, fileName) => invoke('kb_delete_file', { kbId, fileName }),
  kbSyncToAgent: (kbId, agentId) => invoke('kb_sync_to_agent', { kbId, agentId }),
  kbCheckExtractTools: () => invoke('kb_check_extract_tools'),

  // === KB Wiki (Karpathy 式 LLM 维护知识库) ===
  kbWikiDirPath: (kbId) => invoke('kb_wiki_dir_path', { kbId }),
  kbWikiInit: (kbId) => invoke('kb_wiki_init', { kbId }),
  kbWikiTree: (kbId) => invoke('kb_wiki_tree', { kbId }),
  kbWikiRead: (kbId, relPath) => invoke('kb_wiki_read', { kbId, relPath }),
  kbWikiWrite: (kbId, relPath, content, append = false) => invoke('kb_wiki_write', { kbId, relPath, content, append }),
  kbWikiAppendLog: (kbId, kind, title, refs) => invoke('kb_wiki_append_log', { kbId, kind, title, refs: refs || null }),
  kbWikiProposeIngest: (kbId, sourceRelPath) => invoke('kb_wiki_propose_ingest', { kbId, sourceRelPath }),
  kbWikiLint: (kbId) => invoke('kb_wiki_lint', { kbId }),
  kbWikiExportObsidian: (kbId, destDir, dryRun = false) => invoke('kb_wiki_export_obsidian', { kbId, destDir, dryRun }),

  // === Hermes Agent 管理 ===
  checkPython: () => cachedInvoke('check_python', {}, 60000),
  checkHermes: () => cachedInvoke('check_hermes', {}, 30000),
  installHermes: (method = 'uv-tool', extras = []) => invoke('install_hermes', { method, extras }),
  configureHermes: (provider, apiKey, model, baseUrl) => invoke('configure_hermes', { provider, apiKey, model: model || null, baseUrl: baseUrl || null }),
  hermesGatewayAction: (action) => invoke('hermes_gateway_action', { action }),
  hermesHealthCheck: () => invoke('hermes_health_check'),
  hermesApiProxy: ({ method, path, body, headers } = {}) => invoke('hermes_api_proxy', { method, path, body: body || null, headers: headers || null }),
  hermesAgentRun: ({ input, sessionId, conversationHistory, instructions } = {}) => invoke('hermes_agent_run', { input, sessionId: sessionId || null, conversationHistory: conversationHistory || null, instructions: instructions || null }),
  hermesReadConfig: () => invoke('hermes_read_config'),
  hermesFetchModels: ({ baseUrl, apiKey, apiType } = {}) => invoke('hermes_fetch_models', { baseUrl, apiKey, apiType: apiType || null }),
  hermesUpdateModel: (model) => invoke('hermes_update_model', { model }),
  hermesDetectEnvironments: () => invoke('hermes_detect_environments'),
  hermesSetGatewayUrl: (url) => invoke('hermes_set_gateway_url', { url: url || null }),
  updateHermes: () => invoke('update_hermes'),
  uninstallHermes: (cleanConfig = false) => invoke('uninstall_hermes', { cleanConfig }),
  // Hermes Sessions / Logs / Skills / Memory
  hermesSessionsList: (source, limit) => invoke('hermes_sessions_list', { source: source || null, limit: limit || null }),
  hermesSessionDetail: (sessionId) => invoke('hermes_session_detail', { sessionId }),
  hermesSessionDelete: (sessionId) => invoke('hermes_session_delete', { sessionId }),
  hermesSessionRename: (sessionId, title) => invoke('hermes_session_rename', { sessionId, title }),
  hermesLogsList: () => invoke('hermes_logs_list'),
  hermesLogsRead: (name, lines, level) => invoke('hermes_logs_read', { name, lines: lines || 200, level: level || null }),
  hermesSkillsList: () => invoke('hermes_skills_list'),
  hermesSkillDetail: (filePath) => invoke('hermes_skill_detail', { filePath }),
  hermesMemoryRead: (type) => invoke('hermes_memory_read', { type: type || 'memory' }),
  hermesMemoryWrite: (type, content) => invoke('hermes_memory_write', { type: type || 'memory', content }),

  // === PE/VC 投资管理相关 API — 社区版全部移除 ===
}
