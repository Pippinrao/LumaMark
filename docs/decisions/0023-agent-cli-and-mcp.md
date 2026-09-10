> Language: **English** · [中文](../zh/decisions/0023-agent-cli-and-mcp.md)

# ADR 0023: Shared local automation through CLI and MCP

Status: Accepted. Date: 2026-09-09. Deployment, host and renderer parts are superseded by [ADR 0024](0024-bundled-automation-host.md); the report schema, diagnostic semantics and capability boundaries below still hold.

## Purpose and scope

Give agents a general LumaMark interface for checking diagram syntax and renderability while writing Markdown. The first capabilities are Markdown fence checking and Mermaid/PlantUML SVG rendering. Markdown/PDF conversion is a future capability, not implemented by this decision.

## Decision

- Automation stays outside the frontend bundle and the Rust file-opening routes. A request service owns work; CLI and MCP are thin adapters. No full document enters React state, and neither adapter starts the desktop editor. ADR 0024 moved the host into the desktop executable and its renderer onto the app's own WebView.
- Use an official MCP SDK over stdio rather than implementing the protocol. ADR 0024 replaced the Node SDK with the official Rust `rmcp` SDK; the original choice was Node's argument parser plus `@modelcontextprotocol/sdk` 1.30.0 with Zod schemas.
- Extract Markdown fences with existing `@lezer/markdown`, including blockquote/list containers, and reuse the project's installed Mermaid and `@plantuml/core` versions. ADR 0024 removed the headless Playwright Chromium host; rendering now runs in the app's WebView and the exported SVG is still sanitized with DOMPurify.
- Serve only the renderer and package assets through intercepted browser requests at a virtual loopback origin. There is no listening HTTP server. External requests are blocked; remote PlantUML includes and external diagram resources are unsupported.
- Limit input to 2 MiB UTF-8 and a Markdown request to 100 supported diagram fences. Rendering is serialized and bounded to 30 seconds per diagram. Runtime/asset/deadline failures cannot count as successful syntax checks.
- MCP receives source text and returns structured results; it does not read or write user files. CLI reads explicit paths or stdin, and writes SVG only when `--output` is supplied. Existing output files are rejected. Check and render never rewrite input Markdown.
- Both adapters return `schemaVersion: 1`, `ok`, `checked`, and `diagnostics`. A diagnostic contains `code`, `message`, diagram `format`, and one-based `blockLine`/`line` where available. `blockLine` identifies the opening fence; `line` maps an engine location to the source document, falling back to the first diagram line when the engine provides no exact location. Render success includes `svg` or the explicitly written `output` path.
- Own help, descriptions, and messages are bilingual; engine and OS diagnostics retain their original wording. Default language is English; `LUMAMARK_TOOLS_LANGUAGE=zh-CN` selects Chinese. Codes remain stable across languages. ADR 0024 moved this text into Rust and made `LumaMark.exe --help` the complete usage reference, so no separate manual is maintained.

## User guide

Run `LumaMark.exe --help` for the complete usage reference; ADR 0024 explains why the surface documents itself instead of shipping a manual.

## Alternatives and consequences

CLI alone lacks automatic tool discovery; MCP alone is inconvenient in shell pipelines. The owner selected both. A shared service prevents their diagnostics from diverging.

A custom syntax-only validator would diverge from the actual engines. A remote diagram service would transmit document content. A Java PlantUML sidecar adds a second runtime and different rendering behavior from the existing official TeaVM capability.

Packaging the tool with the application was originally left as a separate deployment change; ADR 0024 completed it. Future conversions should add a service capability and thin adapters, with explicit output paths and preservation tests. A future MCP transport must preserve the source/file access boundary; this decision does not authorize a network listener.

## Verification and review conditions

The original gate was `pnpm test:automation`, which ran real CLI subprocesses and official MCP client handshake/discovery/calls after installing Chromium. ADR 0024 replaced it with `cargo test` plus `pnpm test` for the host and page logic, and `pnpm release:packaged-automation` for the packaged executable, including an official MCP client session.

Revisit if the WebView requirement becomes an unacceptable distribution burden, the SDK generation loses maintenance, or the host's engine versions diverge from the editor. Source-fidelity changes, filesystem-writing MCP tools, and installed distribution need their own explicit boundaries and acceptance evidence.

References: [official MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/server), [Mermaid API](https://mermaid.js.org/config/usage.html), [official PlantUML engine API](https://www.npmjs.com/package/@plantuml/core), [local PlantUML decision](0018-plantuml-local-rendering.md).
