import { connectToMcp, getConnectionStatus } from '@/lib/mcp/client'
import type { McpServerConfig } from '@/lib/mcp/types'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const config: McpServerConfig = {
      serverUrl: body.serverUrl || '',
      authHeader: body.authHeader || '',
    }

    const status = await connectToMcp(config)
    return Response.json(status)
  } catch (err) {
    return Response.json(
      {
        connected: false,
        serverUrl: '',
        toolCount: 0,
        error: err instanceof Error ? err.message : 'Connection failed',
      },
      { status: 500 },
    )
  }
}

export async function GET() {
  const status = getConnectionStatus()
  return Response.json(status)
}
