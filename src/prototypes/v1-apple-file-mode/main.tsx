import * as Menubar from '@radix-ui/react-menubar';
import * as Tabs from '@radix-ui/react-tabs';
import * as Tooltip from '@radix-ui/react-tooltip';
import {
  BookOpenText,
  CheckSquare,
  ChevronRight,
  Circle,
  Code2,
  FileText,
  Folder,
  Hash,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  SunMedium,
  Table2,
  Workflow,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Group as PanelGroup,
  Panel,
  Separator as PanelResizeHandle,
} from 'react-resizable-panels';
import { Tree, type NodeRendererProps } from 'react-arborist';
import './prototype.css';

type FileNode = {
  children?: FileNode[];
  id: string;
  name: string;
  status?: 'draft' | 'saved' | 'syncing';
};

type MenuGroup = {
  items: Array<{
    disabled?: boolean;
    label: string;
    shortcut?: string;
  }>;
  label: string;
};

type Theme = 'light' | 'dark';

const files: FileNode[] = [
  {
    id: 'workspace',
    name: 'LumaMark Notes',
    children: [
      {
        id: 'drafts',
        name: 'Drafts',
        children: [
          { id: 'intro', name: '产品愿景.md', status: 'saved' },
          { id: 'ux', name: 'V1 UX Review.md', status: 'draft' },
          { id: 'editor', name: '编辑体验拆解.md', status: 'saved' },
        ],
      },
      {
        id: 'docs',
        name: 'Docs',
        children: [
          { id: 'architecture', name: 'Architecture.md', status: 'saved' },
          { id: 'release', name: 'Release Checklist.md', status: 'syncing' },
          { id: 'i18n', name: 'i18n Strategy.md', status: 'saved' },
        ],
      },
      { id: 'meeting', name: 'Meeting Notes.md', status: 'saved' },
    ],
  },
];

const outline = [
  ['01', 'LumaMark V1 UX', 0],
  ['02', '默认文件管理模式', 1],
  ['03', '所见即所得基础语法', 1],
  ['04', 'Mermaid 与复杂块', 1],
  ['05', '源码模式', 1],
  ['06', '验收标准', 1],
] as const;

const menuGroups: MenuGroup[] = [
  {
    label: '文件',
    items: [
      { label: '新建文件', shortcut: 'Ctrl N' },
      { label: '打开文件...', shortcut: 'Ctrl O' },
      { label: '打开文件夹...' },
      { label: '保存', shortcut: 'Ctrl S' },
      { label: '另存为...', shortcut: 'Ctrl Shift S' },
    ],
  },
  {
    label: '编辑',
    items: [
      { label: '撤销', shortcut: 'Ctrl Z' },
      { label: '重做', shortcut: 'Ctrl Y' },
      { label: '剪切', shortcut: 'Ctrl X' },
      { label: '复制', shortcut: 'Ctrl C' },
      { label: '查找', shortcut: 'Ctrl F' },
    ],
  },
  {
    label: '段落',
    items: [
      { label: '标题 1', shortcut: 'Ctrl 1' },
      { label: '标题 2', shortcut: 'Ctrl 2' },
      { label: '无序列表' },
      { label: '任务列表' },
      { label: '引用' },
      { label: '代码块' },
    ],
  },
  {
    label: '格式',
    items: [
      { label: '加粗', shortcut: 'Ctrl B' },
      { label: '斜体', shortcut: 'Ctrl I' },
      { label: '删除线' },
      { label: '行内代码' },
      { label: '链接' },
      { label: '图片' },
    ],
  },
  {
    label: '视图',
    items: [
      { label: '切换侧栏', shortcut: 'Ctrl \\' },
      { label: '源码模式', shortcut: 'Ctrl /' },
      { label: '大纲' },
      { label: '专注编辑区' },
      { label: '放大' },
      { label: '缩小' },
    ],
  },
  {
    label: '主题',
    items: [
      { label: '亮色' },
      { label: '暗色' },
      { label: '跟随系统', disabled: true },
    ],
  },
  {
    label: '帮助',
    items: [
      { label: '快速开始' },
      { label: '快捷键' },
      { label: '关于 LumaMark' },
    ],
  },
];

function shouldStartWithSidebarOpen() {
  return typeof window === 'undefined' || window.innerWidth >= 860;
}

