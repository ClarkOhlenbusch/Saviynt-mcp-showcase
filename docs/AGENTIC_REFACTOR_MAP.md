# Agentic Refactor Map

This project was split to reduce "God files" and make edits safer for autonomous agents.

## Access Review Snippets API
- `app/api/access-reviews/snippets/route.ts`
  - Request/response orchestration only.
- `app/api/access-reviews/snippets/snippets-service.ts`
  - Provider calls (Gemini/Groq), in-memory cache, rate-limit tracking, payload normalization.
- `app/api/access-reviews/snippets/snippets-heuristics.ts`
  - Prompt construction, request normalization, fallback snippet generation, risk scoring.

## Chat API
- `app/api/chat/route.ts`
  - Main endpoint flow and stream wiring.
- `app/api/chat/chat-prompt.ts`
  - System prompt composition from active request and pending snapshot context.
- `app/api/chat/chat-tools.ts`
  - MCP tool registration, schema conversion, `mcp_parallel` execution, payload profiling.
- `app/api/chat/chat-context.ts`
  - Message context trimming/compression and usage/error normalization.
- `app/api/chat/chat-shared.ts`
  - Shared serialization, payload size, and type guard helpers.

## Chat Panel UI
- `components/chat-panel.tsx`
  - Top-level chat container and interaction state.
- `components/chat-panel/chat-panel-helpers.ts`
  - Artifact detection, usage parsing, error parsing, selected-request prompt generation.
- `components/chat-panel/review-context-banner.tsx`
  - Focused selected-request context card.
- `components/chat-panel/decision-confirm-dialog.tsx`
  - Decision confirmation modal.

## Request List UI
- `components/request-list.tsx`
  - Layout, state transitions, and user actions.
- `components/request-list/request-list-data.ts`
  - Pending request fetch + snippet enrichment workflows.
- `components/request-list/request-card.tsx`
  - Individual request card rendering.

## App Shell (Second Pass)
- `app/page.tsx`
  - High-level composition and cross-panel state wiring.
- `app/page-usage.ts`
  - Gemini usage event persistence, retention, and snapshot generation.
- `app/page-pending-snapshot.ts`
  - Programmatic pending-request snapshot fetch + normalization.
- `components/page/app-top-bar.tsx`
  - Header controls and status presentation.
- `components/page/page-dialogs.tsx`
  - Centralized modal/dialog stack composition.

## Sidebar Primitives (Second Pass)
- `components/ui/sidebar.tsx`
  - Export surface only.
- `components/ui/sidebar-context.tsx`
  - Provider, context hook, layout primitives.
- `components/ui/sidebar-menu.tsx`
  - Menu/button/badge/submenu primitives.

## MCP Client (Second Pass)
- `lib/mcp/client.ts`
  - Public MCP client API orchestration.
- `lib/mcp/client-runtime.ts`
  - Shared runtime state model.
- `lib/mcp/client-helpers.ts`
  - Pure parsing/serialization/header helper functions.
- `lib/mcp/client-transport.ts`
  - SSE transport lifecycle + JSON-RPC request/response coordination.
