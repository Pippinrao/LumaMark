/**
 * Compatibility entry for the automation renderer. The implementation lives in
 * `services/diagrams` so the export feature can reuse it without importing the
 * automation layer.
 */
export {
  MERMAID_EXPORT_CONFIG,
  renderDiagram,
} from '../../services/diagrams/diagramRenderer';
export type {
  DiagramInput,
  DiagramRenderResult,
  DiagramRendererMessages,
} from '../../services/diagrams/diagramRenderer';
