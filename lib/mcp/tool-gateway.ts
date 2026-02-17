import type { McpToolSchema, ToolTrace } from './types'
import { redactDeep, truncatePreview } from '../redaction'

const DEFAULT_DENYLIST = [
  'create',
  'update',
  'delete',
  'remove',
  'modify',
  'set',
  'assign',
  'approve',
  'reject',
  'revoke',
  'provision',
  'deprovision',
  'disable',
  'enable',
  'terminate',
  'reset',
]

export interface ToolGatewayConfig {
  destructiveActionsEnabled: boolean
  redactionEnabled: boolean
  denylistPatterns: string[]
  allowlist: string[] | null // null = allow all (non-denied)
}

export function getDefaultGatewayConfig(): ToolGatewayConfig {
  return {
    destructiveActionsEnabled: false,
    redactionEnabled: true,
    denylistPatterns: DEFAULT_DENYLIST,
    allowlist: null,
  }
}

function isDestructiveTool(toolName: string, denylistPatterns: string[]): boolean {
  const lower = toolName.toLowerCase()
  return denylistPatterns.some((pattern) => lower.includes(pattern.toLowerCase()))
}

export function filterAllowedTools(
  tools: McpToolSchema[],
  config: ToolGatewayConfig
): McpToolSchema[] {
  return tools.filter((t) => {
    if (!config.destructiveActionsEnabled && isDestructiveTool(t.name, config.denylistPatterns)) {
      return false
    }
    if (config.allowlist) {
      return config.allowlist.includes(t.name)
    }
    return true
  })
}

export function createToolTrace(
  toolName: string,
  args: Record<string, unknown>,
  result: unknown,
  duration: number,
  success: boolean,
  error: string | undefined,
  config: ToolGatewayConfig
): ToolTrace {
  return {
    id: `trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    toolName,
    args,
    argsRedacted: redactDeep(args, config.redactionEnabled) as Record<string, unknown>,
    responsePreview: truncatePreview(
      redactDeep(result, config.redactionEnabled),
      500
    ),
    duration,
    success,
    error,
    timestamp: Date.now(),
  }
}

export function validateToolCall(
  toolName: string,
  args: Record<string, unknown>,
  schema: McpToolSchema | undefined,
  config: ToolGatewayConfig
): { valid: boolean; error?: string; requiresConfirmation?: boolean } {
  if (!schema) {
    return { valid: false, error: `Tool "${toolName}" not found in discovered tools` }
  }

  if (!config.destructiveActionsEnabled && isDestructiveTool(toolName, config.denylistPatterns)) {
    return {
      valid: false,
      error: `Tool "${toolName}" is blocked by destructive action policy. Enable destructive actions in settings to use this tool.`,
    }
  }

  // If destructive actions are enabled but tool is destructive, require confirmation
  if (config.destructiveActionsEnabled && isDestructiveTool(toolName, config.denylistPatterns)) {
    return { valid: true, requiresConfirmation: true }
  }

  return { valid: true }
}
