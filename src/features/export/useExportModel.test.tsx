import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../app/providers/I18nProvider';
import type { FileMetadata } from '../../services/files/fileTypes';
import { useExportModel } from './useExportModel';

const commands = vi.hoisted(() => ({
  getExportCapabilities: vi.fn(),
  printExportPdf: vi.fn(),
  showExportSaveDialog: vi.fn(),
  writeExportHtml: vi.fn(),
}));
const pdfStage = vi.hoisted(() => ({
  mountExportPdfStage: vi.fn(),
  printWithSystemDialog: vi.fn(),
}));
const renderer = vi.hoisted(() => ({
  renderExportDocument: vi.fn(),
}));

vi.mock('../../services/export/exportCommands', () => commands);
vi.mock('./exportPdfStage', () => pdfStage);
vi.mock('./renderExportDocument', () => renderer);

const currentFile: FileMetadata = {
  name: 'note.md',
  path: 'E:\\notes\\note.md',
};

function wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  commands.getExportCapabilities.mockResolvedValue({
    data: { maxAssetBytes: 10, maxHtmlBytes: 10, pdfMode: 'print-dialog' },
    ok: true,
  });
  commands.showExportSaveDialog.mockResolvedValue({
    data: 'E:\\notes\\note.html',
    ok: true,
  });
  commands.writeExportHtml.mockImplementation(
    async ({ path }: { path: string }) => ({
      data: { byteLength: 10, path },
      ok: true,
    }),
  );
  commands.printExportPdf.mockResolvedValue({
    data: { byteLength: 10, path: 'E:\\notes\\note.pdf' },
    ok: true,
  });
  pdfStage.mountExportPdfStage.mockResolvedValue(vi.fn());
  pdfStage.printWithSystemDialog.mockResolvedValue(undefined);
  renderer.renderExportDocument.mockResolvedValue({
    bytes: 10,
    html: '<!doctype html><html></html>',
    title: 'note',
    warnings: [],
  });
});

function renderModel() {
  return renderHook(
    () =>
      useExportModel({
        currentFile,
        focusEditor: vi.fn(),
        getDocumentText: () => '# note',
      }),
    { wrapper },
  );
}

describe('useExportModel', () => {
  it('writes HTML after the save dialog and reports success', async () => {
    const { result } = renderModel();

    act(() => result.current.exportHtml());

    await waitFor(() => expect(result.current.state.status).toBe('done'));
    expect(commands.showExportSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'html',
        suggestedName: 'note.html',
      }),
    );
    expect(commands.writeExportHtml).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'E:\\notes\\note.html',
      }),
    );
    expect(result.current.state.path).toBe('E:\\notes\\note.html');
  });

  it('closes silently when the save dialog is cancelled', async () => {
    commands.showExportSaveDialog.mockResolvedValue({ data: null, ok: true });
    const { result } = renderModel();

    act(() => result.current.exportHtml());

    await waitFor(() => expect(result.current.state.open).toBe(false));
    expect(commands.writeExportHtml).not.toHaveBeenCalled();
  });

  it('surfaces a rendering failure in the dialog', async () => {
    renderer.renderExportDocument.mockRejectedValue(new Error('boom'));
    const { result } = renderModel();

    act(() => result.current.exportHtml());

    await waitFor(() => expect(result.current.state.status).toBe('error'));
    expect(result.current.state.error).toMatchObject({
      code: 'export.render_failed',
    });
  });

  it('mounts the PDF stage and uses the system dialog when direct PDF is unavailable', async () => {
    const cleanup = vi.fn();
    pdfStage.mountExportPdfStage.mockResolvedValue(cleanup);
    const { result } = renderModel();

    act(() => result.current.exportPdf());

    await waitFor(() => expect(result.current.state.status).toBe('done'));
    expect(commands.showExportSaveDialog).not.toHaveBeenCalled();
    expect(pdfStage.mountExportPdfStage).toHaveBeenCalledOnce();
    expect(pdfStage.printWithSystemDialog).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
