import {
  buildLicenseState,
  coerceProductProfileId,
  computeOfflineGraceUntil,
  getDbPool,
  getLicenseByNormalizedKey,
  handleApiError,
  markExpiredIfNeeded,
  normalizeLicenseKey,
  parseJsonBody,
  readRequiredString,
  recordLicenseEvent,
  requireMethod,
  sendJson,
  signLicenseToken,
  verifyDeviceSignature,
} from '../_lib/license.js'

export default async function handler(req, res) {
  if (!requireMethod(req, res, 'POST')) return

  try {
    const payload = await parseJsonBody(req)
    const licenseKey = normalizeLicenseKey(readRequiredString(payload, 'licenseKey', '授权码'))
    const deviceId = readRequiredString(payload, 'deviceId', '设备 ID')
    const appVersion = String(payload?.appVersion || '').trim() || null
    const productProfileId = coerceProductProfileId(payload?.productProfileId)

    // Ed25519 设备签名验证（可选 — 旧客户端不发送时跳过）
    const sigResult = verifyDeviceSignature({
      deviceId,
      devicePublicKey: payload?.devicePublicKey,
      deviceSignature: payload?.deviceSignature,
      signedPayload: payload?.signedPayload || '',
    })
    if (sigResult === false) {
      return sendJson(res, 403, { error: '设备签名验证失败', status: 'inactive', productProfileId })
    }

    const client = await getDbPool().connect()

    try {
      await client.query('BEGIN')
      let row = await getLicenseByNormalizedKey(client, licenseKey, { forUpdate: true, productProfileId })
      if (!row) {
        await client.query('ROLLBACK')
        return sendJson(res, 404, {
          error: '授权码不存在，或不适用于当前产品版本',
          status: 'inactive',
          productProfileId,
        })
      }

      row = await markExpiredIfNeeded(client, row)
      if (row.status === 'revoked') {
        await recordLicenseEvent(client, {
          licenseId: row.id,
          eventType: 'activate_revoked',
          deviceId,
          req,
          detail: { appVersion, productProfileId },
        })
        await client.query('COMMIT')
        return sendJson(res, 403, { error: '授权已被停用', status: 'revoked', productProfileId })
      }

      if (row.status === 'expired') {
        await recordLicenseEvent(client, {
          licenseId: row.id,
          eventType: 'activate_expired',
          deviceId,
          req,
          detail: { appVersion, productProfileId },
        })
        await client.query('COMMIT')
        return sendJson(res, 403, { error: '授权已过期', status: 'expired', productProfileId })
      }

      if (row.bound_device_id && row.bound_device_id !== deviceId) {
        await recordLicenseEvent(client, {
          licenseId: row.id,
          eventType: 'activate_conflict',
          deviceId,
          req,
          detail: { boundDeviceId: row.bound_device_id, appVersion, productProfileId },
        })
        await client.query('COMMIT')
        return sendJson(res, 409, {
          error: '该授权码已在其他设备激活，请后台解绑后重试',
          status: 'inactive',
          productProfileId,
        })
      }

      const result = await client.query(
        `
          UPDATE licenses
          SET status = 'active',
              product_profile_id = $3,
              bound_device_id = COALESCE(bound_device_id, $2),
              bound_at = COALESCE(bound_at, NOW()),
              last_seen_at = NOW(),
              updated_at = NOW()
          WHERE id = $1
          RETURNING id, license_key_hash, product_profile_id, status, bound_device_id, bound_at, last_seen_at, expires_at, note, enabled_modules, created_at, updated_at
        `,
        [row.id, deviceId, productProfileId],
      )
      const next = result.rows[0]

      await recordLicenseEvent(client, {
        licenseId: next.id,
        eventType: row.bound_device_id ? 'activate_repeat' : 'activate_bind',
        deviceId,
        req,
        detail: { appVersion, productProfileId },
      })
      await client.query('COMMIT')

      const offlineGraceUntil = computeOfflineGraceUntil()
      const licenseToken = signLicenseToken({
        licenseHash: next.license_key_hash,
        deviceId,
        productProfileId,
      })

      return sendJson(res, 200, {
        ...buildLicenseState(next, {
          status: 'active',
          deviceId,
          productProfileId,
          activatedAt: next.bound_at?.toISOString?.() || next.bound_at,
          offlineGraceUntil,
          licenseToken,
          normalizedLicenseKey: licenseKey,
        }),
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
