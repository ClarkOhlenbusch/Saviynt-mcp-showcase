import { getCachedTools, discoverTools, checkAndAutoConnect } from '@/lib/mcp/client'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const refresh = url.searchParams.get('refresh')

  try {
    await checkAndAutoConnect()
    const tools = refresh === 'true' ? await discoverTools() : getCachedTools()
    return Response.json({ tools })
  } catch (err) {
    return Response.json(
      { tools: [], error: err instanceof Error ? err.message : 'Failed to list tools' },
      { status: 500 }
    )
  }
}
