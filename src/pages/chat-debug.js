/**
 * 系统诊断页面
 * 全面检测 Privix 各项功能状态，快速定位问题
 */
import { api, getRequestLogs, clearRequestLogs } from '../lib/tauri-api.js'
import { wsClient } from '../lib/ws-client.js'
import { isOpenclawReady, isGatewayRunning } from '../lib/app-state.js'
import { icon, statusIcon } from '../lib/icons.js'
import { t } from '../lib/i18n.js'

// Tauri 桌面端走本地 ws;Web 模式按页面 protocol 选 ws/wss(HTTPS 下必须 wss,否则 Mixed Content)
function buildGatewayWsUrl(port, token) {
  const inTauri = !!window.__TAURI_INTERNALS__
  const wsHost = inTauri ? `127.0.0.1:${port}` : location.host
  const wsScheme = !inTauri && location.protocol === 'https:' ? 'wss' : 'ws'
  return `${wsScheme}://${wsHost}/ws?token=${encodeURIComponent(token)}`
}

export async function render() {
  const page = document.createElement('div')
  page.className = 'page'

  page.innerHTML = `
    <div class="page-header">
      <h1 class="page-title apple-section">${t('pages.chat_debug.title')}</h1>
      <p class="page-desc apple-body-secondary">${t('pages.chat_debug.desc')}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-pill-filled" id="btn-refresh">${t('pages.chat_debug.btn_refresh')}</button>
        <button class="btn btn-pill-outline" id="btn-test-ws">${t('pages.chat_debug.btn_test_ws')}</button>
        <button class="btn btn-pill-outline" id="btn-network-log">${t('pages.chat_debug.btn_network_log')}</button>
        <button class="btn btn-pill-outline" id="btn-doctor-check">${t('pages.chat_debug.btn_doctor_check')}</button>
        <button class="btn btn-pill-outline" id="btn-doctor-fix">${t('pages.chat_debug.btn_doctor_fix')}</button>
        <button class="btn btn-warning btn-sm" id="btn-fix-pairing">${t('pages.chat_debug.btn_fix_pairing')}</button>
      </div>
    </div>
    <div id="debug-content"></div>
    <div id="doctor-output" style="display:none;margin-top:16px;background:var(--bg-secondary);border-radius:6px;padding:12px">
      <div style="font-weight:600;margin-bottom:8px">${t('pages.chat_debug.doctor_title')}</div>
      <pre id="doctor-output-content" style="font-size:11px;line-height:1.6;max-height:320px;overflow:auto;margin:0;color:var(--text-primary)"></pre>
    </div>
    <div id="ws-test-log" style="display:none;margin-top:16px;background:var(--bg-secondary);border-radius:6px;padding:12px">
      <div style="font-weight:600;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
        <span>${t('pages.chat_debug.ws_test_title')}</span>
        <button class="btn btn-sm" id="btn-clear-log" style="padding:4px 8px;font-size:11px">${t('pages.chat_debug.ws_test_clear')}</button>
      </div>
      <pre id="ws-log-content" style="font-size:11px;line-height:1.5;max-height:400px;overflow:auto;margin:0;color:var(--text-primary)"></pre>
    </div>
    <div id="network-log" style="display:none;margin-top:16px;background:var(--bg-secondary);border-radius:6px;padding:12px">
      <div style="font-weight:600;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
        <span>${t('pages.chat_debug.network_title')}</span>
        <div style="display:flex;gap:8px">
          <button class="btn btn-sm" id="btn-refresh-network" style="padding:4px 8px;font-size:11px">${t('pages.chat_debug.network_refresh')}</button>
          <button class="btn btn-sm" id="btn-clear-network" style="padding:4px 8px;font-size:11px">${t('pages.chat_debug.network_clear')}</button>
        </div>
      </div>
      <div id="network-log-content" style="font-size:11px;line-height:1.5;max-height:400px;overflow:auto"></div>
    </div>
  `

  page.querySelector('#btn-refresh').addEventListener('click', () => loadDebugInfo(page))
  page.querySelector('#btn-test-ws').addEventListener('click', () => testWebSocket(page))
  page.querySelector('#btn-network-log').addEventListener('click', () => toggleNetworkLog(page))
  page.querySelector('#btn-doctor-check').addEventListener('click', () => runDoctor(page, false))
  page.querySelector('#btn-doctor-fix').addEventListener('click', () => runDoctor(page, true))
  page.querySelector('#btn-fix-pairing').addEventListener('click', () => fixPairing(page))
  loadDebugInfo(page)
  return page
}

