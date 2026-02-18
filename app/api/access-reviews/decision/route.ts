import { callTool, checkAndAutoConnect, getCachedTools } from '@/lib/mcp/client'
import { getDefaultGatewayConfig, validateToolCall } from '@/lib/mcp/tool-gateway'
import type { McpPendingRequest, McpToolSchema } from '@/lib/mcp/types'

const APPROVAL_TOOL_NAME = 'approve_reject_entire_request'

type ReviewDecision = 'approve' | 'reject'

type ParsedPayload =
  | {
      ok: true
      value: {
        request: McpPendingRequest
        decision: ReviewDecision
        comment: string
        confirmed: boolean
        destructiveActionsEnabled: boolean
        redactionEnabled: boolean
        saviyntUsername?: string
        saviyntPassword?: string
      }
    }
  | {
      ok: false
      error: string
    }

export async function POST(req: Request) {
  try {
    const body: unknown = await req.json()
    const parsed = parsePayload(body)

    if (!parsed.ok) {
      return Response.json({ success: false, error: parsed.error }, { status: 400 })
    }

    const {
      request,
      decision,
      comment,
      confirmed,
      destructiveActionsEnabled,
      redactionEnabled,
      saviyntUsername,
      saviyntPassword,
    } = parsed.value

    if (!confirmed) {
      return Response.json(
        { success: false, error: 'Explicit confirmation is required before submitting a decision.' },
        { status: 400 }
      )
    }

    if (!destructiveActionsEnabled) {
      return Response.json(
        {
          success: false,
          error: 'Destructive actions are disabled. Enable destructive actions in settings to approve or reject requests.',
        },
        { status: 403 }
      )
    }

    await checkAndAutoConnect()

    const toolSchema = getCachedTools().find((tool) => tool.name === APPROVAL_TOOL_NAME)
    const gatewayConfig = {
      ...getDefaultGatewayConfig(),
      destructiveActionsEnabled,
      redactionEnabled,
    }

    const validation = validateToolCall(APPROVAL_TOOL_NAME, {}, toolSchema, gatewayConfig)
    if (!validation.valid) {
      return Response.json({ success: false, error: validation.error }, { status: 403 })
    }

    if (validation.requiresConfirmation && !confirmed) {
      return Response.json(
        { success: false, error: 'Confirmation was not provided for a destructive tool call.' },
        { status: 400 }
      )
    }

    const args = buildDecisionArgs(toolSchema, request, decision, comment)
    const saviyntCredentials = saviyntUsername && saviyntPassword
      ? { username: saviyntUsername, password: saviyntPassword }
      : undefined
    const result = await callTool(APPROVAL_TOOL_NAME, args, undefined, saviyntCredentials)

    if (!result.success) {
      return Response.json(
        {
          success: false,
          error: result.error || 'Failed to submit access review decision.',
          argsUsed: args,
        },
        { status: 500 }
      )
    }

    return Response.json({
      success: true,
      decision,
      requestid: request.requestid,
      requestkey: request.requestkey,
      argsUsed: args,
      duration: result.duration,
      timestamp: result.timestamp,
      result: result.result,
    })
  } catch (err) {
    return Response.json(
      { success: false, error: err instanceof Error ? err.message : 'Failed to submit decision' },
      { status: 500 }
    )
  }
}

function parsePayload(value: unknown): ParsedPayload {
  if (!isRecord(value)) {
    return { ok: false, error: 'Invalid payload.' }
  }

  const decision = normalizeDecision(value.decision)
  if (!decision) {
    return { ok: false, error: 'Decision must be "approve" or "reject".' }
  }

  const request = normalizePendingRequest(value.request)
  if (!request) {
    return { ok: false, error: 'A valid selected request is required.' }
  }

  const comment = typeof value.comment === 'string' && value.comment.trim()
    ? value.comment.trim()
    : `Decision submitted from Access Review UI: ${decision}.`

  return {
    ok: true,
    value: {
      request,
      decision,
      comment,
      confirmed: value.confirmed === true,
      destructiveActionsEnabled: value.destructiveActionsEnabled === true,
      redactionEnabled: value.redactionEnabled !== false,
      saviyntUsername: typeof value.saviyntUsername === 'string' ? value.saviyntUsername : undefined,
      saviyntPassword: typeof value.saviyntPassword === 'string' ? value.saviyntPassword : undefined,
    },
  }
}

function normalizeDecision(value: unknown): ReviewDecision | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (normalized === 'approve' || normalized === 'reject') {
    return normalized
  }
  return null
}

function normalizePendingRequest(value: unknown): McpPendingRequest | null {
  if (!isRecord(value)) return null

  const requestid = toStringValue(value.requestid)
  const requestkey = toStringValue(value.requestkey)

  if (!requestid && !requestkey) return null

  return {
    requestid: requestid || requestkey || 'N/A',
    requestkey: requestkey || requestid || '',
    requestedfor: toStringValue(value.requestedfor) || 'Unknown User',
    requestedby: toStringValue(value.requestedby) || 'Unknown Requestor',
    requesttype: toStringValue(value.requesttype) || 'Access Request',
    requestsubmittedon: toStringValue(value.requestsubmittedon) || '',
    duedate: toStringValue(value.duedate) || '',
    requestcomments: toStringValue(value.requestcomments) || '',
    endpoint: toStringValue(value.endpoint) || toStringValue(value.securitysystem) || '',
    securitysystem: toStringValue(value.securitysystem) || '',
    aiRiskAnalysis: toStringValue(value.aiRiskAnalysis) || undefined,
    aiRiskLevel: normalizeRiskLevel(value.aiRiskLevel),
  }
}

