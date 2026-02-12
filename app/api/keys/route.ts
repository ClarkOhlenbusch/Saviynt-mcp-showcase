import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { appendFileSync } from 'fs'
import { join } from 'path'

const logFile = join(process.cwd(), 'debug.log')

function logError(msg: string, error: any) {
    const logEntry = `[${new Date().toISOString()}] ${msg}: ${JSON.stringify(error, null, 2)}\n`
    appendFileSync(logFile, logEntry)
}

export async function GET() {
    const { data, error } = await supabase
        .from('api_keys')
        .select('*')
        .order('created_at', { ascending: false })

    if (error) {
        logError('Supabase GET error', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ keys: data })
}

export async function POST(req: Request) {
    try {
        const body = await req.json()
        const { key_value, label } = body

        if (!key_value) {
            return NextResponse.json({ error: 'Key value is required' }, { status: 400 })
        }

        // Check if key already exists
        const { data: existingKey } = await supabase
            .from('api_keys')
            .select('*')
            .eq('key_value', key_value)
            .single()

        if (existingKey) {
            return NextResponse.json({ key: existingKey })
        }

        const { data, error } = await supabase
            .from('api_keys')
            .insert([{ key_value, label }])
            .select()

        if (error) {
            // Handle unique constraint violation just in case
            if (error.code === '23505') {
                const { data: retryKey } = await supabase
                    .from('api_keys')
                    .select('*')
                    .eq('key_value', key_value)
                    .single()
                return NextResponse.json({ key: retryKey })
            }
            logError('Supabase POST error', error)
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json({ key: data[0] })
    } catch (err) {
        logError('Critical error', err instanceof Error ? err.message : err)
        return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
    }
}
