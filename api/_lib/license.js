import crypto from 'node:crypto'
import { Pool } from 'pg'
import { getDefaultProductProfileId, MODULE_IDS, normalizeProductProfileId } from '../../src/lib/product-profile.js'

export const LICENSE_OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000
const LICENSE_PREFIX = 'PC'
const LICENSE_TOKEN_VERSION = 'v2'
const LICENSE_TOKEN_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000 // 30 天
export const DEFAULT_PRODUCT_PROFILE_ID = getDefaultProductProfileId()

let pool

function parseIpv4(input) {
  const parts = String(input || '').trim().split('.')
  if (parts.length !== 4) return null
  const octets = parts.map(part => Number(part))
  return octets.every(value => Number.isInteger(value) && value >= 0 && value <= 255) ? octets : null
}

function isPrivateIpv4(host) {
  const octets = parseIpv4(host)
  if (!octets) return false
  const [a, b] = octets
  return a === 10
    || a === 127
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 169 && b === 254)
  }

function isLocalDbHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase().replace(/^\[(.*)\]$/, '$1')
  if (!host) return true
  if (host === 'localhost' || host === '::1' || host.endsWith('.local') || host.endsWith('.internal')) {
    return true
  }
  if (isPrivateIpv4(host)) return true
  return !host.includes('.')
}

function resolveDbSsl(connectionString) {
  const explicit = String(process.env.POSTGRES_SSL || process.env.DATABASE_SSL || '').trim().toLowerCase()
  if (explicit) {
    return ['1', 'true', 'yes', 'require'].includes(explicit)
      ? { rejectUnauthorized: true }
      : false
  }

  try {
    const url = new URL(connectionString)
    const sslMode = String(url.searchParams.get('sslmode') || '').trim().toLowerCase()
    const sslFlag = String(url.searchParams.get('ssl') || '').trim().toLowerCase()
    if (sslMode === 'disable' || ['0', 'false', 'no'].includes(sslFlag)) return false
    if (['require', 'verify-ca', 'verify-full'].includes(sslMode) || ['1', 'true', 'yes'].includes(sslFlag)) {
      return { rejectUnauthorized: true }
    }
    return isLocalDbHost(url.hostname) ? false : { rejectUnauthorized: true }
  } catch {
    return connectionString.includes('localhost') ? false : { rejectUnauthorized: true }
  }
}

function createHttpError(status, message, extra = {}) {
  const error = new Error(message)
  error.status = status
  Object.assign(error, extra)
  return error
}

export function sendJson(res, status, payload) {
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(status).json(payload)
  }
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

export function requireMethod(req, res, method = 'POST') {
  if ((req.method || 'GET').toUpperCase() === method) return true
  sendJson(res, 405, { error: `Method ${req.method || 'GET'} Not Allowed` })
  return false
}

export async function parseJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string' && req.body.trim()) {
    return JSON.parse(req.body)
  }
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8').trim()
  return text ? JSON.parse(text) : {}
}

export function normalizeLicenseKey(input) {
  const raw = String(input || '').trim().toUpperCase()
  if (!raw) return ''
  const compact = raw.replace(/[^A-Z0-9]/g, '')
  if (!compact) return ''
  const withoutPrefix = compact.startsWith(LICENSE_PREFIX)
    ? compact.slice(LICENSE_PREFIX.length)
    : compact
  if (!withoutPrefix) return ''
  return `${LICENSE_PREFIX}-${withoutPrefix.match(/.{1,4}/g).join('-')}`
}

export function generateLicenseKey() {
  const compact = crypto.randomBytes(10).toString('hex').toUpperCase()
  return normalizeLicenseKey(`${LICENSE_PREFIX}-${compact}`)
}

export function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex')
}

export function hashLicenseKey(input) {
  const normalized = normalizeLicenseKey(input)
  return normalized ? sha256Hex(normalized) : ''
}

export function hashIp(ip) {
  const value = String(ip || '').trim()
  return value ? sha256Hex(value) : null
}

