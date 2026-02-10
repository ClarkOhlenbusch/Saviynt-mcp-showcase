'use client'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { Wifi, WifiOff, Cpu, Shield } from 'lucide-react'

interface StatusBarProps {
  mcpConnected: boolean
  mcpToolCount: number
  llmProvider: string
  demoMode: boolean
}

export function StatusBar({ mcpConnected, mcpToolCount, llmProvider, demoMode }: StatusBarProps) {
  return (
    <div className="flex items-center gap-3 text-xs">
      <div className="flex items-center gap-1.5">
        {mcpConnected ? (
          <Wifi className="h-3 w-3 text-accent" />
        ) : (
          <WifiOff className="h-3 w-3 text-destructive" />
        )}
        <span className={cn(
          'font-medium',
          mcpConnected ? 'text-accent' : 'text-destructive'
        )}>
          {mcpConnected ? `MCP Connected` : 'Disconnected'}
        </span>
        {mcpConnected && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 bg-secondary text-secondary-foreground">
            {mcpToolCount} tools
          </Badge>
        )}
      </div>
      <div className="h-3 w-px bg-border" />
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Cpu className="h-3 w-3" />
        <span>{llmProvider}</span>
      </div>
      {demoMode && (
        <>
          <div className="h-3 w-px bg-border" />
          <div className="flex items-center gap-1.5">
            <Shield className="h-3 w-3 text-primary" />
            <span className="text-primary font-medium">Demo Mode</span>
          </div>
        </>
      )}
    </div>
  )
}