async function loadDebugInfo(page) {
  const el = page.querySelector('#debug-content')

  const info = {
    timestamp: new Date().toLocaleString('zh-CN'),
    // 应用状态
    appState: {
      openclawReady: isOpenclawReady(),
      gatewayRunning: isGatewayRunning(),
    },
    // WebSocket 状态
    wsClient: {
      connected: wsClient.connected,
      gatewayReady: wsClient.gatewayReady,
      sessionKey: wsClient.sessionKey,
    },
    // 配置文件
    config: null,
    configError: null,
    // 服务状态
    services: null,
    servicesError: null,
    // 版本信息
    version: null,
    versionError: null,
    // Node.js 环境
    node: null,
    nodeError: null,
    // 设备密钥
    connectFrame: null,
    connectFrameError: null,
    // OpenClaw 目录
    openclawDir: null,
  }

  // 并行检测所有项目
  await Promise.allSettled([
    // 配置文件
    api.readOpenclawConfig().then(r => { info.config = r }).catch(e => { info.configError = String(e) }),
    // 服务状态
    api.getServicesStatus().then(r => { info.services = r }).catch(e => { info.servicesError = String(e) }),
    // 版本信息
    api.getVersionInfo().then(r => { info.version = r }).catch(e => { info.versionError = String(e) }),
    // Node.js
    api.checkNode().then(r => { info.node = r }).catch(e => { info.nodeError = String(e) }),
    api.getOpenclawDir().then(r => { info.openclawDir = r }).catch(() => {}),
  ])

  // 设备密钥检测（需要等配置加载完成）
  try {
    const rawToken = info.config?.gateway?.auth?.token
    const token = (typeof rawToken === 'string') ? rawToken : ''
    info.connectFrame = await api.createConnectFrame('test-nonce', token)
  } catch (e) {
    info.connectFrameError = String(e)
  }

  // 移除 loading 状态并渲染结果
  renderDebugInfo(el, info)
}