function normalizeRiskLevel(value: unknown): McpPendingRequest['aiRiskLevel'] {
  if (value === 'low' || value === 'medium' || value === 'high') return value
  return undefined
}

function buildDecisionArgs(
  toolSchema: McpToolSchema | undefined,
  request: McpPendingRequest,
  decision: ReviewDecision,
  comment: string
): Record<string, unknown> {
  const properties = getToolInputProperties(toolSchema)
  const hasSchemaProperties = Object.keys(properties).length > 0
  const args: Record<string, unknown> = {}

  const requestFieldLookup: Record<string, string> = {
    requestid: request.requestid,
    requestkey: request.requestkey,
    requestedfor: request.requestedfor,
    requestedby: request.requestedby,
    requesttype: request.requesttype,
    requestsubmittedon: request.requestsubmittedon,
    duedate: request.duedate,
    requestcomments: request.requestcomments,
    endpoint: request.endpoint || '',
    securitysystem: request.securitysystem || '',
  }

  for (const [fieldName, fieldSchema] of Object.entries(properties)) {
    const lowerField = fieldName.toLowerCase()
    const directFieldValue = requestFieldLookup[lowerField]

    if (directFieldValue) {
      args[fieldName] = directFieldValue
      continue
    }

    if (lowerField.includes('requestkey') || lowerField === 'key') {
      args[fieldName] = request.requestkey || request.requestid
      continue
    }

    if (lowerField.includes('requestid')) {
      args[fieldName] = request.requestid || request.requestkey
      continue
    }

    if (isDecisionField(lowerField)) {
      args[fieldName] = resolveDecisionValue(fieldSchema, decision)
      continue
    }

    if (isCommentField(lowerField)) {
      args[fieldName] = comment
      continue
    }
  }

  if (!hasSchemaProperties) {
    args.requestkey = request.requestkey || request.requestid
    args.requestid = request.requestid
    args.action = decision
    args.decision = decision
    args.comments = comment
    return args
  }

  if (!hasDecisionArg(args)) {
    args.action = decision
  }

  if (!hasRequestArg(args)) {
    args.requestkey = request.requestkey || request.requestid
  }

  return args
}

function getToolInputProperties(toolSchema: McpToolSchema | undefined): Record<string, Record<string, unknown>> {
  const inputSchema = toolSchema?.inputSchema
  if (!isRecord(inputSchema)) return {}

  const properties = inputSchema.properties
  if (!isRecord(properties)) return {}

  const output: Record<string, Record<string, unknown>> = {}

  for (const [key, rawValue] of Object.entries(properties)) {
    if (!isRecord(rawValue)) continue
    output[key] = rawValue
  }

  return output
}

function resolveDecisionValue(
  fieldSchema: Record<string, unknown>,
  decision: ReviewDecision
): string | boolean {
  const fieldType = typeof fieldSchema.type === 'string' ? fieldSchema.type.toLowerCase() : ''
  if (fieldType === 'boolean') {
    return decision === 'approve'
  }

  const enumValues = Array.isArray(fieldSchema.enum)
    ? fieldSchema.enum.filter((item): item is string => typeof item === 'string')
    : []

  if (enumValues.length > 0) {
    const candidates = decision === 'approve'
      ? ['approve', 'approved', 'accept', 'accepted', 'grant', 'granted', 'allow', 'allowed', 'yes', 'true']
      : ['reject', 'rejected', 'deny', 'denied', 'decline', 'declined', 'block', 'blocked', 'no', 'false']

    for (const candidate of candidates) {
      const match = enumValues.find((value) => value.toLowerCase() === candidate)
      if (match) return match
    }

    return enumValues[0]
  }

  return decision
}

function hasDecisionArg(args: Record<string, unknown>): boolean {
  return Object.keys(args).some((key) => isDecisionField(key.toLowerCase()))
}

function hasRequestArg(args: Record<string, unknown>): boolean {
  return Object.keys(args).some((key) => {
    const lower = key.toLowerCase()
    return lower.includes('requestid') || lower.includes('requestkey') || lower === 'key'
  })
}

function isDecisionField(fieldName: string): boolean {
  return (
    fieldName.includes('decision') ||
    fieldName.includes('action') ||
    fieldName.includes('status') ||
    fieldName.includes('disposition') ||
    fieldName.includes('approve') ||
    fieldName.includes('reject')
  )
}

function isCommentField(fieldName: string): boolean {
  return (
    fieldName.includes('comment') ||
    fieldName.includes('reason') ||
    fieldName.includes('note') ||
    fieldName.includes('remark')
  )
}

function toStringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