export function computeOfflineGraceUntil(now = Date.now()) {
  return new Date(now + LICENSE_OFFLINE_GRACE_MS).toISOString()
}

export function getForwardedIp(req) {
  const forwarded = req.headers['x-forwarded-for']
  if (Array.isArray(forwarded)) return forwarded[0]?.split(',')[0]?.trim() || ''
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim()
  return req.socket?.remoteAddress || ''
}

export function getDbPool() {
  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL
  if (!connectionString) {
    throw createHttpError(500, 'POSTGRES_URL 未配置')
  }
  if (!pool) {
    pool = new Pool({
      connectionString,
      max: 4,
      ssl: resolveDbSsl(connectionString),
    })
  }
  return pool
}

function getTokenSecret() {
  const secret = process.env.LICENSE_TOKEN_SECRET
  if (!secret) throw createHttpError(500, 'LICENSE_TOKEN_SECRET 未配置')
  return secret
}

export function coerceProductProfileId(value) {
  return normalizeProductProfileId(value || DEFAULT_PRODUCT_PROFILE_ID)
}

export function signLicenseToken({ licenseHash, deviceId, productProfileId }) {
  const now = Date.now()
  const payload = {
    v: LICENSE_TOKEN_VERSION,
    h: licenseHash,
    d: deviceId,
    p: coerceProductProfileId(productProfileId),
    iat: now,
    exp: now + LICENSE_TOKEN_EXPIRY_MS,
    grace: new Date(now + LICENSE_OFFLINE_GRACE_MS).toISOString(),
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = crypto
    .createHmac('sha256', getTokenSecret())
    .update(encoded)
    .digest('base64url')
  return `${encoded}.${signature}`
}

export function verifyLicenseToken(token) {
  const value = String(token || '').trim()
  if (!value.includes('.')) return null
  const [encoded, signature] = value.split('.')
  const expected = crypto
    .createHmac('sha256', getTokenSecret())
    .update(encoded)
    .digest('base64url')
  const left = Buffer.from(signature)
  const right = Buffer.from(expected)
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    // v2 token 检查过期（v1 没有 exp 字段，向后兼容不检查）
    if (payload.exp && payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

/**
 * 验证 Ed25519 设备签名（可选 — 旧客户端不发送签名时跳过）
 * @returns {boolean|null} true=验证通过, false=验证失败, null=未提供签名（跳过）
 */
export function verifyDeviceSignature({ deviceId, devicePublicKey, deviceSignature, signedPayload }) {
  if (!deviceSignature || !devicePublicKey) return null // 旧客户端兼容
  try {
    const keyBuffer = Buffer.from(devicePublicKey, 'base64url')
    if (keyBuffer.length !== 32) return false
    const publicKey = crypto.createPublicKey({
      key: Buffer.concat([
        // Ed25519 DER prefix
        Buffer.from('302a300506032b6570032100', 'hex'),
        keyBuffer,
      ]),
      format: 'der',
      type: 'spki',
    })
    const sigBuffer = Buffer.from(deviceSignature, 'base64url')
    return crypto.verify(null, Buffer.from(signedPayload), publicKey, sigBuffer)
  } catch {
    return false
  }
}

export function assertAdminAuthorization(req) {
  const expected = process.env.LICENSE_ADMIN_SECRET
  if (!expected) throw createHttpError(500, 'LICENSE_ADMIN_SECRET 未配置')
  const header = String(req.headers.authorization || '').trim()
  const prefix = 'Bearer '
  if (!header.startsWith(prefix)) throw createHttpError(401, '未授权访问管理员接口')
  const provided = header.slice(prefix.length)
  if (provided.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
    throw createHttpError(401, '未授权访问管理员接口')
  }
}

export function isLicenseExpired(row, now = Date.now()) {
  if (!row?.expires_at) return false
  return new Date(row.expires_at).getTime() <= now
}

export function effectiveLicenseStatus(row, now = Date.now()) {
  if (!row) return 'inactive'
  if (row.status === 'revoked') return 'revoked'
  if (isLicenseExpired(row, now)) return 'expired'
  return row.status || 'inactive'
}

export function toIso(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

export const VALID_MODULE_IDS = Object.freeze(Object.values(MODULE_IDS))

// 兼容旧版授权：根据旧 product_profile_id 推导 enabledModules（与 Rust 端逻辑一致）
function inferModulesFromProfileId(profileId) {
  switch (profileId) {
    case 'invest_workbench': return ['base', 'invest']
    case 'local_qa_kb': return ['base', 'knowledge']
    case 'doc_sop': return ['base', 'sop']
    default: return ['base']
  }
}

export function buildLicenseState(row, overrides = {}) {
  const dbModules = Array.isArray(row?.enabled_modules) && row.enabled_modules.length
    ? row.enabled_modules
    : inferModulesFromProfileId(row?.product_profile_id)
  return {
    id: row?.id || null,
    status: effectiveLicenseStatus(row),
    productProfileId: row?.product_profile_id || DEFAULT_PRODUCT_PROFILE_ID,
    boundDeviceId: row?.bound_device_id || null,
    boundAt: toIso(row?.bound_at),
    lastSeenAt: toIso(row?.last_seen_at),
    expiresAt: toIso(row?.expires_at),
    note: row?.note || null,
    enabledModules: dbModules,
    ...overrides,
  }
}

// 所有历史 profile ID 均视为同一产品（统一合并后的兼容查询）
const ALL_PRODUCT_PROFILE_IDS = ['prospectclaw', 'invest_workbench', 'local_qa_kb', 'doc_sop']

export async function getLicenseByNormalizedKey(client, normalizedKey, { forUpdate = false, productProfileId = null } = {}) {
  const hash = hashLicenseKey(normalizedKey)
  if (!hash) return null
  const scopedProductProfileId = productProfileId ? coerceProductProfileId(productProfileId) : null
  // 查询时匹配所有等价的历史 profile ID，避免 DB 迁移依赖
  const profileFilter = scopedProductProfileId
    ? `AND product_profile_id = ANY($2::text[])`
    : ''
  const query = `
    SELECT id, license_key_hash, product_profile_id, status, bound_device_id, bound_at, last_seen_at, expires_at, note, enabled_modules, created_at, updated_at
    FROM licenses
    WHERE license_key_hash = $1
    ${profileFilter}
    ${forUpdate ? 'FOR UPDATE' : ''}
  `
  const params = scopedProductProfileId ? [hash, ALL_PRODUCT_PROFILE_IDS] : [hash]
  const result = await client.query(query, params)
  return result.rows[0] || null
}

export async function markExpiredIfNeeded(client, row) {
  if (!row || !isLicenseExpired(row)) return row
  const result = await client.query(
    `
      UPDATE licenses
      SET status = 'expired', updated_at = NOW()
      WHERE id = $1
      RETURNING id, license_key_hash, product_profile_id, status, bound_device_id, bound_at, last_seen_at, expires_at, note, enabled_modules, created_at, updated_at
    `,
    [row.id],
  )
  return result.rows[0] || row
}

export async function recordLicenseEvent(client, { licenseId, eventType, deviceId = null, req = null, detail = null }) {
  if (!licenseId) return
  const ip = req ? getForwardedIp(req) : null
  const userAgent = req?.headers['user-agent'] || null
  await client.query(
    `
      INSERT INTO license_events (license_id, event_type, device_id, ip_hash, user_agent, detail_json)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [
      licenseId,
      eventType,
      deviceId,
      hashIp(ip),
      userAgent,
      JSON.stringify(detail || {}),
    ],
  )
}

export function readRequiredString(payload, key, label) {
  const value = String(payload?.[key] || '').trim()
  if (!value) throw createHttpError(400, `${label}不能为空`)
  return value
}

export function handleApiError(res, error) {
  const status = Number.isInteger(error?.status) ? error.status : 500
  const payload = { error: error?.message || '服务异常' }
  if (error?.statusText) payload.status = error.statusText
  return sendJson(res, status, payload)
}
