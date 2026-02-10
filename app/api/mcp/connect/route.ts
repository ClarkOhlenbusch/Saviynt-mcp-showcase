import { connectToMcp, getConnectionStatus } from '@/lib/mcp/client'

export async function POST() {
  try {
    const status = await connectToMcp()
    return Response.json(status)
  } catch (err) {
    return Response.json(
      {
        connected: false,
        serverUrl: '',
        toolCount: 0,
        error: err instanceof Error ? err.message : 'Connection failed',
      },
      { status: 500 }
    )
  }
}

export async function GET() {
  const status = getConnectionStatus()
  return Response.json(status)
}
