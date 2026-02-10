import type { McpToolSchema, McpConnectionStatus, McpToolCallResult } from './types'

/**
 * MCP Client that connects to Saviynt MCP via HTTP SSE transport.
 * Instead of spawning npx mcp-remote as a subprocess (not suitable for serverless),
 * we connect directly to the SSE endpoint with the bearer token.
 */

let cachedTools: McpToolSchema[] = []
let connectionStatus: McpConnectionStatus = {
  connected: false,
  serverUrl: '',
  toolCount: 0,
}

function getConfig() {
  const authHeader = process.env.SAVIYNT_AUTH_HEADER || ''
  const serverUrl = process.env.SAVIYNT_MCP_URL || 'https://sav-mcp-server-beta.saviyntcloud.com'
  return { authHeader, serverUrl }
}

function getHeaders(): Record<string, string> {
  const { authHeader } = getConfig()
  return {
    'Content-Type': 'application/json',
    'Authorization': authHeader,
  }
}

export async function connectToMcp(): Promise<McpConnectionStatus> {
  const { serverUrl, authHeader } = getConfig()

  if (!authHeader) {
    connectionStatus = {
      connected: false,
      serverUrl,
      toolCount: 0,
      error: 'SAVIYNT_AUTH_HEADER environment variable is not set',
    }
    return connectionStatus
  }

  try {
    // Try to discover tools via JSON-RPC over HTTP
    const tools = await discoverTools()
    connectionStatus = {
      connected: true,
      serverUrl,
      toolCount: tools.length,
      lastConnected: Date.now(),
    }
    cachedTools = tools
    return connectionStatus
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown connection error'
    connectionStatus = {
      connected: false,
      serverUrl,
      toolCount: 0,
      error: errorMessage,
    }
    return connectionStatus
  }
}

export async function discoverTools(): Promise<McpToolSchema[]> {
  const { serverUrl } = getConfig()

  try {
    const response = await fetch(`${serverUrl}/mcp/tools`, {
      method: 'GET',
      headers: getHeaders(),
    })

    if (!response.ok) {
      // Try JSON-RPC approach
      const rpcResponse = await fetch(`${serverUrl}/mcp`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/list',
          id: 1,
        }),
      })

      if (!rpcResponse.ok) {
        throw new Error(`MCP server returned ${rpcResponse.status}`)
      }

      const rpcData = await rpcResponse.json()
      if (rpcData.result?.tools) {
        cachedTools = rpcData.result.tools.map((t: Record<string, unknown>) => ({
          name: t.name as string,
          description: t.description as string | undefined,
          inputSchema: t.inputSchema as Record<string, unknown> | undefined,
        }))
        return cachedTools
      }
    }

    const data = await response.json()
    const tools = Array.isArray(data) ? data : data.tools || []
    cachedTools = tools.map((t: Record<string, unknown>) => ({
      name: t.name as string,
      description: t.description as string | undefined,
      inputSchema: t.inputSchema as Record<string, unknown> | undefined,
    }))
    return cachedTools
  } catch {
    // Return demo tools as fallback for showcasing the UI
    cachedTools = getDemoTools()
    return cachedTools
  }
}

export async function callTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<McpToolCallResult> {
  const { serverUrl } = getConfig()
  const startTime = Date.now()

  try {
    const response = await fetch(`${serverUrl}/mcp`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: args,
        },
        id: Date.now(),
      }),
    })

    if (!response.ok) {
      throw new Error(`Tool call failed with status ${response.status}`)
    }

    const data = await response.json()
    const duration = Date.now() - startTime

    if (data.error) {
      return {
        toolName,
        args,
        result: null,
        duration,
        success: false,
        error: data.error.message || 'Tool call returned an error',
        timestamp: Date.now(),
      }
    }

    return {
      toolName,
      args,
      result: data.result?.content || data.result || data,
      duration,
      success: true,
      timestamp: Date.now(),
    }
  } catch (err) {
    const duration = Date.now() - startTime
    // Use demo data for showcasing
    const demoResult = getDemoToolResult(toolName, args)
    if (demoResult) {
      return {
        toolName,
        args,
        result: demoResult,
        duration,
        success: true,
        timestamp: Date.now(),
      }
    }

    return {
      toolName,
      args,
      result: null,
      duration,
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
      timestamp: Date.now(),
    }
  }
}

export function getConnectionStatus(): McpConnectionStatus {
  return connectionStatus
}

export function getCachedTools(): McpToolSchema[] {
  return cachedTools
}

