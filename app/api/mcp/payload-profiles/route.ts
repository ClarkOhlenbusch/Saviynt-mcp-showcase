import { getRecentMcpPayloadProfiles } from '@/lib/mcp/payload-profiler'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const limitParam = searchParams.get('limit')
  const limit = limitParam ? Number(limitParam) : 50

  return new Response(
    JSON.stringify({
      profiles: getRecentMcpPayloadProfiles(limit),
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    },
  )
}
