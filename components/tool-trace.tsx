'use client'

import { AlertCircle, CheckCircle2, Loader2, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'

const TOOL_ALIASES: Record<string, string[]> = {
  get_users: [
    'Searching for users',
    'Gathering user identities',
    'Scanning identity records',
    'Reviewing user profiles',
    'Checking the user directory',
  ],
  get_user_accounts: [
    'Gathering linked accounts',
    'Reviewing account associations',
    'Mapping user accounts',
    'Collecting account IDs',
    'Checking connected accounts',
  ],
  get_user_roles: [
    'Gathering assigned roles',
    'Reviewing role assignments',
    'Mapping user roles',
    'Scanning role memberships',
    'Checking assigned access roles',
  ],
  get_user_entitlements: [
    'Collecting user entitlements',
    'Reviewing granular permissions',
    'Mapping entitlement grants',
    'Scanning entitlement assignments',
    'Checking permission-level access',
  ],
  get_user_endpoints: [
    'Reviewing application access',
    'Mapping user endpoints',
    'Gathering connected applications',
    'Scanning endpoint permissions',
    'Checking system access targets',
  ],
  get_complete_access_path: [
    'Tracing complete access paths',
    'Mapping end-to-end permissions',
    'Reviewing full access lineage',
    'Following accounts-to-entitlements flow',
    'Building comprehensive access view',
  ],
  login: [
    'Establishing secure session',
    'Authenticating with Saviynt',
    'Validating approval session',
    'Opening secure approval context',
    'Confirming session access',
  ],
  get_list_of_pending_requests_for_approver: [
    'Gathering pending approvals',
    'Reviewing waiting access requests',
    'Scanning approver request queue',
    'Checking requests awaiting action',
    'Loading pending review items',
  ],
  approve_reject_entire_request: [
    'Processing approval decision',
    'Applying request disposition',
    'Submitting request action',
    'Finalizing approval outcome',
    'Executing request decision',
  ],
}

export interface ToolTraceItemData {
  toolCallId?: string
  toolName: string
  args?: Record<string, unknown>
  result?: unknown
  duration?: number
  requestBytes?: number
  rawResponseBytes?: number
  responseBytes?: number
  state: string
}

interface ToolTraceProps {
  traces: ToolTraceItemData[]
}

export function ToolTrace({ traces }: ToolTraceProps) {
  if (traces.length === 0) return null

  const runningCount = traces.filter((trace) => getTraceStatus(trace.state) === 'running').length
  const completedCount = traces.filter((trace) => getTraceStatus(trace.state) === 'complete').length
  const errorCount = traces.filter((trace) => getTraceStatus(trace.state) === 'error').length

  return (
    <div className="my-2 w-full rounded-xl border border-border/70 bg-card/70 p-3">
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10">
          <Wrench className={cn('h-3.5 w-3.5 text-primary', runningCount > 0 && 'animate-pulse')} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-foreground">Tool Activity</p>
          <p className="text-[10px] text-muted-foreground">
            {traces.length} {traces.length === 1 ? 'operation' : 'operations'}
          </p>
        </div>
        {runningCount > 0 && (
          <span className="flex items-center gap-1 text-[10px] font-medium text-primary">
            <Loader2 className="h-3 w-3 animate-spin" />
            Working
          </span>
        )}
      </div>

      <div className="mt-2 space-y-1.5">
        {traces.map((trace, index) => {
          const status = getTraceStatus(trace.state)
          return (
            <div
              key={trace.toolCallId ?? `${trace.toolName}-${index}`}
              className={cn(
                'flex items-center gap-2 rounded-lg border px-2.5 py-1.5',
                status === 'running' && 'border-primary/30 bg-primary/[0.03]',
                status === 'complete' && 'border-border/70 bg-background/70',
                status === 'error' && 'border-destructive/30 bg-destructive/[0.03]'
              )}
            >
              {status === 'running' && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />}
              {status === 'complete' && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
              {status === 'error' && <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />}
              <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                {getToolAlias(trace, index)}
              </span>
              <span
                className={cn(
                  'shrink-0 text-[10px]',
                  status === 'running' && 'text-primary',
                  status === 'complete' && 'text-muted-foreground',
                  status === 'error' && 'text-destructive'
                )}
              >
                {getStatusLabel(trace, status)}
              </span>
            </div>
          )
        })}
      </div>

      {(completedCount > 0 || errorCount > 0) && (
        <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
          {completedCount > 0 && <span>{completedCount} completed</span>}
          {errorCount > 0 && <span className="text-destructive">{errorCount} with issues</span>}
        </div>
      )}
    </div>
  )
}

function getTraceStatus(state: string): 'running' | 'complete' | 'error' {
  if (state === 'output-available') return 'complete'
  if (state === 'output-error') return 'error'
  return 'running'
}

function getStatusLabel(trace: ToolTraceItemData, status: 'running' | 'complete' | 'error'): string {
  if (status === 'running') return 'In progress'
  if (status === 'error') return 'Needs attention'
  const hasDuration = trace.duration != null
  const hasBytes = trace.responseBytes != null

  if (hasDuration && hasBytes) return `${trace.duration} ms | ${formatBytes(trace.responseBytes!)}`
  if (hasDuration) return `${trace.duration} ms`
  if (hasBytes) return formatBytes(trace.responseBytes!)
  return 'Done'
}

function getToolAlias(trace: ToolTraceItemData, index: number): string {
  const aliases = TOOL_ALIASES[trace.toolName] ?? buildFallbackAliases(trace.toolName)
  const seed = `${trace.toolCallId ?? ''}:${trace.toolName}:${index}`
  const aliasIndex = Math.abs(hashString(seed)) % aliases.length
  return aliases[aliasIndex]
}

function buildFallbackAliases(toolName: string): string[] {
  const subject = normalizeSubject(toolName)
  const [action] = toolName.toLowerCase().split(/[_-]+/).filter(Boolean)

  if (action === 'get' || action === 'list' || action === 'fetch' || action === 'find' || action === 'search') {
    return [
      `Searching ${subject}`,
      `Gathering ${subject}`,
      `Reviewing ${subject}`,
      `Scanning ${subject}`,
    ]
  }

  if (action === 'run' || action === 'start' || action === 'execute') {
    return [
      `Running ${subject}`,
      `Coordinating ${subject}`,
      `Preparing ${subject}`,
      `Processing ${subject}`,
    ]
  }

  if (action === 'check' || action === 'validate' || action === 'analyze' || action === 'assess') {
    return [
      `Checking ${subject}`,
      `Analyzing ${subject}`,
      `Evaluating ${subject}`,
      `Verifying ${subject}`,
    ]
  }

  return [
    `Working on ${subject}`,
    `Collecting ${subject}`,
    `Reviewing ${subject}`,
    `Processing ${subject}`,
  ]
}

function normalizeSubject(toolName: string): string {
  const parts = toolName
    .toLowerCase()
    .split(/[_-]+/)
    .filter(Boolean)

  if (parts.length === 0) return 'records'
  const subjectParts = parts.length > 1 ? parts.slice(1) : parts
  return subjectParts.join(' ')
}

function hashString(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0
  }
  return hash
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

