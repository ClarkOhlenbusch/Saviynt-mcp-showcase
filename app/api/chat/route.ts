import { streamText, convertToModelMessages, tool, stepCountIs } from 'ai'
import { google } from '@ai-sdk/google'
import { z } from 'zod'
import { SYSTEM_PROMPT } from '@/lib/agent/prompts'
import { callTool, getCachedTools, getCachedConfig, checkAndAutoConnect } from '@/lib/mcp/client'
import { getDefaultGatewayConfig, validateToolCall } from '@/lib/mcp/tool-gateway'
import { redactDeep } from '@/lib/redaction'

export const maxDuration = 300

export async function POST(req: Request) {
  const { messages, apiKey } = await req.json()

  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Gemini API key is required (BYOK)' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const effectiveApiKey = apiKey

  // Ensure MCP is connected before gathering tools
  await checkAndAutoConnect()

  const mcpTools = getCachedTools()
  const mcpConfig = getCachedConfig()
  const gatewayConfig = getDefaultGatewayConfig()

  // Build the system prompt
  let systemPrompt = SYSTEM_PROMPT

  // Add available tools context to system prompt
  if (mcpTools.length > 0) {
    systemPrompt += '\n\n## Available MCP Tools\n\n'
    systemPrompt += 'You have access to the following Saviynt MCP tools. Use them to gather real data:\n\n'
    for (const t of mcpTools) {
      systemPrompt += `- **${t.name}**: ${t.description || 'No description'}\n`
    }
    systemPrompt += '\nCall these tools when you need identity data. Always call tools before making assertions about users, access, or risk.'
  }

  // Dynamically build AI SDK tools from MCP tool schemas
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const aiTools: Record<string, any> = {}

  for (const mcpTool of mcpTools) {
    const validation = validateToolCall(mcpTool.name, {}, mcpTool, gatewayConfig)
    if (!validation.valid) continue

    // Build a zod schema from the MCP tool's input schema
    const inputSchema = buildZodSchema(mcpTool.inputSchema)

    aiTools[mcpTool.name] = tool({
      description: mcpTool.description || `MCP tool: ${mcpTool.name}`,
      inputSchema,
      execute: async (args) => {
        const result = await callTool(mcpTool.name, args as Record<string, unknown>, mcpConfig || undefined)
        if (!result.success) {
          return { error: result.error, toolName: mcpTool.name }
        }
        // Redact sensitive data before returning to LLM
        const redactedResult = redactDeep(result.result, gatewayConfig.redactionEnabled)
        return {
          toolName: mcpTool.name,
          data: redactedResult,
          duration: result.duration,
        }
      },
    })
  }

  // Initialize model provider
  const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
  const modelProvider = createGoogleGenerativeAI({
    apiKey: effectiveApiKey,
  })

  const result = streamText({
    model: modelProvider('gemini-3-flash-preview'),

    system: systemPrompt,
    messages: await convertToModelMessages(messages),
    tools: aiTools,
    stopWhen: stepCountIs(5),
  })

  return result.toUIMessageStreamResponse()
}

// Convert MCP JSON schema to zod schema
function buildZodSchema(inputSchema?: Record<string, unknown>): z.ZodObject<Record<string, z.ZodTypeAny>> {
  if (!inputSchema || !inputSchema.properties) {
    return z.object({})
  }

  const properties = inputSchema.properties as Record<string, Record<string, unknown>>
  const shape: Record<string, z.ZodTypeAny> = {}

  for (const [key, prop] of Object.entries(properties)) {
    let fieldSchema: z.ZodTypeAny

    switch (prop.type) {
      case 'string':
        fieldSchema = z.string().describe((prop.description as string) || key)
        break
      case 'number':
      case 'integer':
        fieldSchema = z.number().describe((prop.description as string) || key)
        break
      case 'boolean':
        fieldSchema = z.boolean().describe((prop.description as string) || key)
        break
      default:
        fieldSchema = z.string().describe((prop.description as string) || key)
    }

    // Make all fields nullable for OpenAI compatibility
    shape[key] = fieldSchema.nullable()
  }

  return z.object(shape)
}