function renderDebugInfo(el, info) {
  let html = `<div style="font-family:monospace;font-size:12px;line-height:1.6">`

  // 总体状态概览
  const allOk = info.appState.openclawReady && info.appState.gatewayRunning && info.wsClient.gatewayReady
  html += `<div class="config-section" style="background:${allOk ? 'var(--success-bg)' : 'var(--warning-bg)'};border-left:3px solid ${allOk ? 'var(--success)' : 'var(--warning)'}">
    <div style="font-size:16px;font-weight:600;margin-bottom:8px">${allOk ? `${statusIcon('ok')} ${t('pages.chat_debug.status_ok')}` : `${statusIcon('warn')} ${t('pages.chat_debug.status_warn')}`}</div>
    <div style="color:var(--text-secondary);font-size:13px">${allOk ? t('pages.chat_debug.status_ok_hint') : t('pages.chat_debug.status_warn_hint')}</div>
  </div>`

  // 应用状态
  html += `<div class="config-section">
    <div class="config-section-title">${t('pages.chat_debug.section_app')}</div>
    <table class="debug-table">
      <tr><td>${t('pages.chat_debug.app_openclaw_ready')}</td><td>${info.appState.openclawReady ? statusIcon('ok') : statusIcon('err')}</td></tr>
      <tr><td>${t('pages.chat_debug.app_gw_running')}</td><td>${info.appState.gatewayRunning ? statusIcon('ok') : statusIcon('err')}</td></tr>
    </table>
  </div>`

  // WebSocket 状态
  html += `<div class="config-section">
    <div class="config-section-title">${t('pages.chat_debug.section_ws')}</div>
    <table class="debug-table">
      <tr><td>${t('pages.chat_debug.ws_status')}</td><td>${info.wsClient.connected ? `${statusIcon('ok')} ${t('pages.chat_debug.ws_connected')}` : `${statusIcon('err')} ${t('pages.chat_debug.ws_disconnected')}`}</td></tr>
      <tr><td>${t('pages.chat_debug.ws_handshake')}</td><td>${info.wsClient.gatewayReady ? `${statusIcon('ok')} ${t('pages.chat_debug.ws_handshake_done')}` : `${statusIcon('err')} ${t('pages.chat_debug.ws_handshake_pending')}`}</td></tr>
      <tr><td>${t('pages.chat_debug.ws_session_key')}</td><td>${info.wsClient.sessionKey || t('pages.chat_debug.ws_empty')}</td></tr>
    </table>
  </div>`

  // Node.js 环境
  html += `<div class="config-section">
    <div class="config-section-title">${t('pages.chat_debug.section_node')}</div>`
  if (info.nodeError) {
    html += `<div style="color:var(--error)">${statusIcon('err')} ${escapeHtml(info.nodeError)}</div>`
  } else if (info.node) {
    html += `<table class="debug-table">
      <tr><td>${t('pages.chat_debug.node_installed')}</td><td>${info.node.installed ? `${statusIcon('ok')} ${t('pages.chat_debug.node_installed_yes')}` : `${statusIcon('err')} ${t('pages.chat_debug.node_installed_no')}`}</td></tr>
      <tr><td>${t('pages.chat_debug.node_version')}</td><td>${info.node.version || t('pages.chat_debug.node_version_unknown')}</td></tr>
    </table>`
  }
  html += `</div>`

  // 版本信息
  html += `<div class="config-section">
    <div class="config-section-title">${t('pages.chat_debug.section_version')}</div>`
  if (info.versionError) {
    html += `<div style="color:var(--error)">${statusIcon('err')} ${escapeHtml(info.versionError)}</div>`
  } else if (info.version) {
    html += `<table class="debug-table">
      <tr><td>${t('pages.chat_debug.ver_current')}</td><td>${info.version.current || t('pages.chat_debug.node_version_unknown')}</td></tr>
      <tr><td>${t('pages.chat_debug.ver_recommended')}</td><td>${info.version.recommended || t('pages.chat_debug.ver_recommended_none')}</td></tr>
      <tr><td>${t('pages.chat_debug.ver_panel')}</td><td>${info.version.panel_version || t('pages.chat_debug.node_version_unknown')}</td></tr>
      <tr><td>${t('pages.chat_debug.ver_latest')}</td><td>${info.version.latest || t('pages.chat_debug.ver_recommended_none')}</td></tr>
      <tr><td>${t('pages.chat_debug.ver_ahead')}</td><td>${info.version.ahead_of_recommended ? `${statusIcon('warn')} ${t('pages.chat_debug.ver_ahead_yes')}` : info.version.is_recommended ? `${statusIcon('ok')} ${t('pages.chat_debug.ver_ahead_aligned')}` : `${statusIcon('warn')} ${t('pages.chat_debug.ver_ahead_switch')}`}</td></tr>
      <tr><td>${t('pages.chat_debug.ver_latest_update')}</td><td>${info.version.latest_update_available ? `${statusIcon('warn')} ${t('pages.chat_debug.ver_latest_update_yes')}` : `${statusIcon('ok')} ${t('pages.chat_debug.ver_latest_update_no')}`}</td></tr>
    </table>`
  }
  html += `</div>`

  // 配置文件
  html += `<div class="config-section">
    <div class="config-section-title">${t('pages.chat_debug.section_config')}</div>`
  if (info.configError) {
    html += `<div style="color:var(--error)">${statusIcon('err')} ${escapeHtml(info.configError)}</div>`
  } else if (info.config) {
    const gw = info.config.gateway || {}
    html += `<table class="debug-table">
      <tr><td>${t('pages.chat_debug.config_dir')}</td><td>${escapeHtml(info.openclawDir?.path || t('pages.chat_debug.config_dir_unknown'))}</td></tr>
      <tr><td>gateway.port</td><td>${gw.port || t('pages.chat_debug.config_port_unset')}</td></tr>
      <tr><td>gateway.auth.token</td><td>${gw.auth?.token ? `${statusIcon('ok')} ${t('pages.chat_debug.config_token_set')}${typeof gw.auth.token === 'object' ? t('pages.chat_debug.config_token_secretref') : ''}` : `${statusIcon('warn')} ${t('pages.chat_debug.config_token_unset')}`}</td></tr>
      <tr><td>gateway.enabled</td><td>${gw.enabled !== false ? statusIcon('ok') : statusIcon('err')}</td></tr>
      <tr><td>gateway.mode</td><td>${gw.mode || 'local'}</td></tr>
    </table>`
  }
  html += `</div>`

  // 服务状态
  html += `<div class="config-section">
    <div class="config-section-title">${t('pages.chat_debug.section_services')}</div>`
  if (info.servicesError) {
    html += `<div style="color:var(--error)">${statusIcon('err')} ${escapeHtml(info.servicesError)}</div>`
  } else if (info.services?.length > 0) {
    const svc = info.services[0]
    html += `<table class="debug-table">
      <tr><td>${t('pages.chat_debug.svc_cli')}</td><td>${svc.cli_installed !== false ? `${statusIcon('ok')} ${t('pages.chat_debug.svc_cli_yes')}` : `${statusIcon('err')} ${t('pages.chat_debug.svc_cli_no')}`}</td></tr>
      <tr><td>${t('pages.chat_debug.svc_running')}</td><td>${svc.running ? `${statusIcon('ok')} ${t('pages.chat_debug.svc_running_yes')}` : `${statusIcon('err')} ${t('pages.chat_debug.svc_running_no')}`}</td></tr>
      <tr><td>${t('pages.chat_debug.svc_pid')}</td><td>${svc.pid || t('pages.chat_debug.svc_pid_none')}</td></tr>
      <tr><td>${t('pages.chat_debug.svc_label')}</td><td>${svc.label || t('pages.chat_debug.svc_label_unknown')}</td></tr>
    </table>`
  }
  html += `</div>`

  // 设备密钥
  html += `<div class="config-section">
    <div class="config-section-title">${t('pages.chat_debug.section_device')}</div>`
  if (info.connectFrameError) {
    html += `<div style="color:var(--error)">${statusIcon('err')} ${escapeHtml(info.connectFrameError)}</div>`
  } else if (info.connectFrame) {
    const device = info.connectFrame.params?.device
    html += `<div style="color:var(--success);margin-bottom:8px">${statusIcon('ok')} ${t('pages.chat_debug.device_ok')}</div>
    <table class="debug-table">
      <tr><td>${t('pages.chat_debug.device_id')}</td><td style="font-size:10px;word-break:break-all">${device?.id || t('pages.chat_debug.device_id_none')}</td></tr>
      <tr><td>${t('pages.chat_debug.device_pubkey')}</td><td style="font-size:10px;word-break:break-all">${device?.publicKey ? device.publicKey.substring(0, 32) + '...' : t('pages.chat_debug.device_pubkey_none')}</td></tr>
      <tr><td>${t('pages.chat_debug.device_signed_at')}</td><td>${device?.signedAt || t('pages.chat_debug.device_id_none')}</td></tr>
    </table>
    <details style="margin-top:8px">
      <summary style="cursor:pointer;color:var(--text-secondary);font-size:12px">${t('pages.chat_debug.device_view_frame')}</summary>
      <pre style="background:var(--bg-secondary);padding:8px;border-radius:4px;overflow:auto;max-height:300px;font-size:11px">${escapeHtml(JSON.stringify(info.connectFrame, null, 2))}</pre>
    </details>`
  }
  html += `</div>`

  // 诊断建议
  html += `<div class="config-section">
    <div class="config-section-title">${t('pages.chat_debug.section_advice')}</div>
    <ul style="margin:0;padding-left:20px;color:var(--text-secondary);font-size:13px">`

  if (!info.node?.installed) {
    html += `<li style="color:var(--error);margin-bottom:6px">${statusIcon('err')} ${t('pages.chat_debug.advice_no_node')}</li>`
  }
  if (info.configError) {
    html += `<li style="color:var(--error);margin-bottom:6px">${statusIcon('err')} ${t('pages.chat_debug.advice_config_err')}</li>`
  }
  if (info.servicesError || !info.services?.length || info.services[0]?.cli_installed === false) {
    html += `<li style="color:var(--error);margin-bottom:6px">${statusIcon('err')} ${t('pages.chat_debug.advice_no_cli')}</li>`
  }
  if (info.services?.length > 0 && !info.services[0]?.running) {
    html += `<li style="color:var(--warning);margin-bottom:6px">${statusIcon('warn')} ${t('pages.chat_debug.advice_gw_stopped')}</li>`
  }
  if (info.config && !info.config.gateway?.auth?.token) {
    html += `<li style="color:var(--warning);margin-bottom:6px">${statusIcon('warn')} ${t('pages.chat_debug.advice_no_token')}</li>`
  } else if (info.config && typeof info.config.gateway?.auth?.token === 'object') {
    html += `<li style="margin-bottom:6px">${statusIcon('ok')} ${t('pages.chat_debug.advice_token_secretref')}</li>`
  }
  if (info.connectFrameError) {
    html += `<li style="color:var(--error);margin-bottom:6px">${statusIcon('err')} ${t('pages.chat_debug.advice_device_fail')}</li>`
  }
  if (!info.wsClient.connected && info.services?.length > 0 && info.services[0]?.running) {
    html += `<li style="color:var(--warning);margin-bottom:6px">${statusIcon('warn')} ${t('pages.chat_debug.advice_ws_origin', { port: info.config?.gateway?.port || 18789 })}</li>`
  }
  if (info.wsClient.connected && !info.wsClient.gatewayReady) {
    html += `<li style="color:var(--warning);margin-bottom:6px">${statusIcon('warn')} ${t('pages.chat_debug.advice_ws_handshake')}</li>`
  }
  if (allOk) {
    html += `<li style="color:var(--success);margin-bottom:6px">${statusIcon('ok')} ${t('pages.chat_debug.advice_all_ok')}</li>`
  }

  html += `</ul></div>`
  html += `<div style="margin-top:16px;padding:8px;background:var(--bg-secondary);border-radius:4px;font-size:11px;color:var(--text-tertiary)">${t('pages.chat_debug.check_time', { time: info.timestamp })}</div>`
  html += `</div>`

  el.innerHTML = html
}

