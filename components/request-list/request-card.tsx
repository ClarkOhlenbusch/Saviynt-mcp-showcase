import { Clock, User, ExternalLink, BrainCircuit } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import type { McpPendingRequest } from '@/lib/mcp/types'

type RequestCardProps = {
  request: McpPendingRequest
  onSelect: (request: McpPendingRequest) => void
}

export function RequestCard({ request, onSelect }: RequestCardProps) {
  return (
    <Card className="group hover:border-primary/50 transition-all duration-300 shadow-sm hover:shadow-md flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between mb-2">
          <Badge variant="secondary" className="text-[10px] uppercase tracking-wider font-bold">
            {request.requesttype}
          </Badge>
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            Due {request.duedate ? new Date(request.duedate).toLocaleDateString() : 'N/A'}
          </div>
        </div>
        <CardTitle className="text-lg flex items-center gap-2">
          <User className="h-4 w-4 text-muted-foreground" />
          {request.requestedfor}
        </CardTitle>
        <CardDescription className="text-xs">
          Request ID: {request.requestid}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex-1 pb-4">
        <div className="mb-4">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase block mb-1">Target Resource</span>
          <div className="text-sm font-medium flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-primary" />
            {request.endpoint || 'Internal Security System'}
          </div>
        </div>

        <div className="rounded-lg bg-primary/5 p-3 border border-primary/10 relative overflow-hidden">
          <div className="absolute top-2 right-2">
            <BrainCircuit className="h-3.5 w-3.5 text-primary/40" />
          </div>
          <span className="text-[10px] font-bold text-primary uppercase flex items-center gap-1 mb-1.5">
            Review Insight
            {request.aiRiskLevel === 'high' && <Badge className="h-4 px-1.5 bg-destructive hover:bg-destructive text-[9px]">High Risk</Badge>}
            {request.aiRiskLevel === 'medium' && <Badge className="h-4 px-1.5 bg-orange-500 hover:bg-orange-500 text-[9px]">Medium Risk</Badge>}
            {request.aiRiskLevel === 'low' && <Badge className="h-4 px-1.5 bg-emerald-600 hover:bg-emerald-600 text-[9px]">Low Risk</Badge>}
            {request.aiInsightSource === 'heuristic' && (
              <Badge variant="outline" className="h-4 px-1.5 text-[9px] border-amber-500/40 text-amber-700">
                Heuristic
              </Badge>
            )}
          </span>
          <p className="text-xs leading-relaxed text-foreground/80 line-clamp-3">
            {request.aiRiskAnalysis || 'No precomputed AI insight is available. Start review to investigate this request with live MCP data.'}
          </p>
        </div>
      </CardContent>

      <CardFooter className="pt-0 pb-6">
        <Button
          className="w-full gap-2 group-hover:bg-primary transition-colors"
          onClick={() => onSelect(request)}
        >
          Start Review
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      </CardFooter>
    </Card>
  )
}
