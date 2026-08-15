import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const reportDirectory = resolve('artifacts/context-menu-report');
const workspaceRoot = 'E:/lumamark-e2e-workspace';

async function installWorkspaceMocks(page: Page): Promise<void> {
  await page.addInitScript(({ workspaceRoot }) => {
    type Entry = {
      kind: 'directory' | 'markdownFile';
      name: string;
      path: string;
    };

    const children = new Map<string, Entry[]>([
      [workspaceRoot, []],
    ]);
    const files = new Map<string, string>();

    window.__LUMAMARK_E2E_WORKSPACE__ = {
      createDirectory: async ({ name, parentPath }) => {
        const path = `${parentPath}/${name}`;
        const entry: Entry = { kind: 'directory', name, path };
        const list = children.get(parentPath) ?? [];
        list.push(entry);
        children.set(parentPath, list);
        children.set(path, []);
        return { ok: true, data: entry };
      },
      createFile: async ({ name, parentPath }) => {
        const path = `${parentPath}/${name}`;
        const entry: Entry = { kind: 'markdownFile', name, path };
        const list = children.get(parentPath) ?? [];
        list.push(entry);
        children.set(parentPath, list);
        files.set(path, `# ${name}\n`);
        return { ok: true, data: entry };
      },
      deleteEntry: async ({ path }) => {
        for (const [parent, list] of children.entries()) {
          children.set(
            parent,
            list.filter((entry) => entry.path !== path),
          );
        }
        files.delete(path);
        children.delete(path);
        return { ok: true, data: undefined };
      },
      listChildren: async (path) => ({
        ok: true,
        data: children.get(path) ?? [],
      }),
      openDirectory: async () => ({
        ok: true,
        data: { name: 'Workspace', path: workspaceRoot },
      }),
      openPath: async (path) => ({
        ok: true,
        data: { name: 'Workspace', path },
      }),
      renameEntry: async ({ newName, path }) => {
        const parent = path.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
        const nextPath = `${parent}/${newName}`;
        for (const [key, list] of children.entries()) {
          children.set(
            key,
            list.map((entry) =>
              entry.path === path
                ? { ...entry, name: newName, path: nextPath }
                : entry,
            ),
          );
        }
        const text = files.get(path);
        if (text != null) {
          files.delete(path);
          files.set(nextPath, text);
        }
        return {
          ok: true,
          data: {
            kind: 'markdownFile',
            name: newName,
            path: nextPath,
          },
        };
      },
    };

    window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
      readText: async (path) => {
        const text = files.get(path) ?? '';
        return {
          ok: true,
          data: {
            byteLength: text.length,
            fingerprint: `sha256:${path}:${text.length}`,
            path,
            text,
          },
        };
      },
      showOpenDialog: async () => ({ ok: true, data: null }),
      showOpenImageDialog: async () => ({ ok: true, data: null }),
      showSaveDialog: async () => ({ ok: true, data: null }),
      writeText: async (path, text) => {
        files.set(path, text);
        return {
          ok: true,
          data: {
            byteLength: text.length,
            fingerprint: `sha256:${path}:${text.length}`,
            path,
          },
        };
      },
    };
  }, { workspaceRoot });
}

async function openWorkspaceFromStartScreen(page: Page): Promise<void> {
  await page.goto('/');
  await expect
    .poll(() =>
      page.evaluate(
        () => typeof window.__LUMAMARK_E2E_WORKSPACE__?.openDirectory,
      ),
    )
    .toBe('function');
  await page.getByRole('button', { name: /^(?:Open Workspace|打开工作区)$/ }).click();
  await expect(page.getByTestId('file-tree-workspace-root')).toBeVisible();
}