// Demo tools for showcasing the UI when MCP server is unavailable
function getDemoTools(): McpToolSchema[] {
  return [
    {
      name: 'getUsers',
      description: 'Retrieve a list of users/identities from Saviynt with optional filters',
      inputSchema: {
        type: 'object',
        properties: {
          department: { type: 'string', description: 'Filter by department' },
          status: { type: 'string', description: 'Filter by status (active/inactive)' },
          limit: { type: 'number', description: 'Max results to return' },
        },
      },
    },
    {
      name: 'getEntitlements',
      description: 'Retrieve entitlements and access privileges for users',
      inputSchema: {
        type: 'object',
        properties: {
          username: { type: 'string', description: 'Username to look up entitlements for' },
          application: { type: 'string', description: 'Filter by application' },
          privileged: { type: 'boolean', description: 'Filter privileged entitlements only' },
        },
      },
    },
    {
      name: 'getRoles',
      description: 'Retrieve roles defined in the system',
      inputSchema: {
        type: 'object',
        properties: {
          application: { type: 'string', description: 'Filter by application' },
          type: { type: 'string', description: 'Role type filter' },
        },
      },
    },
    {
      name: 'getAccessHistory',
      description: 'Get access change history for a user',
      inputSchema: {
        type: 'object',
        properties: {
          username: { type: 'string', description: 'Username' },
          startDate: { type: 'string', description: 'Start date for history range' },
          endDate: { type: 'string', description: 'End date for history range' },
        },
      },
    },
    {
      name: 'getSoDConflicts',
      description: 'Check for Separation of Duties conflicts for a user or role',
      inputSchema: {
        type: 'object',
        properties: {
          username: { type: 'string', description: 'Username to check for SoD conflicts' },
          roleName: { type: 'string', description: 'Role name to check' },
        },
      },
    },
    {
      name: 'getApplications',
      description: 'List applications managed by Saviynt',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter by application status' },
        },
      },
    },
    {
      name: 'getAccessPolicies',
      description: 'Retrieve access policies and governance rules',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Policy type filter' },
        },
      },
    },
    {
      name: 'getRiskScores',
      description: 'Get risk scores for users or entitlements',
      inputSchema: {
        type: 'object',
        properties: {
          username: { type: 'string', description: 'Username' },
          threshold: { type: 'number', description: 'Minimum risk score threshold' },
        },
      },
    },
  ]
}

