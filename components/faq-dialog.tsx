'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { AlertTriangle, ExternalLink, HelpCircle, Wrench } from 'lucide-react'

interface FAQDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function FAQDialog({ open, onOpenChange }: FAQDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl border-border bg-card">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <HelpCircle className="h-4 w-4 text-primary" />
            FAQ & Troubleshooting
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Quick fixes for quota/rate-limit and MCP connection issues.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          <section className="rounded-lg border border-destructive/30 bg-destructive/[0.04] p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              I hit a rate limit or usage quota error
            </h3>
            <div className="mt-2 space-y-2 text-xs text-muted-foreground">
              <p>
                Google Gemini API limits are model and tier based. Official docs define limits by
                RPM (requests/min), TPM (tokens/min), and RPD (requests/day), and limits apply per
                project. Daily limits reset at midnight Pacific time.
              </p>
              <p>
                Tier criteria from Google docs (last updated January 22, 2026): Free tier, Tier 1
                (spend {`>`} $0 and at least 3 days since successful payment), Tier 2 (spend {`>`}
                $250 and at least 30 days), Tier 3 (spend {`>`} $1,000 and at least 30 days).
              </p>
              <p>
                If you need more usage: upgrade your tier in Google AI Studio, use a different
                Google account/project, then generate a new key from the same API key page.
              </p>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground hover:bg-secondary/60"
              >
                Google AI Studio API Keys
                <ExternalLink className="h-3 w-3" />
              </a>
              <a
                href="https://aistudio.google.com/usage"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground hover:bg-secondary/60"
              >
                Check Usage Dashboard
                <ExternalLink className="h-3 w-3" />
              </a>
              <a
                href="https://ai.google.dev/gemini-api/docs/rate-limits"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground hover:bg-secondary/60"
              >
                Gemini Rate Limit Docs
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-background/60 p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Wrench className="h-4 w-4 text-primary" />
              MCP connection is not working
            </h3>
            <div className="mt-2 space-y-2 text-xs text-muted-foreground">
              <p>
                Please ensure your MCP config matches the documented example and that you follow all
                setup steps and basic troubleshooting checks.
              </p>
              <p>
                If issues continue after that, message <span className="font-medium text-foreground">Clark
                Ohlenbusch</span> on Slack for help.
              </p>
            </div>
            <div className="mt-3">
              <a
                href="https://saviyntars.atlassian.net/wiki/spaces/ASG/pages/6286671901/MCP+Server+Setup+Sales+Instance+-+Claude"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground hover:bg-secondary/60"
              >
                MCP Setup Documentation
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}

