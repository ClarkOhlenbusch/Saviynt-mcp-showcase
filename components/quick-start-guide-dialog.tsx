'use client'

import type { ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { BookOpen, ExternalLink, HelpCircle, Key, MessageSquare, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'

interface QuickStartGuideDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenApiKey: () => void
  onOpenMcpConfig: () => void
  onOpenFaq: () => void
  apiKeySet: boolean
  mcpConnected: boolean
}

export function QuickStartGuideDialog({
  open,
  onOpenChange,
  onOpenApiKey,
  onOpenMcpConfig,
  onOpenFaq,
  apiKeySet,
  mcpConnected,
}: QuickStartGuideDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl border-border bg-card">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <BookOpen className="h-4 w-4 text-primary" />
            Start Here: Setup Guide
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Follow these steps exactly, in order. Most users can finish in 2-5 minutes.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[74vh] space-y-3 overflow-y-auto pr-1">
          <section className="rounded-lg border border-border bg-background/70 p-4">
            <div className="space-y-3">
              <GuideStep
                number={1}
                title="Get a Google Gemini API key"
                description='Open Google AI Studio and create a key. Keep that tab open so you can copy the key.'
                actions={
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground hover:bg-secondary/60"
                  >
                    Open Google AI Studio
                    <ExternalLink className="h-3 w-3" />
                  </a>
                }
              />

              <GuideStep
                number={2}
                title='Click "Add API Key" in this app'
                description='In the top bar, click "Add API Key", paste your key, and press "Save".'
                actions={
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 bg-transparent text-xs"
                    onClick={() => {
                      onOpenChange(false)
                      onOpenApiKey()
                    }}
                  >
                    <Key className="h-3.5 w-3.5" />
                    Open Add API Key
                  </Button>
                }
              />

              <GuideStep
                number={3}
                title="Get your MCP setup config"
                description="Open the Saviynt Confluence setup page and copy the MCP config JSON exactly as documented."
                actions={
                  <a
                    href="https://saviyntars.atlassian.net/wiki/spaces/ASG/pages/6286671901/MCP+Server+Setup+Sales+Instance+-+Claude"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground hover:bg-secondary/60"
                  >
                    Open MCP Setup Documentation
                    <ExternalLink className="h-3 w-3" />
                  </a>
                }
              />

              <GuideStep
                number={4}
                title='Click "Connect MCP" in this app'
                description='Paste the MCP config JSON and press "Connect". Wait until the status shows connected.'
                actions={
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 bg-transparent text-xs"
                    onClick={() => {
                      onOpenChange(false)
                      onOpenMcpConfig()
                    }}
                  >
                    <Zap className="h-3.5 w-3.5" />
                    Open Connect MCP
                  </Button>
                }
              />

              <GuideStep
                number={5}
                title="Ask the agent your first request"
                description='Example: "Run a Finance SoD conflict summary and provide recommendations."'
                actions={
                  <div className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground">
                    <MessageSquare className="h-3 w-3" />
                    You are ready to chat
                  </div>
                }
              />
            </div>
          </section>

          <section className="rounded-lg border border-primary/20 bg-primary/[0.04] p-4">
            <p className="text-xs font-semibold text-foreground">Quick status check</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <span
                className={cn(
                  'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]',
                  apiKeySet
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                    : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                )}
              >
                API Key: {apiKeySet ? 'Set' : 'Missing'}
              </span>
              <span
                className={cn(
                  'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]',
                  mcpConnected
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                    : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                )}
              >
                MCP: {mcpConnected ? 'Connected' : 'Not Connected'}
              </span>
            </div>
            <div className="mt-3">
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 bg-transparent text-xs"
                onClick={() => {
                  onOpenChange(false)
                  onOpenFaq()
                }}
              >
                <HelpCircle className="h-3.5 w-3.5" />
                Open FAQ / Troubleshooting
              </Button>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface GuideStepProps {
  number: number
  title: string
  description: string
  actions: ReactNode
}

function GuideStep({ number, title, description, actions }: GuideStepProps) {
  return (
    <div className="rounded-lg border border-border bg-card/70 p-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
          {number}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          <div className="mt-2">{actions}</div>
        </div>
      </div>
    </div>
  )
}
