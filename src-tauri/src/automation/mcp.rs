//! MCP stdio server exposing the same checks as the CLI.
//!
//! Tools are declared here rather than through a schema derive so the
//! descriptions follow `LUMAMARK_TOOLS_LANGUAGE`, exactly like `--help`.

use std::borrow::Cow;
use std::sync::Arc;

use rmcp::model::{
    CallToolRequestParams, CallToolResponse, CallToolResult, ContentBlock, Implementation,
    ListToolsResult, PaginatedRequestParams, ServerCapabilities, ServerInfo, Tool, ToolAnnotations,
};
use rmcp::service::RequestContext;
use rmcp::{ErrorData as McpError, RoleServer, ServerHandler, ServiceExt};
use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::automation::host::{RenderHost, RenderMode};
use crate::automation::messages::Messages;
use crate::automation::report::{error_report, Report, MAX_SOURCE_BYTES};

pub const CHECK_TOOL: &str = "check_diagrams";
pub const RENDER_TOOL: &str = "render_diagram";

const CHECK_FORMATS: &[&str] = &["markdown", "mermaid", "plantuml"];
const RENDER_FORMATS: &[&str] = &["mermaid", "plantuml"];

#[derive(Debug, Deserialize)]
struct ToolArguments {
    source: String,
    #[serde(default)]
    format: Option<String>,
}

/// MCP server handler backed by the shared render host.
pub struct AutomationMcp {
    host: Arc<RenderHost>,
    messages: Messages,
}

impl AutomationMcp {
    pub fn new(host: Arc<RenderHost>) -> Self {
        let messages = host.messages();
        Self { host, messages }
    }

    /// Tool declarations, localized for the configured language.
    pub fn tools(&self) -> Vec<Tool> {
        vec![
            self.tool(CHECK_TOOL, self.messages.text().check_description, CHECK_FORMATS, false),
            self.tool(RENDER_TOOL, self.messages.text().render_description, RENDER_FORMATS, true),
        ]
    }

    fn tool(
        &self,
        name: &'static str,
        description: &'static str,
        formats: &[&str],
        format_required: bool,
    ) -> Tool {
        let mut tool = Tool::default();
        tool.name = Cow::Borrowed(name);
        tool.description = Some(Cow::Borrowed(description));
        tool.input_schema = Arc::new(self.input_schema(formats, format_required));

        let mut annotations = ToolAnnotations::default();
        annotations.read_only_hint = Some(true);
        annotations.destructive_hint = Some(false);
        annotations.idempotent_hint = Some(true);
        annotations.open_world_hint = Some(false);
        tool.annotations = Some(annotations);
        tool
    }

    fn input_schema(&self, formats: &[&str], format_required: bool) -> Map<String, Value> {
        let mut properties = Map::new();
        properties.insert(
            "source".to_owned(),
            json!({
                "type": "string",
                "description": self
                    .messages
                    .source_description(MAX_SOURCE_BYTES / (1024 * 1024)),
                "maxLength": MAX_SOURCE_BYTES,
            }),
        );
        properties.insert(
            "format".to_owned(),
            json!({
                "type": "string",
                "enum": formats,
                "description": format!("{}.", formats.join(", ")),
            }),
        );

        let schema = json!({
            "type": "object",
            "properties": Value::Object(properties),
            "required": if format_required {
                json!(["source", "format"])
            } else {
                json!(["source"])
            },
            "additionalProperties": false,
        });

        serde_json::from_value(schema).expect("the tool schema is a JSON object")
    }

    /// Runs one tool call and returns a report, or an invalid-params protocol
    /// error when the request itself is unusable.
    pub fn call(&self, name: &str, arguments: Map<String, Value>) -> Result<CallToolResult, McpError> {
        let formats: &[&str] = match name {
            CHECK_TOOL => CHECK_FORMATS,
            RENDER_TOOL => RENDER_FORMATS,
            other => {
                return Err(McpError::invalid_params(
                    format!("Unknown tool: {other}"),
                    None,
                ))
            }
        };

        let arguments: ToolArguments =
            serde_json::from_value(Value::Object(arguments)).map_err(|error| {
                McpError::invalid_params(format!("Invalid tool arguments: {error}"), None)
            })?;

        let format = match arguments.format.as_deref() {
            Some(format) if formats.contains(&format) => format.to_owned(),
            Some(other) => {
                return Err(McpError::invalid_params(
                    format!("Unsupported format `{other}`; expected one of {}.", formats.join(", ")),
                    None,
                ))
            }
            None if name == CHECK_TOOL => "markdown".to_owned(),
            None => {
                return Err(McpError::invalid_params(
                    format!("`{RENDER_TOOL}` requires a format: {}.", formats.join(", ")),
                    None,
                ))
            }
        };

        let mode = if name == CHECK_TOOL {
            RenderMode::Check
        } else {
            RenderMode::Render
        };
        let report = match self.host.render(&arguments.source, &format, mode) {
            Ok(report) => report,
            Err(error) => error_report(&error),
        };
        Ok(to_result(&report))
    }
}

