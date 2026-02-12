import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { appendFileSync } from 'fs'
import { join } from 'path'

const logFile = join(process.cwd(), 'debug.log')

function logError(msg: string, error: any) {
    const logEntry = `[${new Date().toISOString()}] ${msg}: ${JSON.stringify(error, null, 2)}\n`
    appendFileSync(logFile, logEntry)
}

export async function POST(req: Request) {
    try {
        const body = await req.json()
        const { key_value, label } = body

        if (!key_value) {
            return NextResponse.json({ error: 'Key value is required' }, { status: 400 })
        }

        // Insert the key. If it already exists (unique constraint), treat as success.
        const { error } = await supabase
            .from('api_keys')
            .insert([{ key_value, label }])

        if (error) {
            // Duplicate key — already stored, that's fine
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