function escapeHtml(str) {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function runDoctor(page, fix = false) {
  const wrap = page.querySelector('#doctor-output')
  const content = page.querySelector('#doctor-output-content')
  const btn = page.querySelector(fix ? '#btn-doctor-fix' : '#btn-doctor-check')
  if (!wrap || !content || !btn) return

  wrap.style.display = 'block'
  content.textContent = fix ? t('pages.chat_debug.doctor_running_fix') : t('pages.chat_debug.doctor_running')
  btn.disabled = true
  try {
    const result = fix ? await api.doctorFix() : await api.doctorCheck()
    const lines = []
    lines.push(`success: ${result?.success ? 'true' : 'false'}`)
    if (result?.exitCode != null) lines.push(`exitCode: ${result.exitCode}`)
    if (result?.output) {
      lines.push('')
      lines.push('[stdout]')
      lines.push(result.output)
    }
    if (result?.errors) {
      lines.push('')
      lines.push('[stderr]')
      lines.push(result.errors)
    }
    content.textContent = lines.join('\n') || t('pages.chat_debug.doctor_no_output')
  } catch (e) {
    content.textContent = t('pages.chat_debug.doctor_fail', { error: String(e) })
  } finally {
    btn.disabled = false
  }
}

// WebSocket 连接测试
let testWs = null
let testLogs = []

function testWebSocket(page) {
  const logEl = page.querySelector('#ws-test-log')
  const contentEl = page.querySelector('#ws-log-content')
  const clearBtn = page.querySelector('#btn-clear-log')

  logEl.style.display = 'block'
  testLogs = []

  clearBtn.onclick = () => {
    testLogs = []
    contentEl.innerHTML = ''
  }

  addLog(`${icon('search', 14)} ${t('pages.chat_debug.ws_test_start')}`)

  // 关闭旧连接
  if (testWs) {
    testWs.close()
    testWs = null
  }

  // 读取配置
  api.readOpenclawConfig().then(config => {
    const port = config?.gateway?.port || 18789
    const rawToken = config?.gateway?.auth?.token
    const token = (typeof rawToken === 'string') ? rawToken : ''
    const url = buildGatewayWsUrl(port, token)

    addLog(`${icon('radio', 14)} 连接地址: ${url}`)
    addLog(`${icon('key', 14)} Token: ${token ? token.substring(0, 20) + '...' : t('pages.chat_debug.ws_empty')}`)
    addLog(`${icon('clock', 14)} ${t('pages.chat_debug.ws_test_connecting')}`)

    try {
      testWs = new WebSocket(url)

      testWs.onopen = () => {
        addLog(`${statusIcon('ok', 14)} ${t('pages.chat_debug.ws_test_connected')}`)
        addLog(`${icon('clock', 14)} ${t('pages.chat_debug.ws_test_wait_challenge')}`)
      }

      testWs.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data)
          addLog(`${icon('inbox', 14)} 收到消息: ${escapeHtml(JSON.stringify(msg, null, 2))}`)

          // 如果收到 challenge，尝试发送 connect frame
          if (msg.type === 'event' && msg.event === 'connect.challenge') {
            const nonce = msg.payload?.nonce || ''
            addLog(`${icon('lock', 14)} ${t('pages.chat_debug.ws_test_challenge_received', { nonce })}`)
            addLog(`${icon('clock', 14)} ${t('pages.chat_debug.ws_test_gen_frame')}`)

            api.createConnectFrame(nonce, token).then(frame => {
              addLog(`${statusIcon('ok', 14)} ${t('pages.chat_debug.ws_test_frame_ok')}`)
              addLog(`${icon('send', 14)} 发送 connect frame: ${escapeHtml(JSON.stringify(frame, null, 2))}`)
              testWs.send(JSON.stringify(frame))
            }).catch(e => {
              addLog(`${statusIcon('err', 14)} ${t('pages.chat_debug.ws_test_frame_fail', { error: String(e) })}`)
            })
          }

          // 如果收到 connect 响应
          if (msg.type === 'res' && msg.id?.startsWith('connect-')) {
            if (msg.ok) {
              addLog(`${statusIcon('ok', 14)} ${t('pages.chat_debug.ws_test_handshake_ok')}`)
              addLog(`${icon('bar-chart', 14)} Snapshot: ${escapeHtml(JSON.stringify(msg.payload, null, 2))}`)
              const sessionKey = msg.payload?.snapshot?.sessionDefaults?.mainSessionKey
              if (sessionKey) {
                addLog(`${icon('key', 14)} Session Key: ${sessionKey}`)
              }
            } else {
              addLog(`${statusIcon('err', 14)} ${t('pages.chat_debug.ws_test_handshake_fail', { error: msg.error?.message || msg.error?.code || '未知错误' })}`)
            }
          }
        } catch (e) {
          addLog(`${statusIcon('warn', 14)} ${t('pages.chat_debug.ws_test_parse_fail', { error: String(e) })}`)
          addLog(`${icon('inbox', 14)} 原始数据: ${escapeHtml(evt.data)}`)
        }
      }

      testWs.onerror = (e) => {
        addLog(`${statusIcon('err', 14)} ${t('pages.chat_debug.ws_test_ws_error', { error: e.type })}`)
      }

      testWs.onclose = (e) => {
        addLog(`${icon('plug', 14)} ${t('pages.chat_debug.ws_test_closed', { code: e.code, reason: e.reason || t('pages.chat_debug.ws_empty') })}`)
        if (e.code === 1008) {
          addLog(`${statusIcon('err', 14)} ${t('pages.chat_debug.ws_test_origin_rejected')}`)
          addLog(`${icon('lightbulb', 14)} ${t('pages.chat_debug.ws_test_origin_fix')}`)
        } else if (e.code === 4001) {
          addLog(`${statusIcon('err', 14)} ${t('pages.chat_debug.ws_test_auth_fail')}`)
        } else if (e.code === 1006) {
          addLog(`${statusIcon('warn', 14)} ${t('pages.chat_debug.ws_test_abnormal_close')}`)
        }
        testWs = null
      }

    } catch (e) {
      addLog(`${statusIcon('err', 14)} ${t('pages.chat_debug.ws_test_create_fail', { error: String(e) })}`)
    }
  }).catch(e => {
    addLog(`${statusIcon('err', 14)} ${t('pages.chat_debug.ws_test_config_fail', { error: String(e) })}`)
  })

  function addLog(msg) {
    const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    const div = document.createElement('div')
    div.style.cssText = 'display:flex;gap:4px;align-items:flex-start;padding:1px 0;white-space:pre-wrap;word-break:break-all'
    div.innerHTML = `<span style="color:var(--text-tertiary);flex-shrink:0">[${timestamp}]</span> ${msg}`
    testLogs.push(div.textContent)
    contentEl.appendChild(div)
    contentEl.scrollTop = contentEl.scrollHeight
  }
}