test('creates a markdown file from the file-tree context menu and opens it', async ({
  page,
}) => {
  await installWorkspaceMocks(page);
  await openWorkspaceFromStartScreen(page);

  await page.getByTestId('file-tree-workspace-root').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^(?:New File|新建文件)$/ }).click();
  const dialog = page.getByRole('dialog', {
    name: /^(?:Create file|新建文件)$/,
  });
  await expect(dialog).toBeVisible();
  const name = dialog.getByRole('textbox', {
    name: /^(?:File name|文件名)$/,
  });
  await name.fill('created.md');
  await dialog
    .getByRole('button', { name: /^(?:Create|创建)$/ })
    .click();

  const treeRow = page.getByTestId(
    'file-tree-row-E:/lumamark-e2e-workspace/created.md',
  );
  await expect(treeRow).toBeVisible();
  await expect(page.locator('.cm-content')).toContainText('# created.md');
});

test('does not open a root menu on sidebar controls and supports keyboard context menus', async ({
  page,
}) => {
  await installWorkspaceMocks(page);
  await openWorkspaceFromStartScreen(page);

  await page
    .getByRole('button', { name: /^(?:Open Workspace|打开工作区)$/ })
    .click({ button: 'right' });
  await expect(page.getByRole('menu')).toHaveCount(0);

  const root = page.getByTestId('file-tree-workspace-root');
  await root.focus();
  await page.keyboard.press('Shift+F10');
  await expect(
    page.getByRole('menuitem', { name: /^(?:New File|新建文件)$/ }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(root).toBeFocused();
});

test('requires confirmation before moving a file-tree entry to the recycle bin', async ({
  page,
}) => {
  await installWorkspaceMocks(page);
  await openWorkspaceFromStartScreen(page);

  await page.getByTestId('file-tree-workspace-root').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^(?:New File|新建文件)$/ }).click();
  const createDialog = page.getByRole('dialog', {
    name: /^(?:Create file|新建文件)$/,
  });
  await createDialog
    .getByRole('textbox', { name: /^(?:File name|文件名)$/ })
    .fill('trash-me.md');
  await createDialog
    .getByRole('button', { name: /^(?:Create|创建)$/ })
    .click();

  const row = page.getByTestId(
    'file-tree-row-E:/lumamark-e2e-workspace/trash-me.md',
  );
  await expect(row).toBeVisible();
  await row.click({ button: 'right' });
  await page
    .getByRole('menuitem', {
      name: /^(?:Move to Recycle Bin|移到回收站)$/,
    })
    .click();

  const deleteDialog = page.getByRole('dialog', {
    name: /^(?:Move to recycle bin|移到回收站)$/,
  });
  await expect(deleteDialog).toContainText('trash-me.md');
  await deleteDialog
    .getByRole('button', { name: /^(?:Cancel|取消)$/ })
    .click();
  await expect(row).toBeVisible();

  await row.click({ button: 'right' });
  await page
    .getByRole('menuitem', {
      name: /^(?:Move to Recycle Bin|移到回收站)$/,
    })
    .click();
  await page
    .getByRole('dialog', {
      name: /^(?:Move to recycle bin|移到回收站)$/,
    })
    .getByRole('button', {
      name: /^(?:Move to recycle bin|移到回收站)$/,
    })
    .click();
  await expect(row).toBeHidden();
});

test('captures light and dark file-tree context menu screenshots', async ({
  page,
}) => {
  await mkdir(reportDirectory, { recursive: true });
  await page.setViewportSize({ height: 900, width: 1440 });
  await installWorkspaceMocks(page);
  await openWorkspaceFromStartScreen(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => document.fonts.ready);

  await page.getByTestId('file-tree-workspace-root').click({ button: 'right' });
  await expect(
    page.getByRole('menuitem', { name: /^(?:New File|新建文件)$/ }),
  ).toBeVisible();
  await page.screenshot({
    path: resolve(reportDirectory, 'file-tree-context-menu-light-zh.png'),
  });

  await page.keyboard.press('Escape');
  await page.locator('.lm-menu-trigger', { hasText: '主题' }).click();
  await page.getByRole('menuitemradio', { name: '暗色' }).click();

  await page.getByTestId('file-tree-workspace-root').click({ button: 'right' });
  await expect(
    page.getByRole('menuitem', { name: /^(?:New File|新建文件)$/ }),
  ).toBeVisible();
  await page.screenshot({
    path: resolve(reportDirectory, 'file-tree-context-menu-dark-zh.png'),
  });
});
