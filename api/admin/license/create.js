import {
  assertAdminAuthorization,
  buildLicenseState,
  coerceProductProfileId,
  generateLicenseKey,
  getDbPool,
  handleApiError,
  hashLicenseKey,
  parseJsonBody,
  recordLicenseEvent,
  requireMethod,
  sendJson,
  VALID_MODULE_IDS,
} from '../../_lib/license.js'

export default async function handler(req, res) {
  if (!requireMethod(req, res, 'POST')) return

  try {
    assertAdminAuthorization(req)
    const payload = await parseJsonBody(req)
    const note = String(payload?.note || '').trim() || null
    const productProfileId = coerceProductProfileId(payload?.productProfileId)
    const expiresAt = payload?.expiresAt ? new Date(payload.expiresAt) : null
    if (expiresAt && !Number.isFinite(expiresAt.getTime())) {
      return sendJson(res, 400, { error: 'expiresAt 格式无效' })
    }
    if (Array.isArray(payload?.enabledModules) && payload.enabledModules.length) {
      const invalid = payload.enabledModules.filter(m => !VALID_MODULE_IDS.includes(m))
      if (invalid.length) {
        return sendJson(res, 400, { error: `无效模块 ID: ${invalid.join(', ')}，可选值: ${VALID_MODULE_IDS.join(', ')}` })
      }
    }
    const enabledModules = Array.isArray(payload?.enabledModules) && payload.enabledModules.length
      ? [...new Set(['base', ...payload.enabledModules])]
      : ['base']

    const client = await getDbPool().connect()
    try {
      await client.query('BEGIN')
      let licenseKey = ''
      let row = null
      for (let attempt = 0; attempt < 5; attempt += 1) {
        licenseKey = generateLicenseKey()
        const hash = hashLicenseKey(licenseKey)
        const result = await client.query(
          `
            INSERT INTO licenses (license_key_hash, product_profile_id, status, expires_at, note, enabled_modules)
            VALUES ($1, $2, 'inactive', $3, $4, $5)
            ON CONFLICT (license_key_hash) DO NOTHING
            RETURNING id, license_key_hash, product_profile_id, status, bound_device_id, bound_at, last_seen_at, expires_at, note, enabled_modules, created_at, updated_at
          `,
          [hash, productProfileId, expiresAt ? expiresAt.toISOString() : null, note, enabledModules],
        )
        if (result.rows[0]) {
          row = result.rows[0]
          break
        }
      }

      if (!row) throw new Error('生成授权码失败，请重试')

      await recordLicenseEvent(client, {
        licenseId: row.id,
        eventType: 'admin_create',
        req,
        detail: { note, productProfileId, enabledModules },
      })
      await client.query('COMMIT')

      return sendJson(res, 200, {
        licenseKey,
        ...buildLicenseState(row, { productProfileId }),
      })
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  } catch (error) {
    return handleApiError(res, error)
  }
}