// 网络日志功能
function toggleNetworkLog(page) {
  const logEl = page.querySelector('#network-log')
  const contentEl = page.querySelector('#network-log-content')
  const refreshBtn = page.querySelector('#btn-refresh-network')
  const clearBtn = page.querySelector('#btn-clear-network')

  if (logEl.style.display === 'none') {
    logEl.style.display = 'block'
    renderNetworkLog(contentEl)
  } else {
    logEl.style.display = 'none'
  }

  refreshBtn.onclick = () => renderNetworkLog(contentEl)
  clearBtn.onclick = () => {
    clearRequestLogs()
    renderNetworkLog(contentEl)
  }
}

function renderNetworkLog(contentEl) {
  const logs = getRequestLogs()

  if (logs.length === 0) {
    contentEl.innerHTML = `<div style="color:var(--text-secondary);padding:8px">${t('pages.chat_debug.network_empty')}</div>`
    return
  }

  // 统计信息
  const total = logs.length
  const cached = logs.filter(l => l.cached).length
  const avgDuration = logs.filter(l => !l.cached).reduce((sum, l) => {
    const ms = parseInt(l.duration)
    return sum + (isNaN(ms) ? 0 : ms)
  }, 0) / (total - cached || 1)

  let html = `
    <div style="padding:8px;background:var(--bg-primary);border-radius:4px;margin-bottom:8px;font-size:12px">
      <div style="display:flex;gap:16px">
        <span>${t('pages.chat_debug.network_total', { n: total })}</span>
        <span>${t('pages.chat_debug.network_cached', { n: cached })}</span>
        <span>${t('pages.chat_debug.network_avg_time', { n: avgDuration.toFixed(0) })}</span>
      </div>
    </div>
    <table class="debug-table" style="width:100%;font-size:11px">
      <thead>
        <tr style="background:var(--bg-primary)">
          <th style="padding:6px;text-align:left;width:80px">${t('pages.chat_debug.network_col_time')}</th>
          <th style="padding:6px;text-align:left">${t('pages.chat_debug.network_col_cmd')}</th>
          <th style="padding:6px;text-align:left;max-width:200px">${t('pages.chat_debug.network_col_args')}</th>
          <th style="padding:6px;text-align:right;width:80px">${t('pages.chat_debug.network_col_duration')}</th>
          <th style="padding:6px;text-align:center;width:60px">${t('pages.chat_debug.network_col_cache')}</th>
        </tr>
      </thead>
      <tbody>
  `

  // 倒序显示（最新的在上面）
  for (let i = logs.length - 1; i >= 0; i--) {
    const log = logs[i]
    const cachedIcon = log.cached ? statusIcon('ok', 12) : '-'
    const durationColor = log.cached ? 'var(--text-tertiary)' :
                          (parseInt(log.duration) > 1000 ? 'var(--error)' :
                          (parseInt(log.duration) > 500 ? 'var(--warning)' : 'var(--text-primary)'))

    html += `
      <tr>
        <td style="padding:4px;color:var(--text-tertiary)">${log.time}</td>
        <td style="padding:4px;font-family:monospace">${escapeHtml(log.cmd)}</td>
        <td style="padding:4px;font-family:monospace;font-size:10px;color:var(--text-secondary);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(log.args)}">${escapeHtml(log.args)}</td>
        <td style="padding:4px;text-align:right;color:${durationColor}">${log.duration}</td>
        <td style="padding:4px;text-align:center">${cachedIcon}</td>
      </tr>
    `
  }

  html += `</tbody></table>`
  contentEl.innerHTML = html
}

