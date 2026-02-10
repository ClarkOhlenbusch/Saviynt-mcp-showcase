'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Zap, AlertCircle } from 'lucide-react'

interface McpConfigDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnect: (serverUrl: string, authHeader: string) => void
  connecting: boolean
}

const PLACEHOLDER = `{
  "mcpServers": {
    "saviynt-mcp": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://your-server.saviyntcloud.com/sse",
        "--header",
        "Authorization:\${AUTH_HEADER}"
      ],
      "env": {
        "AUTH_HEADER": "Bearer your-token-here"
      }
    }
  }
}`

export function McpConfigDialog({ open, onOpenChange, onConnect, connecting }: McpConfigDialogProps) {
  const [configText, setConfigText] = useState('')
  const [error, setError] = useState('')

  function handleConnect() {
    setError('')

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(configText)
    } catch {
      setError('Invalid JSON. Please paste a valid MCP configuration.')
      return
    }

    // Extract server URL and auth from the MCP config format
    const mcpServers = parsed.mcpServers as Record<string, Record<string, unknown>> | undefined
    if (!mcpServers) {
      setError('Missing "mcpServers" key. Expected standard MCP configuration format.')
      return
    }

    // Get the first server entry
    const serverKey = Object.keys(mcpServers)[0]
    if (!serverKey) {
      setError('No server found in "mcpServers".')
      return
    }

    const server = mcpServers[serverKey]
    const args = server.args as string[] | undefined
    const env = server.env as Record<string, string> | undefined

    // Extract the SSE URL from args -- look for a URL pattern
    let serverUrl = ''
    if (args) {
      for (const arg of args) {
        if (arg.startsWith('http://') || arg.startsWith('https://')) {
          serverUrl = arg
          break
        }
      }
    }

    if (!serverUrl) {
      setError('Could not find a server URL in the args. Expected an https:// URL.')
      return
    }

    // Extract auth header from env + args
    // Look for --header arg and resolve env vars
    let authHeader = ''
    if (args) {
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--header' && args[i + 1]) {
          let headerVal = args[i + 1]
          // Resolve ${VAR} references from env
          if (env) {
            headerVal = headerVal.replace(/\$\{(\w+)\}/g, (_, varName) => {
              return env[varName] || ''
            })
          }
          // Parse "Authorization:VALUE" format
          if (headerVal.startsWith('Authorization:')) {
            authHeader = headerVal.slice('Authorization:'.length)
          } else {
            authHeader = headerVal
          }
          break
        }
      }
    }

    // Remove /sse suffix from server URL for HTTP API calls
    const baseUrl = serverUrl.replace(/\/sse\/?$/, '')

    onConnect(baseUrl, authHeader)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            Connect MCP Server
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Paste your MCP server configuration JSON below. This is the same format used by Claude Desktop, Cursor, and other MCP clients.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <textarea
            value={configText}
            onChange={(e) => {
              setConfigText(e.target.value)
              setError('')
            }}
            placeholder={PLACEHOLDER}
            className="w-full h-56 resize-none rounded-lg border border-border bg-secondary/30 text-foreground font-mono text-xs px-3 py-3 focus:outline-none focus:ring-1 focus:ring-primary transition-colors placeholder:text-muted-foreground/40"
            spellCheck={false}
          />

          {error && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2">
              <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}

          <Button
            onClick={handleConnect}
            disabled={!configText.trim() || connecting}
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {connecting ? (
              <>
                <div className="h-3.5 w-3.5 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin mr-2" />
                Connecting...
              </>
            ) : (
              <>
                <Zap className="h-3.5 w-3.5 mr-2" />
                Connect
              </>
            )}
          </Button>

          <p className="text-[10px] text-muted-foreground text-center">
            The config is parsed locally. Only the server URL and auth token are sent to the backend to establish the connection.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
