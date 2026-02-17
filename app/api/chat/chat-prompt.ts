import { asString } from './chat-shared'
import type { PendingRequestSnapshot } from './chat-context'

type BuildSystemPromptParams = {
  basePrompt: string
  selectedRequest: Record<string, unknown> | null
  pendingRequestsSnapshot: PendingRequestSnapshot[]
  pendingRequestsSnapshotUpdatedAt: number
  mcpToolCount: number
  destructiveActionsEnabled: boolean
}

export function buildSystemPrompt({
  basePrompt,
  selectedRequest,
  pendingRequestsSnapshot,
  pendingRequestsSnapshotUpdatedAt,
  mcpToolCount,
  destructiveActionsEnabled,
}: BuildSystemPromptParams): string {
  let systemPrompt = basePrompt

  if (selectedRequest) {
    systemPrompt += '\n\n## ACTIVE ACCESS REVIEW CONTEXT\n'
    systemPrompt += 'You are currently assisting in an agentic access review for a SPECIFIC pending request.\n'
    systemPrompt += `**Request ID:** ${asString(selectedRequest.requestid)}\n`

    const requestKey = asString(selectedRequest.requestkey)
    if (requestKey) {
      systemPrompt += `**Request Key:** ${requestKey}\n`
    }

    systemPrompt += `**Requested For:** ${asString(selectedRequest.requestedfor)}\n`
    systemPrompt += `**Request Type:** ${asString(selectedRequest.requesttype)}\n`
    systemPrompt += `**Target Resource:** ${asString(selectedRequest.endpoint) || asString(selectedRequest.securitysystem) || 'N/A'}\n`
    systemPrompt += `**Request Comments:** ${asString(selectedRequest.requestcomments)}\n`

    const aiRiskAnalysis = asString(selectedRequest.aiRiskAnalysis)
    if (aiRiskAnalysis) {
      systemPrompt += `**Preliminary AI Risk Analysis:** ${aiRiskAnalysis}\n`
    }

    systemPrompt += '\n**YOUR MISSION:**\n'
    systemPrompt += '1. Help the reviewer decide whether to approve or reject this specific request.\n'
    systemPrompt += '2. Use MCP tools (like `get_complete_access_path`, `get_user_roles`, etc.) to investigate the user\'s current access and identify potential risks or justifications.\n'
    systemPrompt += '3. Be objective. If you find risks (like SoD conflicts), highlight them clearly.\n'
    if (destructiveActionsEnabled) {
      systemPrompt += '4. If the reviewer explicitly decides, you may use `approve_reject_entire_request` to finalize the action.\n'
    } else {
      systemPrompt += '4. Do not execute approval/rejection actions because destructive tools are disabled in this session. Recommend next steps instead.\n'
    }
  }

  if (pendingRequestsSnapshot.length > 0) {
    systemPrompt += '\n\n## PROGRAMMATIC PENDING REVIEW SNAPSHOT\n'
    if (pendingRequestsSnapshotUpdatedAt > 0) {
      systemPrompt += `Snapshot timestamp (epoch ms): ${pendingRequestsSnapshotUpdatedAt}\n`
    }
    systemPrompt += 'The app pre-fetched pending requests programmatically (outside LLM tool calls):\n'
    for (const item of pendingRequestsSnapshot) {
      const due = item.duedate || 'N/A'
      const endpoint = item.endpoint || 'N/A'
      systemPrompt += `- ${item.requestid} | ${item.requestedfor} | ${item.requesttype} | ${endpoint} | due ${due}\n`
    }
    systemPrompt += 'Use this snapshot first for queue/list questions to save tokens.\n'
    systemPrompt += 'Only call `get_list_of_pending_requests_for_approver` when the user explicitly asks for a live refresh/re-check or the snapshot is insufficient.\n'
  }

  if (mcpToolCount > 0) {
    systemPrompt += '\n\n## MCP Tool Access\n'
    systemPrompt += `You currently have ${mcpToolCount} Saviynt MCP tools available through function calling.`
    systemPrompt += '\nCall these tools when you need identity data. Always call tools before making assertions about users, access, or risk.'
    systemPrompt += '\nWhen multiple independent MCP lookups are needed, prefer the `mcp_parallel` tool to run calls concurrently and then reason on the combined results.'
    if (!destructiveActionsEnabled) {
      systemPrompt += '\nDestructive/write tools are disabled for this session by policy.'
    }
  }

  return systemPrompt
}
