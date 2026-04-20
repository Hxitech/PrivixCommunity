import {
  assertAdminAuthorization,
  buildLicenseState,
  getDbPool,
  getLicenseByNormalizedKey,
  handleApiError,
  normalizeLicenseKey,
  parseJsonBody,
  readRequiredString,
  recordLicenseEvent,
  requireMethod,
  sendJson,
} from '../../_lib/license.js'

export default async function handler(req, res) {
  if (!requireMethod(req, res, 'POST')) return

  try {
    assertAdminAuthorization(req)
    const payload = await parseJsonBody(req)
    const licenseKey = normalizeLicenseKey(readRequiredString(payload, 'licenseKey', '授权码'))
    const client = await getDbPool().connect()

    try {
      await client.query('BEGIN')
      const row = await getLicenseByNormalizedKey(client, licenseKey, { forUpdate: true })
      if (!row) {
        await client.query('ROLLBACK')
        return sendJson(res, 404, { error: '授权码不存在' })
      }

      const nextStatus = row.status === 'revoked' ? 'revoked' : 'inactive'
      const result = await client.query(
        `
          UPDATE licenses
          SET bound_device_id = NULL,
              bound_at = NULL,
              last_seen_at = NULL,
              status = $2,
              updated_at = NOW()
          WHERE id = $1
          RETURNING id, license_key_hash, status, bound_device_id, bound_at, last_seen_at, expires_at, note, enabled_modules, created_at, updated_at
        `,
        [row.id, nextStatus],
      )
      const next = result.rows[0]
      await recordLicenseEvent(client, {
        licenseId: next.id,
        eventType: 'admin_reset_device',
        req,
        detail: { previousDeviceId: row.bound_device_id },
      })
      await client.query('COMMIT')

      return sendJson(res, 200, {
        success: true,
        ...buildLicenseState(next),
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

