/**
 * npm install / upgrade 常见错误诊断
 * 解析 npm 错误信息，返回用户友好的提示和修复建议
 */
import { t } from './i18n.js'

const NPM_CMD = 'npm install -g @qingchencloud/openclaw-zh --registry https://registry.npmmirror.com'
const GIT_HTTPS_CMD = 'git config --global url."https://github.com/".insteadOf ssh://git@github.com/ && git config --global --add url."https://github.com/".insteadOf ssh://git@github.com && git config --global --add url."https://github.com/".insteadOf ssh://git@://github.com/ && git config --global --add url."https://github.com/".insteadOf git@github.com: && git config --global --add url."https://github.com/".insteadOf git://github.com/ && git config --global --add url."https://github.com/".insteadOf git+ssh://git@github.com/'
const GIT_HTTPS_ROOT_CMD = 'sudo git config --global url."https://github.com/".insteadOf ssh://git@github.com/ && sudo git config --global --add url."https://github.com/".insteadOf ssh://git@github.com && sudo git config --global --add url."https://github.com/".insteadOf ssh://git@://github.com/ && sudo git config --global --add url."https://github.com/".insteadOf git@github.com: && sudo git config --global --add url."https://github.com/".insteadOf git://github.com/ && sudo git config --global --add url."https://github.com/".insteadOf git+ssh://git@github.com/'

/**
 * @param {string} errStr - npm 错误输出（可含流式日志）
 * @returns {{ title: string, hint?: string, command?: string, helpContext?: string }}
 */
