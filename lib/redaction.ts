const SENSITIVE_KEYS = new Set([
  'email',
  'username',
  'employeeid',
  'phone',
  'manager',
  'token',
  'authorization',
  'password',
  'secret',
  'ssn',
  'socialsecurity',
  'dateofbirth',
  'dob',
  'address',
  'phonenumber',
  'mobilenumber',
  'personalemail',
  'apikey',
  'api_key',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
])

const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
const PHONE_PATTERN = /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[_\-.\s]/g, '')
  return SENSITIVE_KEYS.has(normalized)
}

function redactString(value: string): string {
  let redacted = value
  redacted = redacted.replace(BEARER_PATTERN, 'Bearer [REDACTED]')
  redacted = redacted.replace(EMAIL_PATTERN, '[EMAIL_REDACTED]')
  redacted = redacted.replace(PHONE_PATTERN, '[PHONE_REDACTED]')
  return redacted
}

export function redactDeep(obj: unknown, enabled = true): unknown {
  if (!enabled) return obj

  if (obj === null || obj === undefined) return obj

  if (typeof obj === 'string') {
    return redactString(obj)
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redactDeep(item, enabled))
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (isSensitiveKey(key)) {
        result[key] = '[REDACTED]'
      } else {
        result[key] = redactDeep(value, enabled)
      }
    }
    return result
  }

  return obj
}

export function truncatePreview(obj: unknown, maxLength = 500): string {
  const str = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2)
  if (!str) return ''
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength) + '... [truncated]'
}
