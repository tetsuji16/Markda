# Markda

[English](../README.md) · [日本語](README.ja.md) · **简体中文** · [Español](README.es.md) · [Deutsch](README.de.md)

**编辑所见内容，保留属于你的 Markdown。**

Markda 是面向 VS Code Desktop、保留 Markdown 源码的编辑器。它适合希望像编辑排版文档一样轻松写作，同时保留清晰易读 Markdown 文件的作者、开发者、研究人员和笔记用户。你可以直接编辑标题、任务列表、表格、代码、数学公式、图表和图片；磁盘上的文件始终是简洁、可移植的 Markdown。

[官方网站](https://o-server.main.jp/markda/) · [从 Visual Studio Marketplace 安装](https://marketplace.visualstudio.com/items?itemName=tetsuji16.markda) · [在 GitHub 查看源代码](https://github.com/tetsuji16/Markda) · [报告问题](https://github.com/tetsuji16/Markda/issues)

Markda 0.1 是预览版。

> **查看 Markda 的实际效果：**[观看 16 秒介绍视频](../media/videos/markda-intro.mp4) · [观看 GUI 操作演示](../media/videos/markda-gui-demo.mp4)

## 开始使用

1. 从 [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=tetsuji16.markda) 安装 Markda。
2. 打开 Markdown 文件。如果文件在 VS Code 标准文本编辑器中打开，请在编辑器标题中选择 **Open with markda**，运行 **Markda: Open with Markda**，或在编辑器标签菜单中选择 **Reopen Editor With… → Markda**。
3. 直接编辑渲染后的文档。需要编辑 Markdown 源码时，使用 `</>` 按钮或 **Markda: Toggle Source Code Mode**。

Markda 支持 `.md`、`.markdown`、`.mdown`、`.mkd`、`.mkdn`、`.mdwn` 和 `.txt` 文件。要返回 VS Code 内置编辑器，请在 Markda 编辑器标题中选择 **Reopen with Another Editor**。

![Markda — 编辑渲染后的文档，同时保留简洁、可移植的 Markdown 源码](../media/marketing/marketplace-hero.png)

## 为保留源码而设计

![Markda 实时编辑器的产品展示：源码模式、专注和打字机模式、表格、任务、数学公式、代码及本地 Markdown 渲染](../media/screenshots/live-editing.png)

VS Code 文本文档始终是唯一事实来源。Markda 只修改相关内容，并保留未改动内容和 Markdown 语法。需要直接检查或修改源码时，可以切换到完整源码视图。

## 管理关联文档

- **折叠章节：**将鼠标悬停在标题旁，使用折叠标记。Outline 菜单提供 Fold All Sections、Expand All Sections 和 Focus Current Section。导航到标题时会自动展开所属章节。折叠不会修改 Markdown 文件。
- **检查链接：**编辑后会检查指向本地文件、图片和 Markdown 标题的链接。运行 **Markda: Check Document Links** 可在 Problems 中查看结果。不会请求远程 URL。使用 `markda.links.checkOnEdit` 关闭自动检查。
- **从模板创建文档：**运行 **Markda: New Document from Template**，可创建会议记录、项目规格或每日日志。新文档以未保存状态打开。可在 `markda.templates` 中添加 `{name, description, body}` 条目来自定义模板；创建文档时会替换 `{{title}}` 和 `{{date}}`。
- **重命名时更新链接：**通过 VS Code 或 Markda 重命名文件或文件夹。检查重命名前后的目标，取消不需要的更改后确认。按 Escape 可继续重命名但不更新链接。相对路径、标题锚点、查询字符串和链接标题都会保留；围栏代码、缩进代码和行内代码不在更新范围内。更新使用 VS Code 工作区编辑，可撤销。使用 `markda.links.updateOnRename` 关闭此功能。
- **查找引用文档：**打开折叠的 **Backlinks** 视图或运行 **Markda: Show Backlinks**。点击结果即可打开文档。在其他文件编辑链接后，请刷新视图。

Backlinks 和重命名链接检查最多扫描当前工作区中的 5,000 个 Markdown/文本文件，并排除依赖项和构建目录。扫描会读取已打开文档（包括未保存的编辑）。更新链接需要受信任的工作区，范围包括 Markdown 链接/图片目标和引用定义；不会改写 HTML 链接，也不会处理在 VS Code 外执行的重命名。

## 功能亮点

- 直接编辑受支持的 CommonMark 和 Markda 扩展语法，包括引用链接和图片、脚注、缩进代码、字符实体、emoji 短代码、YAML Front Matter、`[toc]` 及明确允许的 HTML；也可切换到完整源码视图。
- 支持适合文档的段落换行、智能 HTML 转 Markdown 粘贴，以及使用修饰键点击打开链接。
- 直接编辑表格单元格，操作行列、拖动排序、调整大小和对齐方式，并用 Tab 键导航。
- 无需切换源码模式即可编辑带语法高亮的代码块；撤销和重做行为统一。
- 使用 KaTeX 渲染数学公式、带编号和标签的公式及其引用，并使用 Mermaid 渲染图表；文档内容不会发送到在线渲染服务。
- 插入多张图片，也可将剪贴板图片保存到可配置的资源文件夹，或拖放图片。
- 使用可筛选的 Outline 和 Files 视图、工作区 Markdown 搜索及 Quick Open 导航。
- 使用专注模式、打字机模式、浅色和深色主题、查找及文档统计。
- 导出带样式或纯 HTML；通过已安装的 Chromium 系浏览器创建 PDF；也可调用 Pandoc 等可信外部导出目标。
- 跟随文档内和跨文档的标题链接，并在实时编辑器中查看拼写检查器、markdownlint、Vale 等语言工具提供的 VS Code 诊断。
- 通过底层 VS Code 文本文档同步分屏编辑器。
- 在打开的 Markdown 标签页之间同步所选编辑器主题。
- 优化统计、Outline 跟踪和实时视图光标更新，让长文档保持响应迅速。
- 使用响应式工具栏、选区控件、链接对话框或 `/` 快速插入功能设置格式，无需离开渲染视图。
- 在编辑器状态栏查看保存同步状态、当前章节、文档统计和可操作的诊断信息。

Markda 活动栏视图提供文档大纲和 Markdown 文件导航。

## 常用命令和快捷键

Markda 提供的快捷键默认关闭，以免覆盖 VS Code 快捷键。启用 **Markda › Editor: Enable Default Keybindings** 后即可使用下表按键；也可在 Markda 编辑器工具栏中调整快捷键优先级，或在 **Keyboard Shortcuts** 中为各个 `Markda:` 命令单独分配按键。

| 操作 | Windows/Linux | macOS |
| --- | --- | --- |
| 切换源码模式 | `Ctrl+/` | `Cmd+/` |
| 切换专注模式 | `F8` | `F8` |
| 切换打字机模式 | `F9` | `F9` |
| 粗体 | `Ctrl+B` | `Cmd+B` |
| 斜体 | `Ctrl+I` | `Cmd+I` |
| 插入链接 | `Ctrl+K` | `Cmd+K` |
| 有序列表 | `Ctrl+Shift+[` | `Cmd+Option+O` |
| 无序列表 | `Ctrl+Shift+]` | `Cmd+Option+U` |
| 引用块 | `Ctrl+Shift+Q` | `Cmd+Option+Q` |
| 代码块 | `Ctrl+Shift+K` | `Cmd+Option+C` |
| 删除线 | `Alt+Shift+5` | `Ctrl+Shift+Backtick` |
| 复制为 Markdown | `Ctrl+Shift+C` | `Cmd+Shift+C` |
| 粘贴为纯文本 | `Ctrl+Shift+V` | `Cmd+Shift+V` |

在命令面板中搜索 `Markda:`，可查看所有可用命令，包括插入表格和数学公式、工作区搜索、统计、HTML/PDF 导出及已配置的外部导出目标。

运行 **Markda: Configure File Associations**，可选择默认由 Markda 打开的文件扩展名：`.md`、`.markdown`、`.mdown`、`.mkd`、`.mkdn`、`.mdwn` 和 `.txt`。关联设置可保存到当前用户或当前工作区。设置保存在 VS Code 的 `workbench.editorAssociations` 中，之后也可在 Settings 中查看或修改。

## 设置

`markda.*` 设置可控制编辑器宽度、定界符配对、打字机行为、分屏预览延迟、实时表格大小上限、Markdown 功能、图片路径、主题、导出行为、远程资源和不安全 HTML。`markda.export.pdfBrowserPath` 用于选择自定义 Edge/Chrome/Chromium 可执行文件；留空时，Markda 会在 `PATH` 及常见系统和用户应用目录中搜索。`markda.export.targets` 可注册可信的参数数组命令，并使用 `${source}`、`${destination}`、`${documentDir}`、`${documentName}` 和 `${workspaceFolder}`。打开 **Settings** 并搜索 `markda`，即可查看说明和默认值。

默认情况下，加载远程资源前需要确认，且不安全 HTML 已禁用。在不受信任的工作区中，工作区控制的图片目标和安全设置覆盖项会受到限制。

## 要求和支持范围

- VS Code Desktop 1.100 或更高版本
- 支持本地或远程桌面扩展宿主；此版本不是面向 `vscode.dev` 的 Web 扩展
- 支持 HTML 和 PDF 导出。其他格式可配置外部导出目标，但不会附带转换工具。
- 扩展 UI 支持英语、阿拉伯语、德语、西班牙语、法语、日语、韩语、巴西葡萄牙语、俄语、简体中文和繁体中文。VS Code 会使用设置中选择的显示语言。

## 隐私与安全

Markda 不包含遥测。Markdown 渲染以及内置的图表和数学公式功能均在本地运行。打开外部链接或加载远程资源仍受 Markda 安全设置和 VS Code Workspace Trust 控制。

## 开发

```text
npm install
npm run check
npm test
npm run build
```

在 VS Code 中按 `F5`，会打开使用 `docs/DEMO.md` 的 Extension Development Host。兼容性约定和实现状态见 [`docs/SPECIFICATION.md`](SPECIFICATION.md)，发布清单见 [`docs/PUBLISHING.md`](PUBLISHING.md)。

欢迎通过 [GitHub Issues](https://github.com/tetsuji16/Markda/issues) 报告问题或提出具体的功能建议。

## 许可证

MIT
