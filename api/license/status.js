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
  verifyLicenseToken,
  verifyDeviceSignature,
} from '../_lib/license.js'

export default async function handler(req, res) {
  if (!requireMethod(req, res, 'POST')) return

  try {
    const payload = await parseJsonBody(req)
    const licenseKey = normalizeLicenseKey(readRequiredString(payload, 'licenseKey', '授权码'))
    const deviceId = readRequiredString(payload, 'deviceId', '设备 ID')
    const licenseToken = readRequiredString(payload, 'licenseToken', '授权令牌')
    const productProfileId = coerceProductProfileId(payload?.productProfileId)

    // Ed25519 设备签名验证（可选）
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
          eventType: 'validate_revoked',
          deviceId,
          req,
          detail: { productProfileId },
        })
        await client.query('COMMIT')
        return sendJson(res, 403, { error: '授权已被停用', status: 'revoked', productProfileId })
      }

      if (row.status === 'expired') {
        await recordLicenseEvent(client, {
          licenseId: row.id,
          eventType: 'validate_expired',
          deviceId,
          req,
          detail: { productProfileId },
        })
        await client.query('COMMIT')
        return sendJson(res, 403, { error: '授权已过期', status: 'expired', productProfileId })
      }

      if (!row.bound_device_id || row.status !== 'active') {
        await recordLicenseEvent(client, {
          licenseId: row.id,
          eventType: 'validate_inactive',
          deviceId,
          req,
          detail: { productProfileId },
        })
        await client.query('COMMIT')
        return sendJson(res, 409, { error: '授权尚未在当前设备激活', status: 'inactive', productProfileId })
      }

      if (row.bound_device_id !== deviceId) {
        await recordLicenseEvent(client, {
          licenseId: row.id,
          eventType: 'validate_conflict',
          deviceId,
          req,
          detail: { boundDeviceId: row.bound_device_id, productProfileId },
        })
        await client.query('COMMIT')
        return sendJson(res, 409, {
          error: '该授权码已绑定到其他设备，请后台解绑后重试',
          status: 'inactive',
          productProfileId,
        })
      }

      const tokenPayload = verifyLicenseToken(licenseToken)
      if (
        !tokenPayload
        || tokenPayload.h !== row.license_key_hash
        || tokenPayload.d !== deviceId
        || coerceProductProfileId(tokenPayload.p) !== productProfileId
      ) {
        await recordLicenseEvent(client, {
          licenseId: row.id,
          eventType: 'validate_bad_token',
          deviceId,
          req,
          detail: { productProfileId },
        })
        await client.query('COMMIT')
        return sendJson(res, 401, { error: '授权令牌无效，请重新激活', status: 'inactive', productProfileId })
      }

      const result = await client.query(
        `
          UPDATE licenses
          SET last_seen_at = NOW(), updated_at = NOW()
          WHERE id = $1
          RETURNING id, license_key_hash, product_profile_id, status, bound_device_id, bound_at, last_seen_at, expires_at, note, enabled_modules, created_at, updated_at
        `,
        [row.id],
      )
      const next = result.rows[0]
      await recordLicenseEvent(client, {
        licenseId: next.id,
        eventType: 'validate_ok',
        deviceId,
        req,
        detail: { productProfileId },
      })
      await client.query('COMMIT')

      // Token 自动续签：v1 token 或即将过期的 v2 token 都下发新 token
      const needsRenewal = !tokenPayload.v || tokenPayload.v === 'v1'
        || (tokenPayload.exp && tokenPayload.exp - Date.now() < 7 * 24 * 3600 * 1000) // 7 天内过期
      const renewedToken = needsRenewal
        ? signLicenseToken({ licenseHash: next.license_key_hash, deviceId, productProfileId })
        : undefined

      return sendJson(res, 200, {
        ...buildLicenseState(next, {
          status: 'active',
          deviceId,
          productProfileId,
          offlineGraceUntil: computeOfflineGraceUntil(),
        }),
        ...(renewedToken ? { licenseToken: renewedToken } : {}),
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
