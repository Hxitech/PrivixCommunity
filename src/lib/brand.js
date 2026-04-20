import { getActiveProductProfile } from './product-profile.js'

const PROFILE = getActiveProductProfile()
const BRAND = PROFILE.brand
const LEGAL = PROFILE.legal

export const BRAND_NAME = PROFILE.productName
export const BRAND_SUBTITLE = BRAND.subtitle
export const BRAND_FULL = `${BRAND_NAME} · ${BRAND_SUBTITLE}`
export const BRAND_LOGO_SRC = BRAND.logoSrc
export const BRAND_LOGO_ALT = BRAND.logoAlt
export const BRAND_SHELL_LABEL = BRAND.shellLabel
export const BRAND_SETUP_TAGLINE = BRAND.setupTagline
export const BRAND_ABOUT_SUBTITLE_HTML = BRAND.aboutSubtitleHtml
export const BRAND_DESCRIPTION = BRAND.neutralDescription
export const BRAND_SHOW_COMPANY_PROFILE = !!BRAND.showCompanyProfile

export const COMPANY_NAME_EN = BRAND.ownerNameEn
export const COMPANY_TAGLINE = BRAND.companyTagline
export const COMPANY_SLOGAN = BRAND.neutralDescription
export const COMPANY_WEBSITE = BRAND.companyWebsite
export const COMPANY_EMAIL = BRAND.companyEmail
export const COMPANY_PHONE = BRAND.companyPhone
export const COMPANY_ADDRESS = BRAND.companyAddress
export const COMPANY_INTRO = Array.isArray(BRAND.companyIntro) ? BRAND.companyIntro : []

export const LEGAL_AUTHOR = LEGAL.author
export const LEGAL_COPYRIGHT_OWNER = LEGAL.copyrightOwner
export const LEGAL_ABOUT_NOTICE = LEGAL.aboutNotice
export const LEGAL_COMMERCIAL_NOTICE = LEGAL.commercialNotice
export const LEGAL_MIT_NOTICE = LEGAL.mitNotice
