'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { AlertCircle, Clock, ShieldAlert, RefreshCw, DownloadCloud } from 'lucide-react'
import type { McpPendingRequest } from '@/lib/mcp/types'
import { cn } from '@/lib/utils'
import { RequestCard } from './request-list/request-card'
import { loadPendingRequests, populateAgentSnippets } from './request-list/request-list-data'

interface RequestListProps {
  onSelectRequest: (request: McpPendingRequest) => void
  mcpConnected: boolean
  apiKey: string
  saviyntUsername?: string
  saviyntPassword?: string
}

export function RequestList({
  onSelectRequest,
  mcpConnected,
  apiKey,
  saviyntUsername,
  saviyntPassword,
}: RequestListProps) {
  const [requests, setRequests] = useState<McpPendingRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [snippetRefreshing, setSnippetRefreshing] = useState(false)
  const [snippetStatus, setSnippetStatus] = useState<{
    type: 'success' | 'info' | 'error'
    message: string
  } | null>(null)
  const [requestRefreshing, setRequestRefreshing] = useState(false)

  useEffect(() => {
    if (!mcpConnected) {
      setLoading(false)
      setSnippetRefreshing(false)
      setSnippetStatus(null)
      return
    }

    async function fetchRequests() {
      const populateAndReport = (items: McpPendingRequest[]) => {
        void populateAgentSnippets(items, apiKey, setRequests).then((result) => {
          if (!result.ok) {
            setSnippetStatus({
              type: 'error',
              message: result.error || 'Could not generate review insights.',
            })
            return
          }

          if (result.mode === 'heuristic') {
            setSnippetStatus({
              type: 'info',
              message: 'AI insights unavailable; showing heuristic insights.',
            })
          }
        })
      }

      setLoading(true)
      try {
        const result = await loadPendingRequests(saviyntUsername, saviyntPassword)
        if (result.error) {
          setRequests([])
          setError(result.error)
          return
        }

        setRequests(result.requests)
        setError(null)
        if (result.requests.length > 0) {
          populateAndReport(result.requests)
        }
      } finally {
        setLoading(false)
      }
    }

    fetchRequests()
  }, [mcpConnected, apiKey])

  useEffect(() => {
    if (!snippetStatus) return
    const timeoutId = window.setTimeout(() => {
      setSnippetStatus(null)
    }, 4500)
    return () => window.clearTimeout(timeoutId)
  }, [snippetStatus])

  const handleRefreshInsights = useCallback(async () => {
    if (snippetRefreshing || requests.length === 0) return

    setSnippetRefreshing(true)
    setSnippetStatus({
      type: 'info',
      message: 'Refreshing review insights...',
    })

    try {
      const result = await populateAgentSnippets(requests, apiKey, setRequests, { force: true })

      if (!result.ok) {
        setSnippetStatus({
          type: 'error',
          message: result.error || 'Failed to refresh review insights.',
        })
      } else if (result.attempted === 0) {
        setSnippetStatus({
          type: 'info',
          message: 'No requests available for insight refresh.',
        })
      } else if (result.updated > 0) {
        setSnippetStatus({
          type: 'success',
          message: result.mode === 'heuristic'
            ? `Refreshed ${result.updated} review insight${result.updated === 1 ? '' : 's'} (heuristic mode).`
            : `Refreshed ${result.updated} review insight${result.updated === 1 ? '' : 's'}.`,
        })
      } else {
        setSnippetStatus({
          type: 'info',
          message: 'Refresh completed with no new insight changes.',
        })
      }
    } finally {
      setSnippetRefreshing(false)
    }
  }, [apiKey, requests, snippetRefreshing])

  const handleRefreshRequests = useCallback(async () => {
    if (requestRefreshing) return

    setRequestRefreshing(true)
    setSnippetStatus({
      type: 'info',
      message: 'Fetching pending requests (multi-pass)…',
    })

    try {
      const result = await loadPendingRequests(saviyntUsername, saviyntPassword, {
        refresh: true,
        passes: 5,
      })

      if (result.error) {
        setSnippetStatus({
          type: 'error',
          message: result.error,
        })
        return
      }

      setRequests(result.requests)
      setError(null)
      setSnippetStatus({
        type: 'success',
        message: `Found ${result.requests.length} pending request${result.requests.length === 1 ? '' : 's'}.`,
      })

      // Automatically populate AI insights for any new requests
      if (result.requests.length > 0) {
        void populateAgentSnippets(result.requests, apiKey, setRequests)
      }
    } finally {
      setRequestRefreshing(false)
    }
  }, [apiKey, requestRefreshing, saviyntUsername, saviyntPassword])

  if (!mcpConnected) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <ShieldAlert className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium">MCP Connection Required</h3>
        <p className="text-sm text-muted-foreground mt-2 max-w-xs">
          Please connect to your Saviynt MCP server to view and manage pending access requests.
        </p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-6">
        {[1, 2, 3].map(i => (
          <Card key={i} className="border-border/50">
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-1/3 mb-2" />
              <Skeleton className="h-6 w-2/3" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-20 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-destructive">
        <AlertCircle className="h-8 w-8 mb-2" />
        <p>{error}</p>
        <Button variant="outline" className="mt-4" onClick={() => window.location.reload()}>Retry</Button>
      </div>
    )
  }

  if (requests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <Clock className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium">No Pending Requests</h3>
        <p className="text-sm text-muted-foreground mt-2 max-w-xs">
          There are currently no pending access requests for this approver.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b bg-muted/30">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Pending Access Reviews
          </h2>
          <p className="text-sm text-muted-foreground">
            Analyze and act on identity requests with AI assistance.
          </p>
          {snippetStatus && (
            <p className={cn(
              'mt-1 text-xs',
              snippetStatus.type === 'error'
                ? 'text-destructive'
                : snippetStatus.type === 'success'
                  ? 'text-emerald-600'
                  : 'text-muted-foreground'
            )}>
              {snippetStatus.message}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleRefreshRequests()}
            disabled={requestRefreshing}
            className="h-8 bg-background text-xs"
          >
            <DownloadCloud className={cn('mr-1.5 h-3.5 w-3.5', requestRefreshing && 'animate-pulse')} />
            {requestRefreshing ? 'Fetching…' : 'Refresh Requests'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleRefreshInsights()}
            disabled={snippetRefreshing}
            className="h-8 bg-background text-xs"
          >
            <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', snippetRefreshing && 'animate-spin')} />
            {snippetRefreshing ? 'Refreshing…' : 'Refresh Insights'}
          </Button>
          <Badge variant="outline" className="bg-background">
            {requests.length} Requests
          </Badge>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {requests.map((request) => (
            <RequestCard
              key={request.requestid}
              request={request}
              onSelect={onSelectRequest}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