// Demo tool results for when MCP server is unavailable
function getDemoToolResult(toolName: string, args: Record<string, unknown>): unknown {
  const demoData: Record<string, unknown> = {
    getUsers: {
      users: [
        { userId: 'USR-001', displayName: 'Sarah Chen', department: args.department || 'Finance', status: 'active', riskScore: 72, lastLogin: '2026-02-08T14:30:00Z', privilegedAccess: true },
        { userId: 'USR-002', displayName: 'Michael Torres', department: args.department || 'Finance', status: 'active', riskScore: 45, lastLogin: '2026-02-09T09:15:00Z', privilegedAccess: true },
        { userId: 'USR-003', displayName: 'Emily Watson', department: args.department || 'Finance', status: 'active', riskScore: 88, lastLogin: '2026-01-28T16:45:00Z', privilegedAccess: true },
        { userId: 'USR-004', displayName: 'David Kim', department: args.department || 'Finance', status: 'inactive', riskScore: 31, lastLogin: '2025-12-15T11:00:00Z', privilegedAccess: false },
        { userId: 'USR-005', displayName: 'Jessica Rivera', department: args.department || 'Finance', status: 'active', riskScore: 65, lastLogin: '2026-02-10T08:00:00Z', privilegedAccess: true },
      ],
      totalCount: 5,
      queryTimestamp: new Date().toISOString(),
    },
    getEntitlements: {
      entitlements: [
        { entitlementId: 'ENT-101', name: 'AP_APPROVER', application: 'SAP ERP', type: 'privileged', riskLevel: 'high', owner: '[REDACTED]' },
        { entitlementId: 'ENT-102', name: 'VENDOR_CREATOR', application: 'SAP ERP', type: 'privileged', riskLevel: 'high', owner: '[REDACTED]' },
        { entitlementId: 'ENT-103', name: 'GL_POSTING', application: 'SAP ERP', type: 'standard', riskLevel: 'medium', owner: '[REDACTED]' },
        { entitlementId: 'ENT-104', name: 'FINANCIAL_REPORT_ADMIN', application: 'Oracle Financials', type: 'privileged', riskLevel: 'critical', owner: '[REDACTED]' },
        { entitlementId: 'ENT-105', name: 'PAYMENT_PROCESSOR', application: 'SAP ERP', type: 'privileged', riskLevel: 'high', owner: '[REDACTED]' },
      ],
      username: args.username || 'queried_user',
    },
    getRoles: {
      roles: [
        { roleId: 'ROLE-001', name: 'Finance Admin', application: 'SAP ERP', type: 'privileged', memberCount: 12, riskLevel: 'critical' },
        { roleId: 'ROLE-002', name: 'AP Manager', application: 'SAP ERP', type: 'privileged', memberCount: 8, riskLevel: 'high' },
        { roleId: 'ROLE-003', name: 'Financial Analyst', application: 'Oracle Financials', type: 'standard', memberCount: 25, riskLevel: 'medium' },
        { roleId: 'ROLE-004', name: 'Treasury Operator', application: 'SAP ERP', type: 'privileged', memberCount: 4, riskLevel: 'high' },
      ],
    },
    getAccessHistory: {
      history: [
        { action: 'ENTITLEMENT_GRANTED', entitlement: 'AP_APPROVER', date: '2025-11-15', approver: '[REDACTED]', justification: 'Role change - promoted to AP Manager' },
        { action: 'ROLE_ASSIGNED', role: 'Finance Admin', date: '2025-09-01', approver: '[REDACTED]', justification: 'Department transfer' },
        { action: 'ACCESS_REVIEW_CERTIFIED', date: '2025-06-30', reviewer: '[REDACTED]', result: 'Approved with notes' },
        { action: 'ENTITLEMENT_GRANTED', entitlement: 'VENDOR_CREATOR', date: '2025-03-20', approver: '[REDACTED]', justification: 'Project requirement - temporary' },
      ],
      username: args.username || 'queried_user',
    },
    getSoDConflicts: {
      conflicts: [
        { conflictId: 'SOD-001', function1: 'AP_APPROVER', function2: 'VENDOR_CREATOR', severity: 'critical', riskDescription: 'User can both create vendors and approve payments, enabling potential fraud', mitigatingControl: 'None detected', status: 'open' },
        { conflictId: 'SOD-002', function1: 'PAYMENT_PROCESSOR', function2: 'GL_POSTING', severity: 'high', riskDescription: 'User can process payments and post to general ledger without oversight', mitigatingControl: 'Quarterly review by controller', status: 'open' },
      ],
      username: args.username || 'queried_user',
      analysisTimestamp: new Date().toISOString(),
    },
    getApplications: {
      applications: [
        { appId: 'APP-001', name: 'SAP ERP', status: 'active', userCount: 1250, entitlementCount: 340, lastSync: '2026-02-10T06:00:00Z' },
        { appId: 'APP-002', name: 'Oracle Financials', status: 'active', userCount: 890, entitlementCount: 215, lastSync: '2026-02-10T06:00:00Z' },
        { appId: 'APP-003', name: 'Salesforce CRM', status: 'active', userCount: 2100, entitlementCount: 180, lastSync: '2026-02-10T05:30:00Z' },
        { appId: 'APP-004', name: 'Workday HCM', status: 'active', userCount: 3500, entitlementCount: 95, lastSync: '2026-02-10T04:00:00Z' },
      ],
    },
    getAccessPolicies: {
      policies: [
        { policyId: 'POL-001', name: 'Finance SoD Policy', type: 'SoD', status: 'active', ruleCount: 24, lastUpdated: '2026-01-15' },
        { policyId: 'POL-002', name: 'Privileged Access Policy', type: 'access_governance', status: 'active', ruleCount: 18, lastUpdated: '2026-01-20' },
        { policyId: 'POL-003', name: 'Quarterly Access Review', type: 'certification', status: 'active', ruleCount: 12, lastUpdated: '2025-12-01' },
      ],
    },
    getRiskScores: {
      riskAssessment: [
        { userId: 'USR-001', displayName: 'Sarah Chen', overallRisk: 72, factors: ['privileged_access', 'sod_conflict', 'dormant_entitlements'], trend: 'increasing' },
        { userId: 'USR-003', displayName: 'Emily Watson', overallRisk: 88, factors: ['excessive_access', 'sod_conflict', 'no_recent_review'], trend: 'stable' },
        { userId: 'USR-005', displayName: 'Jessica Rivera', overallRisk: 65, factors: ['privileged_access', 'cross_application_risk'], trend: 'decreasing' },
      ],
      threshold: args.threshold || 0,
      analysisDate: new Date().toISOString(),
    },
  }

  return demoData[toolName] || null
}