function PrototypeApp() {
  const [sidebarOpen, setSidebarOpen] = useState(shouldStartWithSidebarOpen);
  const [theme, setTheme] = useState<Theme>('light');
  const [sourceMode, setSourceMode] = useState(false);
  const selectedFile = useMemo(() => 'V1 UX Review.md', []);

  return (
    <Tooltip.Provider delayDuration={260}>
      <div
        className="prototype-app"
        data-theme={theme}
        data-testid="v1-ux-prototype"
      >
        <TopMenu
          onToggleSidebar={() => {
            setSidebarOpen((value) => !value);
          }}
          onToggleSource={() => {
            setSourceMode((value) => !value);
          }}
          onToggleTheme={() => {
            setTheme((value) => (value === 'light' ? 'dark' : 'light'));
          }}
          selectedFile={selectedFile}
          sidebarOpen={sidebarOpen}
          sourceMode={sourceMode}
          theme={theme}
        />

        <PanelGroup className="workspace-shell" orientation="horizontal">
          {sidebarOpen ? (
            <>
              <Panel defaultSize="278px" maxSize="380px" minSize="236px">
                <Sidebar selectedFile={selectedFile} />
              </Panel>
              <PanelResizeHandle className="resize-handle" />
            </>
          ) : null}

          <Panel minSize="540px">
            <EditorPane
              selectedFile={selectedFile}
              sourceMode={sourceMode}
            />
          </Panel>
        </PanelGroup>
      </div>
    </Tooltip.Provider>
  );
}

type TopMenuProps = {
  onToggleSidebar: () => void;
  onToggleSource: () => void;
  onToggleTheme: () => void;
  selectedFile: string;
  sidebarOpen: boolean;
  sourceMode: boolean;
  theme: Theme;
};

