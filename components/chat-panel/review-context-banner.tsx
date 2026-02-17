import { BrainCircuit } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { McpPendingRequest } from '@/lib/mcp/types'

type ReviewContextBannerProps = {
  selectedRequest: McpPendingRequest
  destructiveActionsEnabled: boolean
  decisionSubmitting: boolean
  onDecisionIntent: (decision: 'approve' | 'reject') => void
  onClearContext: () => void
}

export function ReviewContextBanner({
  selectedRequest,
  destructiveActionsEnabled,
  decisionSubmitting,
  onDecisionIntent,
  onClearContext,
}: ReviewContextBannerProps) {
  return (
    <div className="mb-6 rounded-xl border border-primary/20 bg-primary/5 p-4 flex items-start gap-4 animate-in fade-in slide-in-from-top-2 duration-500">
      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
        <BrainCircuit className="h-5 w-5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-sm font-bold text-foreground">Reviewing Request {selectedRequest.requestid}</h3>
          <Badge className="h-4 px-1.5 bg-primary/20 hover:bg-primary/20 text-primary text-[9px] border-primary/20">Active Review Context</Badge>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          I'm analyzing <span className="font-semibold text-foreground">{selectedRequest.requestedfor}'s</span> request for <span className="font-semibold text-foreground">{selectedRequest.endpoint || 'Internal Security System'}</span>.
          Ask me about their current access, potential risks, or for a recommendation.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            className="h-7 text-[10px] px-2.5"
            onClick={() => onDecisionIntent('approve')}
            disabled={!destructiveActionsEnabled || decisionSubmitting}
          >
            Approve Request
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="h-7 text-[10px] px-2.5"
            onClick={() => onDecisionIntent('reject')}
            disabled={!destructiveActionsEnabled || decisionSubmitting}
          >
            Reject Request
          </Button>
          {!destructiveActionsEnabled && (
            <span className="text-[10px] text-muted-foreground">
              Enable destructive actions in Settings to finalize approvals.
            </span>
          )}
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onClearContext}
        className="h-7 px-2 text-[10px] text-muted-foreground hover:text-foreground"
      >
        Clear Context
      </Button>
    </div>
  )
}
