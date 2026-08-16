export const MATH_RENDER_ENGINE_VERSION =
  'mathjax@4.1.3+mathjax-newcm-font@4.1.3';

export type MathFormulaInput = {
  display: boolean;
  id: string;
  source: string;
};

export type MathRenderingPreferences = {
  numbering: 'none' | 'ams' | 'all';
  physics: boolean;
};

export type MathLayoutMetrics = {
  containerWidth: number;
  em: number;
  ex: number;
};

export type MathDocumentRenderRequest = {
  documentId: string;
  formulas: MathFormulaInput[];
  generation: number;
  layoutMetrics: MathLayoutMetrics;
  preferences: MathRenderingPreferences;
};

export type MathFormulaRenderResult = {
  chtml?: string;
  error?: string;
  id: string;
  labels: string[];
  sourceFingerprint?: string;
};

export type MathDocumentLabelTarget = {
  formulaId: string;
};

export type MathDocumentRenderResult = {
  documentId: string;
  documentLabels: Record<string, MathDocumentLabelTarget>;
  formulas: MathFormulaRenderResult[];
  generation: number;
  stylesheet: string;
};

export type MathDocumentWorkerRequest = {
  request: MathDocumentRenderRequest;
  type: 'render';
};

export type MathDocumentWorkerResponse =
  | {
      result: MathDocumentRenderResult;
      type: 'render-result';
    }
  | {
      documentId: string;
      error: string;
      generation: number;
      type: 'render-fatal';
    };
