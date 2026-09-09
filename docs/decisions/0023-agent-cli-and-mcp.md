> Language: **English** · [中文](../zh/decisions/0023-agent-cli-and-mcp.md)

# ADR 0023: Shared local automation through CLI and MCP

Status: Accepted. Date: 2026-09-09.

## Purpose and scope

Give agents a general LumaMark interface for checking diagram syntax and renderability while writing Markdown. The first capabilities are Markdown fence checking and Mermaid/PlantUML SVG rendering. Markdown/PDF conversion is a future capability, not implemented by this decision.

## Decision

- Keep the automation host in `tools/automation/`, outside the frontend bundle and Rust file-opening routes. `AutomationService` owns requests; CLI and MCP are thin adapters. No full document enters React state, and neither adapter starts the desktop editor.
- Use Node's argument parser and the official `@modelcontextprotocol/sdk` 1.30.0 stdio transport with Zod schemas. Do not implement an MCP protocol or a diagram parser from scratch.
- Extract Markdown fences with existing `@lezer/markdown`, including blockquote/list containers. Reuse the project's installed Mermaid and `@plantuml/core` versions. Render in headless Playwright Chromium, with a fresh page per diagram to isolate directives and mutable engine state. Sanitize exported SVG with DOMPurify.
- Serve only the renderer and package assets through intercepted browser requests at a virtual loopback origin. There is no listening HTTP server. External requests are blocked; remote PlantUML includes and external diagram resources are unsupported.
- Limit input to 2 MiB UTF-8 and a Markdown request to 100 supported diagram fences. Rendering is serialized and bounded to 30 seconds per diagram. Runtime/asset/deadline failures cannot count as successful syntax checks.
- MCP receives source text and returns structured results; it does not read or write user files. CLI reads explicit paths or stdin, and writes SVG only when `--output` is supplied. Existing output files are rejected. Check and render never rewrite input Markdown.
- Both adapters return `schemaVersion: 1`, `ok`, `checked`, and `diagnostics`. A diagnostic contains `code`, `message`, diagram `format`, and one-based `blockLine`/`line` where available. `blockLine` identifies the opening fence; `line` maps an engine location to the source document, falling back to the first diagram line when the engine provides no exact location. Render success includes `svg` or the explicitly written `output` path.
- Own help, descriptions, and messages live in bilingual `messages.ts`; engine and OS diagnostics retain their original wording. Default language is English; `LUMAMARK_TOOLS_LANGUAGE=zh-CN` selects Chinese. Codes remain stable across languages.

## User guide

See the [CLI and MCP User Guide](../release/AGENT_TOOLS.md) for setup, commands, host configuration and troubleshooting.

## Alternatives and consequences

CLI alone lacks automatic tool discovery; MCP alone is inconvenient in shell pipelines. The owner selected both. A shared service prevents their diagnostics from diverging.

A custom syntax-only validator would diverge from the actual engines. A remote diagram service would transmit document content. A Java PlantUML sidecar adds a second runtime and different rendering behavior from the existing official TeaVM capability. The selected browser host reuses the installed engines, but requires Chromium and has startup costs; those costs stay outside editor typing and startup paths.

Packaging a standalone installed tool is a separate deployment change. Future conversions should add a service capability and thin adapters, with explicit output paths and preservation tests. A future MCP transport must preserve the source/file access boundary; this decision does not authorize a network listener.

## Verification and review conditions

`pnpm test:automation` runs real CLI subprocesses and official MCP client handshake/discovery/calls, including valid and invalid Mermaid/PlantUML, nested fences, source locations, output preservation, limits, and deadlines. `pnpm typecheck` includes the automation host; `pnpm lint` covers it. CI runs automation tests after installing Chromium, separately from the browser-free unit gate.

Revisit if Chromium becomes an unacceptable distribution burden, the SDK generation loses maintenance, or the host's engine versions diverge from the editor. Source-fidelity changes, filesystem-writing MCP tools, and installed distribution need their own explicit boundaries and acceptance evidence.

References: [official MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/server), [Mermaid API](https://mermaid.js.org/config/usage.html), [official PlantUML engine API](https://www.npmjs.com/package/@plantuml/core), [local PlantUML decision](0018-plantuml-local-rendering.md).