export function diagnoseInstallError(errStr) {
  const s = errStr.toLowerCase()
  const rootNpm = s.includes('/root/.npm/') || s.includes('/root/.config/') || s.includes('sudo npm')
  const gitFixCommand = rootNpm ? GIT_HTTPS_ROOT_CMD : GIT_HTTPS_CMD

  // ===== 1. Git 相关 =====

  // git SSH 权限问题（有 git 但没配 SSH Key）— 只匹配明确的 SSH 失败信号
  if (s.includes('permission denied (publickey)') || s.includes('host key verification failed')) {
    return {
      title: t('diag.git_ssh_denied_title'),
      hint: rootNpm ? t('diag.git_ssh_denied_hint_root') : t('diag.git_ssh_denied_hint'),
      command: gitFixCommand,
      helpContext: 'git-ssh-auth',
    }
  }

  // git exit 128：优先判断是 SSH 失败还是 Git 未安装
  if (s.includes('code 128') || s.includes('exit 128')) {
    if (s.includes('permission denied') || s.includes('publickey') || s.includes('host key verification')) {
      return {
        title: t('diag.git_ssh_denied_title'),
        hint: rootNpm ? t('diag.git_ssh_denied_hint_root') : t('diag.git_ssh_denied_hint'),
        command: gitFixCommand,
        helpContext: 'git-ssh-auth',
      }
    }
    return {
      title: t('diag.git_fetch_error_title'),
      hint: rootNpm ? t('diag.git_fetch_error_hint_root') : t('diag.git_fetch_error_hint'),
      command: gitFixCommand,
      helpContext: 'git-fetch-error',
    }
  }

  // native binding 缺失（macOS/Linux 上 OpenClaw 的原生依赖问题）
  if (s.includes('cannot find native binding') || s.includes('native binding')) {
    return {
      title: t('diag.native_binding_title'),
      hint: t('diag.native_binding_hint'),
      command: 'npm i -g @qingchencloud/openclaw-zh@latest --registry https://registry.npmmirror.com',
      helpContext: 'native-binding',
    }
  }

  // ===== 2. 文件 / 权限 =====

  // EPERM（文件被占用/权限问题）— 放在 ENOENT 前面，优先匹配
  if (s.includes('eperm') || s.includes('operation not permitted')) {
    return {
      title: t('diag.eperm_title'),
      hint: t('diag.eperm_hint'),
      command: NPM_CMD,
      helpContext: 'file-permission',
    }
  }

  // EEXIST（文件已存在，切换版本/源时常见）
  if (s.includes('eexist') || s.includes('file already exists') || s.includes('file exists')) {
    return {
      title: t('diag.eexist_title'),
      hint: t('diag.eexist_hint'),
      command: 'npm install -g @qingchencloud/openclaw-zh --force --registry https://registry.npmmirror.com',
      helpContext: 'file-conflict',
    }
  }

  // ENOENT（文件找不到 / -4058）
  if (s.includes('enoent') || s.includes('-4058') || s.includes('code -4058')) {
    const pathMatch = errStr.match(/enoent[^']*'([^']+)'/i) || errStr.match(/path\s+'([^']+)'/i)
    const missingPath = pathMatch?.[1] || ''

    if (missingPath.includes('node_modules') || missingPath.includes('npm')) {
      return {
        title: t('diag.enoent_npm_dir_title'),
        hint: t('diag.enoent_npm_dir_hint', { path: missingPath }),
        command: 'npm config set prefix "%APPDATA%\\npm" && ' + NPM_CMD,
        helpContext: 'npm-dir-missing',
      }
    }
    return {
      title: t('diag.enoent_title'),
      hint: t('diag.enoent_hint'),
      command: NPM_CMD,
      helpContext: 'file-not-found',
    }
  }

  // EACCES（权限不足）
  if (s.includes('eacces') || s.includes('permission denied')) {
    const isMac = navigator.platform?.includes('Mac') || navigator.userAgent?.includes('Mac')
    return {
      title: t('diag.eacces_title'),
      hint: isMac ? t('diag.eacces_hint_mac') : t('diag.eacces_hint_win'),
      command: isMac ? 'sudo ' + NPM_CMD : NPM_CMD,
      helpContext: 'permission-denied',
    }
  }

  // MODULE_NOT_FOUND（安装不完整）
  if (s.includes('module_not_found') || s.includes('cannot find module')) {
    return {
      title: t('diag.module_not_found_title'),
      hint: t('diag.module_not_found_hint'),
      command: 'npm cache clean --force && ' + NPM_CMD,
      helpContext: 'incomplete-install',
    }
  }

  // ===== 3. 网络 =====

  if (s.includes('etimedout') || s.includes('econnrefused') || s.includes('enotfound')
    || s.includes('fetch failed') || s.includes('socket hang up')
    || s.includes('econnreset') || s.includes('unable to get local issuer')) {
    const isProxy = s.includes('proxy') || s.includes('unable to get local issuer')
    return {
      title: t('diag.network_title'),
      hint: isProxy ? t('diag.network_hint_proxy') : t('diag.network_hint'),
      command: isProxy ? 'npm config set strict-ssl false && ' + NPM_CMD : NPM_CMD,
      helpContext: isProxy ? 'network-proxy' : 'network-error',
    }
  }

  // ===== 4. npm 自身问题 =====

  // npm 缓存损坏
  if (s.includes('integrity') || s.includes('sha512') || s.includes('cache')) {
    return {
      title: t('diag.cache_title'),
      hint: t('diag.cache_hint'),
      command: 'npm cache clean --force && ' + NPM_CMD,
      helpContext: 'npm-cache',
    }
  }

  // Node.js 版本过低
  if (s.includes('engine') || s.includes('unsupported') || s.includes('required:')) {
    return {
      title: t('diag.node_version_title'),
      hint: t('diag.node_version_hint'),
      command: 'https://nodejs.org/',
      helpContext: 'node-version',
    }
  }

  // npm 版本过低或损坏
  if (s.includes('npm err') && (s.includes('cb() never called') || s.includes('code 1'))) {
    return {
      title: t('diag.npm_broken_title'),
      hint: t('diag.npm_broken_hint'),
      command: 'npm install -g npm@latest && ' + NPM_CMD,
      helpContext: 'npm-broken',
    }
  }

  // ===== 5. 磁盘空间 =====
  if (s.includes('enospc') || s.includes('no space')) {
    return {
      title: t('diag.disk_full_title'),
      hint: t('diag.disk_full_hint'),
      helpContext: 'disk-full',
    }
  }

  // ===== standalone 安装相关 =====
  if (s.includes('standalone 清单获取失败') || s.includes('standalone 清单不可用')) {
    return {
      title: t('diag.standalone_manifest_title'),
      hint: t('diag.standalone_manifest_hint'),
      helpContext: 'standalone-manifest',
    }
  }

  if (s.includes('standalone 下载失败')) {
    return {
      title: t('diag.standalone_download_title'),
      hint: t('diag.standalone_download_hint'),
      helpContext: 'standalone-download',
    }
  }

  // ===== fallback =====
  return {
    title: t('diag.fallback_title'),
    hint: t('diag.fallback_hint'),
    command: NPM_CMD,
    helpContext: 'install-failed',
  }
}
