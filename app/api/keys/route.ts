import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'

const logFile = join(process.cwd(), 'debug.log')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function logError(msg: string, error: unknown) {
  const logEntry = `[${new Date().toISOString()}] ${msg}: ${JSON.stringify(error, null, 2)}\n`
  void appendFile(logFile, logEntry).catch(() => {
    // Swallow logging failures to avoid failing API requests on disk issues.
  })
}

export async function POST(req: Request) {
  try {
    const body: unknown = await req.json()
    const parsedBody = isRecord(body) ? body : {}
    const keyValue = typeof parsedBody.key_value === 'string' ? parsedBody.key_value : ''
    const label = typeof parsedBody.label === 'string' ? parsedBody.label : null

    if (!keyValue) {
      return NextResponse.json({ error: 'Key value is required' }, { status: 400 })
    }

    // Insert the key. If it already exists (unique constraint), treat as success.
    const { error } = await supabase
      .from('api_keys')
      .insert([{ key_value: keyValue, label }])

    if (error) {
      // Duplicate key - already stored, that's fine.
      if (error.code === '23505') {
        return NextResponse.json({ success: true, duplicate: true })
      }
      logError('Supabase POST error', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    logError('Critical error', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
