# Saviynt-mcp-showcase Project Documentation

This document provides an overview of the Saviynt-mcp-showcase project, its architecture, and how to build, run, and develop within it.

## Project Overview

The `Saviynt-mcp-showcase` project is a Next.js (version 16, utilizing React 19) application designed to demonstrate the integration of the Saviynt Model Context Protocol (MCP) with an LLM, specifically Google's Gemini. It serves as a proof-of-concept for how to leverage MCP to expose and consume tools and services within an LLM-powered application.

The application features a user interface built with Tailwind CSS and a comprehensive set of UI components from libraries like Radix UI and shadcn/ui. It handles LLM interactions, manages MCP connections, and provides features for API key management and security settings. Supabase is used for database operations, and the project uses standard web development practices with TypeScript for type safety.

## Key Technologies

-   **Framework:** Next.js 16 (App Router)
-   **Language:** TypeScript
-   **Frontend:** React 19, Tailwind CSS, shadcn/ui, Radix UI
-   **LLM Integration:** Vercel AI SDK (`ai`, `@ai-sdk/google`, `@ai-sdk/react`), Google Gemini
-   **Protocol:** Saviynt Model Context Protocol (MCP) via Server-Sent Events (SSE)
-   **Database:** Supabase
-   **State Management:** React Hooks, Local Storage

## Saviynt MCP Tools

The following tools are exposed by the Saviynt MCP server and can be consumed by the agent:

### User and Access Management
-   **`get_users`**: Retrieve a paginated list of users from the Saviynt system.
-   **`get_user_accounts`**: Get all account IDs associated with a specific user.
-   **`get_user_roles`**: List all roles assigned to a user across all their accounts.
-   **`get_user_entitlements`**: Retrieve all entitlements for a user, including those from accounts and roles.
-   **`get_user_endpoints`**: Get all endpoints or applications that a user has access to.
-   **`get_complete_access_path`**: Provides a comprehensive view of a user's access, including relationships between accounts, roles, entitlements, and endpoints.

### Authentication and Approvals
-   **`login`**: Authenticate with a Saviynt instance to enable administrative and approval actions.
-   **`get_list_of_pending_requests_for_approver`**: Retrieve a list of access requests currently awaiting approval from the authenticated user.
-   **`approve_reject_entire_request`**: Perform an approval or rejection action on a pending access request.

## Building and Running the Project

The project uses `pnpm` as its package manager. The following scripts are available in `package.json`:

*   **Start Development Server:**
    ```bash
    npm run dev
    # or for accelerated development:
    npm run dev --turbo
    ```
    This command starts the Next.js development server with hot-reloading.

*   **Build for Production:**
    ```bash
    npm run build
    ```
    This command creates an optimized production build of the application.

*   **Start Production Server:**
    ```bash
    npm run start
    ```
    This command runs the application using the production build.

*   **Linting:**
    ```bash
    npm run lint
    ```
    Runs ESLint to check for code quality and style issues.

*   **Type Checking:**
    ```bash
    npm run typecheck
    ```
    Runs the TypeScript compiler to verify type safety.

*   **Supabase CLI Commands:**
    ```bash
    npm run db:push       # Pushes local schema changes to Supabase
    npm run db:pull       # Pulls schema from Supabase to local
    npm run db:status     # Shows the database schema status
    ```

## Development Conventions

*   **Project Structure:** The codebase follows a standard Next.js App Router structure with directories like `app`, `components`, `lib`, and `hooks`.
*   **UI Components:** Components are organized in the `components` directory, utilizing shared UI primitives from `components/ui` and Radix UI.
*   **MCP Client:** The core MCP client logic resides in `lib/mcp/`, with API endpoints in `app/api/mcp/`.
*   **State Management:** Primarily uses React's built-in hooks (`useState`, `useCallback`, `useEffect`, `useMemo`) and `localStorage` for persisting UI state and configuration.
- **Theming:** Supports dark and light themes via `next-themes`.
- **Error Handling:** Includes mechanisms for handling MCP connection errors and API key management.
- **Code Quality:** Adheres to TypeScript for static typing and ESLint for code linting.
- **Security:** Features include an API key input, configuration for MCP connection, and options for redaction and enabling destructive actions within the settings.

## Contribution Guidelines

Refer to the project's `.gitignore` and `.eslint.js` for specific configuration details. Standard contribution practices for Next.js projects apply.
