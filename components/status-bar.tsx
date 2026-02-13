'use client'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { Wifi, WifiOff, Cpu } from 'lucide-react'
import type { GeminiUsageSnapshot } from '@/lib/gemini-usage'

interface StatusBarProps {
  mcpConnected: boolean
  mcpToolCount: number
  llmProvider: string
  usage: GeminiUsageSnapshot
}

function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  return `${value}`
}

export function StatusBar({ mcpConnected, mcpToolCount, llmProvider, usage }: StatusBarProps) {
  const tpmRatio = usage.limits.tpm > 0 ? usage.minuteTokens / usage.limits.tpm : 0
  const rpmRatio = usage.limits.rpm > 0 ? usage.minuteRequests / usage.limits.rpm : 0
  const rpdRatio = usage.limits.rpd > 0 ? usage.dayRequests / usage.limits.rpd : 0
  const maxRatio = Math.max(tpmRatio, rpmRatio, rpdRatio)

  const usageTone = maxRatio >= 0.95
    ? 'text-destructive'
    : maxRatio >= 0.75
      ? 'text-amber-600'
      : 'text-muted-foreground'

  const usageTitle = [
    `${formatCompact(usage.minuteTokens)}/${formatCompact(usage.limits.tpm)} TPM (input)`,
    `${usage.minuteRequests}/${usage.limits.rpm} RPM`,
    `${usage.dayRequests}/${usage.limits.rpd} RPD`,
    `${formatCompact(usage.totalTokens)} total tracked tokens`,
  ].join(' | ')

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
          {mcpConnected ? 'MCP Connected' : 'Disconnected'}
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
        <span className={cn('tabular-nums font-medium', usageTone)} title={usageTitle}>
          {formatCompact(usage.minuteTokens)}/{formatCompact(usage.limits.tpm)} TPM(in)
        </span>
        <span className={cn('hidden lg:inline tabular-nums', usageTone)} title={usageTitle}>
          {usage.minuteRequests}/{usage.limits.rpm} RPM
        </span>
        <span className={cn('hidden xl:inline tabular-nums', usageTone)} title={usageTitle}>
          {usage.dayRequests}/{usage.limits.rpd} RPD
        </span>
      </div>
    </div>
  )
}