function TopMenu({
  onToggleSidebar,
  onToggleSource,
  onToggleTheme,
  selectedFile,
  sidebarOpen,
  sourceMode,
  theme,
}: TopMenuProps) {
  return (
    <header className="top-chrome">
      <div className="window-controls" aria-hidden="true">
        <span className="traffic traffic-red" />
        <span className="traffic traffic-yellow" />
        <span className="traffic traffic-green" />
      </div>

      <Menubar.Root className="menu-root">
        {menuGroups.map((group) => (
          <Menubar.Menu key={group.label}>
            <Menubar.Trigger className="menu-trigger">
              {group.label}
            </Menubar.Trigger>
            <Menubar.Portal>
              <Menubar.Content className="menu-content" align="start">
                <Menubar.Group>
                  {group.items.map((item) => (
                    <Menubar.Item
                      className="menu-item"
                      disabled={item.disabled}
                      key={item.label}
                    >
                      <span>{item.label}</span>
                      {item.shortcut ? (
                        <span className="shortcut">{item.shortcut}</span>
                      ) : null}
                    </Menubar.Item>
                  ))}
                </Menubar.Group>
              </Menubar.Content>
            </Menubar.Portal>
          </Menubar.Menu>
        ))}
      </Menubar.Root>

      <div className="chrome-title">
        <span className="title-dot" aria-hidden="true" />
        <span>{selectedFile}</span>
        <span className="title-muted">LumaMark Notes</span>
      </div>

      <div className="chrome-actions">
        <ChromeButton
          label={sidebarOpen ? '折叠侧栏' : '展开侧栏'}
          onClick={onToggleSidebar}
        >
          {sidebarOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
        </ChromeButton>
        <button
          aria-label={sourceMode ? '切换预览模式' : '切换源码模式'}
          aria-pressed={sourceMode}
          className={sourceMode ? 'mode-chip mode-chip-active' : 'mode-chip'}
          onClick={onToggleSource}
          type="button"
        >
          {sourceMode ? <Code2 /> : <BookOpenText />}
        </button>
        <ChromeButton
          label={theme === 'light' ? '切换到暗色' : '切换到亮色'}
          onClick={onToggleTheme}
        >
          {theme === 'light' ? <Moon /> : <SunMedium />}
        </ChromeButton>
      </div>
    </header>
  );
}

type ChromeButtonProps = {
  children: ReactNode;
  label: string;
  onClick: () => void;
};

function ChromeButton({ children, label, onClick }: ChromeButtonProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          aria-label={label}
          className="chrome-button"
          onClick={onClick}
          type="button"
        >
          {children}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip" sideOffset={8}>
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

type SidebarProps = {
  selectedFile: string;
};

function Sidebar({ selectedFile }: SidebarProps) {
  return (
    <aside className="sidebar" data-testid="v1-file-sidebar">
      <Tabs.Root className="sidebar-tabs" defaultValue="files">
        <div className="sidebar-header">
          <Tabs.List className="tab-list" aria-label="侧栏">
            <Tabs.Trigger className="tab-trigger" value="files">
              文件
            </Tabs.Trigger>
            <Tabs.Trigger className="tab-trigger" value="outline">
              大纲
            </Tabs.Trigger>
          </Tabs.List>
        </div>

        <Tabs.Content className="tab-panel" value="files">
          <div className="workspace-title">
            <span className="workspace-mark" aria-hidden="true" />
            <span>LumaMark Notes</span>
            <span className="workspace-count">9</span>
          </div>
          <Tree<FileNode>
            className="file-tree"
            data={files}
            height={586}
            indent={18}
            openByDefault
            rowHeight={31}
            width="100%"
          >
            {(props) => (
              <FileNodeRow {...props} selectedFile={selectedFile} />
            )}
          </Tree>
        </Tabs.Content>

        <Tabs.Content className="tab-panel" value="outline">
          <nav className="outline-list" aria-label="文档大纲">
            {outline.map(([index, label, depth], itemIndex) => (
              <button
                className={
                  itemIndex === 0
                    ? 'outline-item outline-item-active'
                    : 'outline-item'
                }
                data-depth={depth}
                key={index}
                type="button"
              >
                <span>{index}</span>
                {label}
              </button>
            ))}
          </nav>
        </Tabs.Content>
      </Tabs.Root>
    </aside>
  );
}

type FileNodeRowProps = NodeRendererProps<FileNode> & {
  selectedFile: string;
};

function FileNodeRow({ node, selectedFile, style }: FileNodeRowProps) {
  const isFolder = node.data.children && node.data.children.length > 0;
  const isSelected = node.data.name === selectedFile;

  return (
    <div
      className={isSelected ? 'file-row file-row-selected' : 'file-row'}
      onClick={() => {
        if (isFolder) {
          node.toggle();
        }
      }}
      style={style}
    >
      <span className="file-chevron">
        {isFolder ? (
          <ChevronRight
            className={node.isOpen ? 'chevron-open' : undefined}
            aria-hidden="true"
          />
        ) : null}
      </span>
      {isFolder ? (
        <Folder aria-hidden="true" className="row-icon folder-icon" />
      ) : (
        <FileText aria-hidden="true" className="row-icon file-icon" />
      )}
      <span className="file-name">{node.data.name}</span>
      {node.data.status ? (
        <FileStatus selected={isSelected} status={node.data.status} />
      ) : null}
    </div>
  );
}

type FileStatusProps = {
  selected: boolean;
  status: NonNullable<FileNode['status']>;
};

function FileStatus({ selected, status }: FileStatusProps) {
  if (status === 'saved') {
    return null;
  }

  return (
    <span className={`file-status file-status-${status}`}>
      <Circle aria-label={status === 'draft' ? '有未保存修改' : '正在同步'} />
      {selected ? <span>{status === 'draft' ? '草稿' : '同步'}</span> : null}
    </span>
  );
}

type EditorPaneProps = {
  selectedFile: string;
  sourceMode: boolean;
};

function EditorPane({ selectedFile, sourceMode }: EditorPaneProps) {
  return (
    <main className="editor-pane" data-testid="v1-editor-pane">
      <div className="document-topline">
        <div className="breadcrumb">
          <span>LumaMark Notes</span>
          <ChevronRight aria-hidden="true" />
          <span>Drafts</span>
          <ChevronRight aria-hidden="true" />
          <strong>{selectedFile}</strong>
        </div>
        <div className="document-meta">
          <span>Saved 12:48</span>
        </div>
      </div>

      <div className="editor-scroll">
        <article
          className={sourceMode ? 'paper paper-source' : 'paper'}
          data-testid="v1-document-paper"
        >
          {sourceMode ? <SourceDocument /> : <PreviewDocument />}
        </article>
      </div>

      <div className="status-strip">
        <span>{sourceMode ? '源码模式' : '实时预览'}</span>
        <span>Markdown</span>
        <span>1,284 字</span>
        <span>Ln 42, Col 8</span>
        <span>UTF-8</span>
      </div>
    </main>
  );
}

function PreviewDocument() {
  return (
    <div className="markdown-preview">
      <h1>文件管理模式下的优雅写作</h1>
      <p className="lead">
        左侧只承担文件和大纲，右侧只承担写作。界面保持接近原生桌面应用的低干扰结构，
        Markdown 在阅读态下呈现为正式文档，在编辑态下保留源码的精确控制。
      </p>

      <h2>默认文件管理模式</h2>
      <p>
        顶部菜单保留桌面软件的熟悉路径，文件树和大纲收敛到同一侧栏。
        中央编辑区不被工具栏、卡片或额外面板切碎，正文宽度稳定在舒适阅读范围内。
      </p>

      <blockquote>
        Markdown 源文件始终是唯一真实数据；所见即所得只是精致、可撤销、可解释的视觉层。
      </blockquote>

      <h2>所见即所得基础语法</h2>
      <p>
        普通段落、<strong>粗体</strong>、<em>斜体</em>、
        <del>删除线</del>、<a href="#preview">链接</a> 与
        <code>inline code</code> 需要在阅读态下像成稿一样自然。
      </p>

      <ul className="task-list">
        <li>
          <CheckSquare aria-hidden="true" />
          标题、段落、列表、引用、分割线保持稳定排版。
        </li>
        <li>
          <CheckSquare aria-hidden="true" />
          当前块显示必要 Markdown 符号，非当前块进入阅读态。
        </li>
        <li>
          <CheckSquare aria-hidden="true" />
          复制、粘贴、撤销重做和中文 IME 输入不能被视觉层破坏。
        </li>
      </ul>

      <div className="table-block">
        <div className="block-label">
          <Table2 aria-hidden="true" />
          Markdown Table
        </div>
        <table>
          <thead>
            <tr>
              <th>能力</th>
              <th>V1 状态</th>
              <th>验收重点</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>基础语法</td>
              <td>必须完成</td>
              <td>视觉层不改写源文</td>
            </tr>
            <tr>
              <td>Mermaid</td>
              <td>必须完成</td>
              <td>异步渲染和缓存</td>
            </tr>
            <tr>
              <td>长文滚动</td>
              <td>必须验证</td>
              <td>无明显掉帧</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Mermaid 与复杂块</h2>
      <p>
        Mermaid fenced block 在预览态下以图形呈现，源码模式下完整保留 fenced code。
      </p>

      <div className="mermaid-preview" aria-label="Mermaid 流程图预览">
        <div className="block-label">
          <Workflow aria-hidden="true" />
          Mermaid Preview
        </div>
        <div className="flow-row">
          <FlowNode icon={<FileText aria-hidden="true" />} label="Open Markdown" />
          <span className="flow-line" />
          <FlowNode icon={<Hash aria-hidden="true" />} label="Decorate Blocks" />
          <span className="flow-line" />
          <FlowNode icon={<BookOpenText aria-hidden="true" />} label="Write Smoothly" />
        </div>
      </div>

      <h2>源码模式</h2>
      <p>
        源码模式与预览模式共享同一份文档数据和撤销历史。切换只改变视图，不改变文件内容。
      </p>
    </div>
  );
}

type FlowNodeProps = {
  icon: ReactNode;
  label: string;
};

function FlowNode({ icon, label }: FlowNodeProps) {
  return (
    <div className="flow-node">
      {icon}
      <span>{label}</span>
    </div>
  );
}

function SourceDocument() {
  return (
    <pre className="source-document">
      <code>{`# 文件管理模式下的优雅写作

左侧只承担文件和大纲，右侧只承担写作。界面保持接近原生桌面应用的低干扰结构，Markdown 在阅读态下呈现为正式文档。

## 默认文件管理模式

顶部菜单保留桌面软件的熟悉路径，文件树和大纲收敛到同一侧栏。

> Markdown 源文件始终是唯一真实数据；所见即所得只是精致、可撤销、可解释的视觉层。

## 所见即所得基础语法

普通段落、**粗体**、*斜体*、~~删除线~~、[链接](#preview) 与 \`inline code\` 需要在阅读态下像成稿一样自然。

- [x] 标题、段落、列表、引用、分割线保持稳定排版。
- [x] 当前块显示必要 Markdown 符号，非当前块进入阅读态。
- [x] 复制、粘贴、撤销重做和中文 IME 输入不能被视觉层破坏。

| 能力 | V1 状态 | 验收重点 |
| --- | --- | --- |
| 基础语法 | 必须完成 | 视觉层不改写源文 |
| Mermaid | 必须完成 | 异步渲染和缓存 |
| 长文滚动 | 必须验证 | 无明显掉帧 |

\`\`\`mermaid
flowchart LR
  A[Open Markdown] --> B[Decorate Blocks]
  B --> C[Write Smoothly]
\`\`\`

## 源码模式

源码模式与预览模式共享同一份文档数据和撤销历史。切换只改变视图，不改变文件内容。`}</code>
    </pre>
  );
}

createRoot(document.getElementById('root')!).render(<PrototypeApp />);
