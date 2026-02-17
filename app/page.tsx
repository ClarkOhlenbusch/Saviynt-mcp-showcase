'use client'

import { useState, useCallback, useEffect } from 'react'
import { ZapOff } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { StatusBar } from '@/components/status-bar'
import { ChatPanel } from '@/components/chat-panel'
import { RequestList } from '@/components/request-list'
import type {
  McpConnectionStatus,
  McpToolSchema,
  Artifact,
  McpPendingRequest,
  McpPendingRequestSummary,
} from '@/lib/mcp/types'
import type { GeminiUsageEvent } from '@/lib/gemini-usage'
import { AppTopBar } from '@/components/page/app-top-bar'
import { PageDialogs } from '@/components/page/page-dialogs'
import { fetchPendingRequestSnapshot, PENDING_REQUEST_REFRESH_MS } from './page-pending-snapshot'
import { useGeminiUsage } from './page-usage'
import { MCP_CONFIG_STORAGE_KEY, parseMcpConfig } from '@/components/mcp-config-dialog'

export default function Page() {
  const [mcpStatus, setMcpStatus] = useState<McpConnectionStatus>({
    connected: false,
    serverUrl: '',
    toolCount: 0,
  })
  const [tools, setTools] = useState<McpToolSchema[]>([])
  const [connecting, setConnecting] = useState(false)
  const [refreshingTools, setRefreshingTools] = useState(false)

  const [viewMode, setViewMode] = useState<'chat' | 'reviews'>('chat')
  const [selectedRequest, setSelectedRequest] = useState<McpPendingRequest | null>(null)
  const [pendingRequestsSnapshot, setPendingRequestsSnapshot] = useState<McpPendingRequestSummary[]>([])
  const [pendingRequestsSnapshotUpdatedAt, setPendingRequestsSnapshotUpdatedAt] = useState<number>(0)
  const [configDialogOpen, setConfigDialogOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [faqOpen, setFaqOpen] = useState(false)
  const [artifactsOpen, setArtifactsOpen] = useState(false)
  const [apiKeyDialogOpen, setApiKeyDialogOpen] = useState(false)
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [chatSessionKey, setChatSessionKey] = useState(0)

  const [redactionEnabled, setRedactionEnabled] = useState(true)
  const [destructiveActionsEnabled, setDestructiveActionsEnabled] = useState(false)

  const { setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const [apiKey, setApiKey] = useState('')
  const geminiUsage = useGeminiUsage()

  const handleSelectRequest = useCallback((request: McpPendingRequest) => {
    setSelectedRequest(request)
    setViewMode('chat')
    setChatSessionKey((prev) => prev + 1)
  }, [])

  const refreshPendingRequestSnapshot = useCallback(async (forceRefresh = false) => {
    if (!mcpStatus.connected) {
      setPendingRequestsSnapshot([])
      setPendingRequestsSnapshotUpdatedAt(0)
      return
    }

    try {
      const snapshot = await fetchPendingRequestSnapshot(forceRefresh)
      setPendingRequestsSnapshot(snapshot.items)
      setPendingRequestsSnapshotUpdatedAt(snapshot.fetchedAt)
    } catch {
      // Non-blocking optimization path: ignore transient fetch errors.
    }
  }, [mcpStatus.connected])

  useEffect(() => {
    const savedKey = localStorage.getItem('gemini_api_key')
    if (savedKey) {
      setApiKey(savedKey)
    }
  }, [])

  const handleConnect = useCallback(async (serverUrl: string, authHeader: string) => {
    setConnecting(true)
    try {
      const res = await fetch('/api/mcp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverUrl, authHeader }),
      })
      const status: McpConnectionStatus = await res.json()
      setMcpStatus(status)

      if (status.connected) {
        const toolsRes = await fetch('/api/mcp/tools')
        const data = await toolsRes.json()
        setTools(data.tools || [])
        setConfigDialogOpen(false)
      }
    } catch {
      setMcpStatus((prev) => ({ ...prev, connected: false, error: 'Connection failed' }))
    } finally {
      setConnecting(false)
    }
  }, [])

  useEffect(() => {
    const saved = localStorage.getItem(MCP_CONFIG_STORAGE_KEY)
    if (!saved) return
    const result = parseMcpConfig(saved)
    if (result) {
      void handleConnect(result.serverUrl, result.authHeader)
    }
  }, [handleConnect])

  useEffect(() => {
    if (!mcpStatus.connected) {
      setPendingRequestsSnapshot([])
      setPendingRequestsSnapshotUpdatedAt(0)
      return
    }

    void refreshPendingRequestSnapshot(true)
    const intervalId = window.setInterval(() => {
      void refreshPendingRequestSnapshot(true)
    }, PENDING_REQUEST_REFRESH_MS)

    return () => window.clearInterval(intervalId)
  }, [mcpStatus.connected, refreshPendingRequestSnapshot])

  const handleApiKeyChange = (key: string) => {
    setApiKey(key)
    localStorage.setItem('gemini_api_key', key)
  }

  const handleRefreshTools = useCallback(async () => {
    setRefreshingTools(true)
    try {
      const res = await fetch('/api/mcp/tools?refresh=true')
      const data = await res.json()
      setTools(data.tools || [])
      setMcpStatus((prev) => ({ ...prev, toolCount: data.tools?.length || 0 }))
    } catch {
      // ignore
    } finally {
      setRefreshingTools(false)
    }
  }, [])

  const handleArtifactGenerated = useCallback((artifact: Artifact) => {
    setArtifacts((prev) => {
      const recent = prev.find(
        (a) => a.title === artifact.title && artifact.createdAt - a.createdAt < 5000
      )
      if (recent) return prev
      return [artifact, ...prev]
    })
  }, [])

  const handleNewChat = useCallback(() => {
    setChatSessionKey((prev) => prev + 1)
    setArtifacts([])
    setSelectedRequest(null)
  }, [])

  const handleUsageEvent = useCallback((event: GeminiUsageEvent) => {
    geminiUsage.addEvent(event)
  }, [geminiUsage])

  return (
    <div className="flex flex-col h-screen bg-background">
      <AppTopBar
        viewMode={viewMode}
        setViewMode={setViewMode}
        mcpStatus={mcpStatus}
        tools={tools}
        usage={geminiUsage.snapshot}
        apiKey={apiKey}
        mounted={mounted}
        resolvedTheme={resolvedTheme}
        onNewChat={handleNewChat}
        onOpenGuide={() => setGuideOpen(true)}
        onOpenFaq={() => setFaqOpen(true)}
        onOpenApiKeyDialog={() => setApiKeyDialogOpen(true)}
        onOpenConfigDialog={() => setConfigDialogOpen(true)}
        onToggleArtifacts={() => setArtifactsOpen((prev) => !prev)}
        onOpenSettings={() => setSettingsOpen(true)}
        onToggleTheme={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
        artifactsCount={artifacts.length}
      />

      <div className="md:hidden px-4 py-1.5 border-b border-border bg-card/30">
        <StatusBar
          mcpConnected={mcpStatus.connected}
          mcpToolCount={tools.length}
          llmProvider="Gemini"
          usage={geminiUsage.snapshot}
        />
      </div>

      {mcpStatus.error && !mcpStatus.connected && (
        <div className="px-4 py-2 bg-destructive/10 border-b border-destructive/20 flex items-center gap-2">
          <ZapOff className="h-3.5 w-3.5 text-destructive shrink-0" />
          <p className="text-xs text-destructive">{mcpStatus.error}</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfigDialogOpen(true)}
            className="h-6 text-[10px] text-destructive hover:text-destructive ml-auto shrink-0"
          >
            Retry
          </Button>
        </div>
      )}

      <main className="flex-1 overflow-hidden">
        {viewMode === 'chat' ? (
          <ChatPanel
            key={chatSessionKey}
            mcpConnected={mcpStatus.connected}
            onArtifactGenerated={handleArtifactGenerated}
            onOpenArtifacts={() => setArtifactsOpen(true)}
            artifactCount={artifacts.length}
            apiKey={apiKey}
            onOpenFaq={() => setFaqOpen(true)}
            onOpenStartHere={() => setGuideOpen(true)}
            onUsageEvent={handleUsageEvent}
            selectedRequest={selectedRequest}
            setSelectedRequest={setSelectedRequest}
            redactionEnabled={redactionEnabled}
            destructiveActionsEnabled={destructiveActionsEnabled}
            pendingRequestsSnapshot={pendingRequestsSnapshot}
            pendingRequestsSnapshotUpdatedAt={pendingRequestsSnapshotUpdatedAt}
          />
        ) : (
          <RequestList
            mcpConnected={mcpStatus.connected}
            onSelectRequest={handleSelectRequest}
            apiKey={apiKey}
          />
        )}
      </main>

      <PageDialogs
        configDialogOpen={configDialogOpen}
        setConfigDialogOpen={setConfigDialogOpen}
        connecting={connecting}
        onConnect={handleConnect}
        apiKeyDialogOpen={apiKeyDialogOpen}
        setApiKeyDialogOpen={setApiKeyDialogOpen}
        apiKey={apiKey}
        onApiKeyChange={handleApiKeyChange}
        guideOpen={guideOpen}
        setGuideOpen={setGuideOpen}
        faqOpen={faqOpen}
        setFaqOpen={setFaqOpen}
        settingsOpen={settingsOpen}
        setSettingsOpen={setSettingsOpen}
        artifactsOpen={artifactsOpen}
        setArtifactsOpen={setArtifactsOpen}
        apiKeySet={Boolean(apiKey)}
        mcpConnected={mcpStatus.connected}
        mcpServerUrl={mcpStatus.serverUrl}
        tools={tools}
        redactionEnabled={redactionEnabled}
        onRedactionChange={setRedactionEnabled}
        destructiveActionsEnabled={destructiveActionsEnabled}
        onDestructiveChange={setDestructiveActionsEnabled}
        onRefreshTools={handleRefreshTools}
        refreshing={refreshingTools}
        artifacts={artifacts}
      />
    </div>
  )
}