// 一键修复配对问题
async function fixPairing(page) {
  const logEl = page.querySelector('#ws-test-log')
  const contentEl = page.querySelector('#ws-log-content')
  const fixBtn = page.querySelector('#btn-fix-pairing')

  if (fixBtn) { fixBtn.disabled = true; fixBtn.textContent = '修复中...' }
  logEl.style.display = 'block'
  testLogs = []
  logEl.scrollIntoView({ behavior: 'smooth', block: 'start' })

  function addLog(msg) {
    const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    const line = `[${timestamp}] ${msg}`
    testLogs.push(line)
    contentEl.textContent = testLogs.join('\n')
    contentEl.scrollTop = contentEl.scrollHeight
  }

  try {
    addLog(`${icon('wrench', 14)} ${t('pages.chat_debug.fix_start')}`)

    // 1. 写入 paired.json + controlUi.allowedOrigins
    addLog(`${icon('edit', 14)} ${t('pages.chat_debug.fix_writing')}`)
    const result = await api.autoPairDevice()
    addLog(`${statusIcon('ok', 14)} ${result}`)
    addLog(`${statusIcon('ok', 14)} ${t('pages.chat_debug.fix_origin_ok')}`)

    // 2. 停止 Gateway（确保旧进程完全退出，新进程能重新读取配置）
    addLog(`${icon('zap', 14)} ${t('pages.chat_debug.fix_stop_gw')}`)
    try { await api.stopService('ai.openclaw.gateway') } catch {}
    addLog(`${icon('clock', 14)} ${t('pages.chat_debug.fix_wait_exit')}`)
    await new Promise(resolve => setTimeout(resolve, 3000))

    // 3. 启动 Gateway（重新加载 openclaw.json 配置）
    addLog(`${icon('zap', 14)} ${t('pages.chat_debug.fix_start_gw')}`)
    await api.startService('ai.openclaw.gateway')
    addLog(`${statusIcon('ok', 14)} ${t('pages.chat_debug.fix_start_gw_ok')}`)

    // 4. 等待 Gateway 就绪
    addLog(`${icon('clock', 14)} ${t('pages.chat_debug.fix_wait_ready')}`)
    await new Promise(resolve => setTimeout(resolve, 5000))

    // 5. 检查 Gateway 状态
    addLog(`${icon('search', 14)} ${t('pages.chat_debug.fix_check_gw')}`)
    const services = await api.getServicesStatus()
    const running = services?.[0]?.running

    if (running) {
      addLog(`${statusIcon('ok', 14)} ${t('pages.chat_debug.fix_gw_running')}`)
    } else {
      addLog(`${statusIcon('warn', 14)} ${t('pages.chat_debug.fix_gw_starting')}`)
    }

    // 6. 测试 WebSocket 连接
    addLog(`${icon('plug', 14)} ${t('pages.chat_debug.fix_test_ws')}`)
    const config = await api.readOpenclawConfig()
    const port = config?.gateway?.port || 18789
    const rawToken = config?.gateway?.auth?.token
    const token = (typeof rawToken === 'string') ? rawToken : ''
    const url = buildGatewayWsUrl(port, token)

    const ws = new WebSocket(url)

    ws.onopen = () => {
      addLog(`${statusIcon('ok', 14)} ${t('pages.chat_debug.fix_ws_connected')}`)
    }

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data)
        if (msg.type === 'event' && msg.event === 'connect.challenge') {
          addLog(`${statusIcon('ok', 14)} ${t('pages.chat_debug.fix_challenge_ok')}`)
          const nonce = msg.payload?.nonce || ''

          api.createConnectFrame(nonce, token).then(frame => {
            ws.send(JSON.stringify(frame))
            addLog(`${icon('send', 14)} ${t('pages.chat_debug.fix_frame_sent')}`)
          })
        }

        if (msg.type === 'res' && msg.id?.startsWith('connect-')) {
          if (msg.ok) {
            addLog(`${statusIcon('ok', 14)} ${t('pages.chat_debug.fix_handshake_ok')}`)
            addLog(`${icon('lightbulb', 14)} ${t('pages.chat_debug.fix_reconnecting')}`)
            ws.close(1000)
            // 触发主应用的 wsClient 重连，让主界面正常工作
            wsClient.reconnect()
            setTimeout(() => loadDebugInfo(page), 2000)
          } else {
            const errMsg = msg.error?.message || msg.error?.code || '未知错误'
            addLog(`${statusIcon('err', 14)} ${t('pages.chat_debug.fix_handshake_fail', { error: errMsg })}`)
            if (errMsg.includes('origin not allowed')) {
              addLog(`${icon('lightbulb', 14)} ${t('pages.chat_debug.fix_origin_reason')}`)
            } else {
              addLog(`${icon('lightbulb', 14)} ${t('pages.chat_debug.fix_manual_hint')}`)
            }
          }
        }
      } catch (e) {
        addLog(`${statusIcon('warn', 14)} ${t('pages.chat_debug.ws_test_parse_fail', { error: String(e) })}`)
      }
    }

    ws.onerror = () => {
      addLog(`${statusIcon('err', 14)} ${t('pages.chat_debug.fix_ws_fail')}`)
    }

    ws.onclose = (e) => {
      if (e.code === 1008) {
        addLog(`${statusIcon('warn', 14)} ${t('pages.chat_debug.fix_rejected')}`)
        addLog(`${icon('lightbulb', 14)} ${t('pages.chat_debug.fix_rejected_hint')}`)
      } else if (e.code !== 1000) {
        addLog(`${statusIcon('warn', 14)} ${t('pages.chat_debug.fix_closed', { code: e.code })}`)
      }
    }

  } catch (e) {
    addLog(`${statusIcon('err', 14)} ${t('pages.chat_debug.fix_fail', { error: String(e) })}`)
    addLog(`${icon('lightbulb', 14)} ${t('pages.chat_debug.fix_manual_hint')}`)
  } finally {
    if (fixBtn) { fixBtn.disabled = false; fixBtn.textContent = t('pages.chat_debug.btn_fix_pairing') }
  }
}
