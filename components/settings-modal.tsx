'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Shield, Server, Eye, Wrench, RefreshCw } from 'lucide-react'
import type { McpToolSchema } from '@/lib/mcp/types'

interface SettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mcpConnected: boolean
  mcpServerUrl: string
  tools: McpToolSchema[]
  redactionEnabled: boolean
  onRedactionChange: (enabled: boolean) => void
  destructiveActionsEnabled: boolean
  onDestructiveChange: (enabled: boolean) => void
  onRefreshTools: () => void
  refreshing: boolean
}

export function SettingsModal({
  open,
  onOpenChange,
  mcpConnected,
  mcpServerUrl,
  tools,
  redactionEnabled,
  onRedactionChange,
  destructiveActionsEnabled,
  onDestructiveChange,
  onRefreshTools,
  refreshing,
}: SettingsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground">Settings</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            MCP connection and security policies.
          </DialogDescription>
        </DialogHeader>

        {/* MCP Connection */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">MCP Connection</h3>
          </div>
          <div className="rounded-lg bg-secondary/50 p-3 flex flex-col gap-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Server URL</span>
              <span className="font-mono text-xs text-foreground truncate max-w-[220px]">
                {mcpServerUrl || 'Not connected'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Status</span>
              <Badge
                variant={mcpConnected ? 'secondary' : 'destructive'}
                className={mcpConnected ? 'bg-accent/10 text-accent border-0' : ''}
              >
                {mcpConnected ? 'Connected' : 'Disconnected'}
              </Badge>
            </div>
          </div>
        </div>

        <Separator className="bg-border" />

        {/* Tools */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wrench className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Discovered Tools ({tools.length})</h3>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onRefreshTools}
              disabled={refreshing || !mcpConnected}
              className="h-7 text-xs text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className={`h-3 w-3 mr-1 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
          {tools.length > 0 ? (
            <div className="grid grid-cols-2 gap-1 max-h-32 overflow-y-auto">
              {tools.map((t) => (
                <div
                  key={t.name}
                  className="text-xs font-mono text-muted-foreground bg-secondary/30 rounded px-2 py-1 truncate"
                  title={t.description}
                >
                  {t.name}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No tools discovered. Connect to MCP first.</p>
          )}
        </div>

        <Separator className="bg-border" />

        {/* Security Policies */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Security Policies</h3>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-foreground">PII Redaction</p>
              <p className="text-xs text-muted-foreground">Redact sensitive fields in tool traces</p>
            </div>
            <Switch checked={redactionEnabled} onCheckedChange={onRedactionChange} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-foreground">Destructive Actions</p>
              <p className="text-xs text-muted-foreground">Allow write/update/delete tool calls</p>
            </div>
            <Switch checked={destructiveActionsEnabled} onCheckedChange={onDestructiveChange} />
          </div>
          {destructiveActionsEnabled && (
            <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2">
              <Eye className="h-4 w-4 text-destructive shrink-0" />
              <p className="text-xs text-destructive">
                Destructive actions enabled. Write operations will require explicit confirmation.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
