'use client'

import React from 'react'
import { Shield, AlertTriangle, UserPlus, ShieldCheck, ListChecks, MessageSquareWarning } from 'lucide-react'
import { DEMO_PROMPTS, type DemoPromptCard } from '@/lib/agent/prompts'
import { cn } from '@/lib/utils'

interface DemoPromptsProps {
  onSelect: (prompt: string) => void
  visible: boolean
  prompts?: DemoPromptCard[]
  title?: string
  description?: string
}

const iconMap: Record<string, React.ReactNode> = {
  'shield': <Shield className="h-5 w-5" />,
  'alert-triangle': <AlertTriangle className="h-5 w-5" />,
  'user-plus': <UserPlus className="h-5 w-5" />,
  'shield-check': <ShieldCheck className="h-5 w-5" />,
  'list-checks': <ListChecks className="h-5 w-5" />,
  'message-square-warning': <MessageSquareWarning className="h-5 w-5" />,
}

export function DemoPrompts({
  onSelect,
  visible,
  prompts = DEMO_PROMPTS,
  title = 'Identity Security Agent',
  description = 'Try one of these scenarios or type your own question below.',
}: DemoPromptsProps) {
  if (!visible) return null

  return (
    <div className="flex flex-col items-center gap-6 py-8">
      <div className="text-center">
        <h2 className="text-lg font-semibold text-foreground mb-1 text-balance">{title}</h2>
        <p className="text-sm text-muted-foreground max-w-md text-pretty">
          {description}
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-2xl">
        {prompts.map((dp) => (
          <button
            key={dp.id}
            type="button"
            onClick={() => onSelect(dp.prompt)}
            className={cn(
              'flex flex-col items-start gap-3 p-4 rounded-xl border border-border',
              'bg-card/50 hover:bg-card hover:border-primary/30 transition-all',
              'text-left group cursor-pointer'
            )}
          >
            <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors">
              {iconMap[dp.icon] ?? <Shield className="h-5 w-5" />}
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">{dp.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{dp.subtitle}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
