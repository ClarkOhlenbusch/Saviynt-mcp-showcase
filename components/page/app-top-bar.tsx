import { Settings, Zap, FileText, Key, HelpCircle, Github, BookOpen, Plus, Sun, Moon, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusBar } from '@/components/status-bar'
import type { McpConnectionStatus, McpToolSchema } from '@/lib/mcp/types'
import type { GeminiUsageSnapshot } from '@/lib/gemini-usage'

type AppTopBarProps = {
  viewMode: 'chat' | 'reviews'
  setViewMode: (mode: 'chat' | 'reviews') => void
  mcpStatus: McpConnectionStatus
  tools: McpToolSchema[]
  usage: GeminiUsageSnapshot
  apiKey: string
  mounted: boolean
  resolvedTheme: string | undefined
  onNewChat: () => void
  onOpenGuide: () => void
  onOpenFaq: () => void
  onOpenApiKeyDialog: () => void
  onOpenConfigDialog: () => void
  onToggleArtifacts: () => void
  onOpenSettings: () => void
  onOpenSaviyntCredentials: () => void
  onToggleTheme: () => void
  saviyntSet: boolean
  artifactsCount: number
}

export function AppTopBar({
  viewMode,
  setViewMode,
  mcpStatus,
  tools,
  usage,
  apiKey,
  mounted,
  resolvedTheme,
  onNewChat,
  onOpenGuide,
  onOpenFaq,
  onOpenApiKeyDialog,
  onOpenConfigDialog,
  onToggleArtifacts,
  onOpenSettings,
  onOpenSaviyntCredentials,
  onToggleTheme,
  artifactsCount,
  saviyntSet,
}: AppTopBarProps) {
  return (
    <div className="flex flex-col shrink-0 z-50">
      <header className="flex items-center justify-between px-4 py-2.5 bg-card/50 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <img
              src="https://saviynt.com/hubfs/raw_assets/saviynt-theme-26/169/js_client_assets/assets/saviynt-logo-DWEmNKg8.svg"
              alt="Saviynt"
              className="h-5 w-auto dark:invert"
              loading="eager"
            />
            <h1 className="text-sm font-semibold text-foreground hidden sm:block ml-1">MCP Agent</h1>
          </div>

          <div className="flex items-center bg-muted/50 rounded-lg p-0.5 border border-border/50 ml-2">
            <Button
              variant={viewMode === 'chat' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('chat')}
              className="h-7 text-[10px] px-3 gap-1.5 font-medium"
            >
              General Chat
            </Button>
            <Button
              variant={viewMode === 'reviews' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('reviews')}
              className="h-7 text-[10px] px-3 gap-1.5 font-medium"
            >
              Access Reviews
            </Button>
          </div>

          <div className="hidden md:block">
            <StatusBar
              mcpConnected={mcpStatus.connected}
              mcpToolCount={tools.length}
              llmProvider="Gemini"
              usage={usage}
            />
          </div>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={onNewChat}
            className="h-7 text-xs gap-1.5 border-border text-muted-foreground hover:text-foreground bg-transparent shrink-0"
          >
            <Plus className="h-3 w-3" />
            New Chat
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenSettings}
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground shrink-0"
            aria-label="Settings"
            title="Settings & Saviynt Credentials"
          >
            <Settings className="h-4 w-4" />
          </Button>

          <Button
            variant="default"
            size="sm"
            onClick={onOpenGuide}
            className="h-7 px-2 sm:px-2.5 text-xs gap-1.5 shrink-0"
          >
            <BookOpen className="h-3 w-3" />
            <span className="hidden sm:inline">Start Here</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenFaq}
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground shrink-0"
            aria-label="FAQ"
            title="FAQ"
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={onOpenSaviyntCredentials}
            className={`h-7 text-xs gap-1.5 bg-transparent shrink-0 ${saviyntSet ? 'border-accent/30 text-accent hover:text-accent' : 'border-border text-muted-foreground hover:text-foreground'}`}
          >
            <ShieldCheck className="h-3 w-3" />
            {saviyntSet ? 'EIC Credentials Set' : 'Add EIC Credentials'}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={onOpenApiKeyDialog}
            className={`h-7 text-xs gap-1.5 bg-transparent shrink-0 ${apiKey ? 'border-accent/30 text-accent hover:text-accent' : 'border-border text-muted-foreground hover:text-foreground'}`}
          >
            <Key className="h-3 w-3" />
            {apiKey ? 'API Token Set' : 'Add API Token'}
          </Button>

          {!mcpStatus.connected ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onOpenConfigDialog}
              className="h-7 text-xs gap-1.5 border-border text-muted-foreground hover:text-foreground bg-transparent shrink-0"
            >
              <Zap className="h-3 w-3" />
              Connect MCP
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={onOpenConfigDialog}
              className="h-7 text-xs gap-1.5 border-accent/30 text-accent hover:text-accent bg-transparent shrink-0"
            >
              <Zap className="h-3 w-3" />
              Connected
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleArtifacts}
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground relative shrink-0"
            aria-label="Open artifacts"
          >
            <FileText className="h-4 w-4" />
            {artifactsCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-primary text-[9px] text-primary-foreground flex items-center justify-center font-bold">
                {artifactsCount}
              </span>
            )}
          </Button>

          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground shrink-0"
          >
            <a
              href="https://github.com/ClarkOhlenbusch/Saviynt-mcp-showcase"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open GitHub repository"
              title="GitHub repository"
            >
              <Github className="h-4 w-4" />
            </a>
          </Button>

          {mounted && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleTheme}
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground shrink-0"
              aria-label="Toggle theme"
            >
              {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          )}
        </div>
      </header>
      <div className="h-[1px] w-full bg-saviynt-gradient" />
    </div>
  )
}
