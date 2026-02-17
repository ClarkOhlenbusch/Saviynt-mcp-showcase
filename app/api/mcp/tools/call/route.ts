import { callTool, checkAndAutoConnect, getCachedTools } from '@/lib/mcp/client'
import { getDefaultGatewayConfig, validateToolCall } from '@/lib/mcp/tool-gateway'

export async function POST(req: Request) {
  try {
    const body: unknown = await req.json()
    const payload = isRecord(body) ? body : {}
    const toolName = typeof payload.toolName === 'string' ? payload.toolName : ''
    const args = isRecord(payload.args) ? payload.args : {}
    const destructiveActionsEnabled = payload.destructiveActionsEnabled === true
    const redactionEnabled = payload.redactionEnabled !== false
    const confirmed = payload.confirmed === true

    if (!toolName) {
      return Response.json({ error: 'toolName is required' }, { status: 400 })
    }

    await checkAndAutoConnect()
    const toolSchema = getCachedTools().find((tool) => tool.name === toolName)
    const gatewayConfig = {
      ...getDefaultGatewayConfig(),
      destructiveActionsEnabled,
      redactionEnabled,
    }

    const validation = validateToolCall(toolName, args, toolSchema, gatewayConfig)
    if (!validation.valid) {
      return Response.json({ success: false, error: validation.error }, { status: 403 })
    }

    if (validation.requiresConfirmation && !confirmed) {
      return Response.json(
        { success: false, error: 'Explicit confirmation is required for destructive tool calls.' },
        { status: 400 }
      )
    }

    const result = await callTool(toolName, args)

    return Response.json(result)
  } catch (err) {
    return Response.json(
      { success: false, error: err instanceof Error ? err.message : 'Failed to call tool' },
      { status: 500 }
    )
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