fn to_result(report: &Report) -> CallToolResult {
    let mut result = CallToolResult::success(vec![ContentBlock::text(
        serde_json::to_string(report).unwrap_or_default(),
    )]);
    result.structured_content = serde_json::to_value(report).ok();
    result.is_error = Some(!report.ok);
    result
}

impl ServerHandler for AutomationMcp {
    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, McpError> {
        Ok(ListToolsResult {
            tools: self.tools(),
            ..Default::default()
        })
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, McpError> {
        let arguments = request.arguments.unwrap_or_default();
        self.call(&request.name, arguments).map(Into::into)
    }

    fn get_info(&self) -> ServerInfo {
        let mut info = ServerInfo::default();
        info.capabilities = ServerCapabilities::builder().enable_tools().build();

        let mut implementation = Implementation::default();
        implementation.name = "lumamark".to_owned();
        implementation.title = Some("LumaMark".to_owned());
        implementation.version = env!("CARGO_PKG_VERSION").to_owned();
        implementation.description = Some(self.messages.text().tagline.to_owned());
        implementation.website_url = None;
        info.server_info = implementation;
        info.instructions = Some(self.messages.text().mcp_instructions.to_owned());
        info
    }
}

/// Serves this automation host over stdio until the client closes it.
pub async fn serve(host: Arc<RenderHost>) -> Result<(), String> {
    let service = AutomationMcp::new(host)
        .serve(rmcp::transport::io::stdio())
        .await
        .map_err(|error| error.to_string())?;
    service.waiting().await.map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::automation::messages::Locale;
    use crate::automation::report::Report;

    fn server(locale: Locale) -> AutomationMcp {
        let host = RenderHost::new(Messages::new(locale));
        host.mark_ready();
        AutomationMcp::new(host.shared())
    }

    #[test]
    fn both_tools_are_declared_with_annotations_and_schemas() {
        let server = server(Locale::En);
        let tools = server.tools();

        let names: Vec<&str> = tools.iter().map(|tool| tool.name.as_ref()).collect();
        assert_eq!(names, vec![CHECK_TOOL, RENDER_TOOL]);

        let check = &tools[0];
        assert!(check.description.as_deref().unwrap_or_default().contains("Markdown"));
        let annotations = check.annotations.as_ref().expect("annotations");
        assert_eq!(annotations.read_only_hint, Some(true));
        assert_eq!(annotations.open_world_hint, Some(false));

        let schema = Value::Object(check.input_schema.as_ref().clone());
        assert_eq!(schema["required"], json!(["source"]));
        assert_eq!(
            schema["properties"]["format"]["enum"],
            json!(["markdown", "mermaid", "plantuml"])
        );

        let render_schema = Value::Object(tools[1].input_schema.as_ref().clone());
        assert_eq!(render_schema["required"], json!(["source", "format"]));
        assert_eq!(
            render_schema["properties"]["format"]["enum"],
            json!(["mermaid", "plantuml"])
        );
    }

    #[test]
    fn tool_descriptions_follow_the_configured_language() {
        let english = server(Locale::En).tools();
        let chinese = server(Locale::ZhCn).tools();

        assert!(english[0]
            .description
            .as_deref()
            .unwrap_or_default()
            .starts_with("Check Mermaid"));
        assert!(chinese[0]
            .description
            .as_deref()
            .unwrap_or_default()
            .starts_with("在本地检测"));
    }

    #[test]
    fn unknown_tools_and_formats_are_rejected_before_rendering() {
        let server = server(Locale::En);

        let unknown = server.call("not_a_tool", Map::new()).expect_err("must fail");
        assert_eq!(unknown.code, rmcp::model::ErrorCode::INVALID_PARAMS);

        let bad_format = server
            .call(
                RENDER_TOOL,
                serde_json::from_value(json!({ "source": "graph TD", "format": "yaml" }))
                    .expect("arguments"),
            )
            .expect_err("must fail");
        assert_eq!(bad_format.code, rmcp::model::ErrorCode::INVALID_PARAMS);

        let missing_format = server
            .call(
                RENDER_TOOL,
                serde_json::from_value(json!({ "source": "graph TD" })).expect("arguments"),
            )
            .expect_err("must fail");
        assert_eq!(missing_format.code, rmcp::model::ErrorCode::INVALID_PARAMS);
    }

    #[test]
    fn a_successful_report_is_structured_content_without_is_error() {
        let result = to_result(&Report::new(true, 2, Vec::new()));

        assert_eq!(result.is_error, Some(false));
        let structured = result.structured_content.expect("structured content");
        assert_eq!(structured["schemaVersion"], json!(1));
        assert_eq!(structured["checked"], json!(2));
    }

    #[test]
    fn a_failed_report_sets_is_error_and_keeps_the_diagnostics() {
        let report = Report::failure("diagram.invalid", "bad");
        let result = to_result(&report);

        assert_eq!(result.is_error, Some(true));
        let structured = result.structured_content.expect("structured content");
        assert_eq!(structured["diagnostics"][0]["code"], json!("diagram.invalid"));
    }
}
