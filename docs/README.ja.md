# Markda

[English](../README.md) · **日本語**

**見たまま編集。Markdown は自分の手元に。**

Markda は VS Code Desktop 向けの、Markdown ソースを保つエディターです。読みやすい Markdown ファイルを保ちながら、整形された文書のように編集したいライター、開発者、研究者、ノートを取る人に向いています。見出し、タスクリスト、表、コード、数式、図、画像を表示したまま編集でき、ディスク上にはシンプルで持ち運びやすい Markdown が残ります。

[Visual Studio Marketplace からインストール](https://marketplace.visualstudio.com/items?itemName=tetsuji16.markda) · [GitHub でソースを見る](https://github.com/tetsuji16/Markda) · [不具合を報告](https://github.com/tetsuji16/Markda/issues)

Markda 0.1 はプレビュー版です。

## 使い始める

1. [Visual Studio Marketplace から Markda をインストール](https://marketplace.visualstudio.com/items?itemName=tetsuji16.markda)します。
2. Markdown ファイルを開きます。VS Code 標準エディターで開いた場合は、エディタータイトルの **markdaで開く** ボタンを選びます。ボタンが見つからない場合は、コマンドパレットで **Markda: markdaで開く**（`Markda: Open with Markda`）を実行するか、エディタータブのメニューから **Reopen Editor With… → Markda** を選びます。
3. 表示された文書をそのまま編集します。Markdown ソースを直接編集するときは `</>` ボタンまたは **Markda: ソースコードモードを切り替え**（`Markda: Toggle Source Code Mode`）を使います。

`.md`、`.markdown`、`.mdown`、`.mkd`、`.mkdn`、`.mdwn`、`.txt` ファイルに対応しています。VS Code 標準エディターに戻るには、Markda エディターのタイトルにある **別のエディターで開き直す**（`Reopen with Another Editor`）を使います。

![Markda — 表示された文書を編集しながら、読みやすく持ち運びやすい Markdown ソースを保ちます](../media/marketing/marketplace-hero.png)

## Markdown ソースを保つ設計

![Markda のライブエディター。ソースモード、集中・タイプライターモード、表、タスク、数式、コード、ローカル Markdown 描画を紹介](../media/screenshots/live-editing.png)

VS Code のテキスト文書が常に唯一の正本です。Markda は必要な箇所だけを編集し、変更していない内容や Markdown の記法を保ちます。必要なときは全文ソース表示に切り替えて確認・編集できます。

## 関連文書を整理する

- **セクションを折りたたむ:** 見出し横のマーカーで折りたためます。Outline メニューからすべてのセクションを折りたたむ・展開する、現在のセクションに集中する操作もできます。折りたたみは Markdown ファイルを変更しません。
- **リンクを確認する:** 編集後にローカルファイル、画像、Markdown 見出しへのリンクを検査します。**Markda: Check Document Links** を実行すると Problems に結果が表示されます。外部 URL にはアクセスしません。自動検査は `markda.links.checkOnEdit` で無効にできます。
- **テンプレートから文書を作る:** **Markda: New Document from Template** で議事録、プロジェクト仕様書、日誌などを作成できます。作成した文書は未保存の状態で開きます。`markda.templates` に `{name, description, body}` を追加して独自テンプレートを設定できます。`{{title}}` と `{{date}}` は作成時に置き換わります。
- **名前変更時にリンクを更新する:** VS Code または Markda からファイルやフォルダーの名前を変更すると、リンク先の変更内容を確認できます。不要な変更を外してから確定できます。Escape キーを押すとリンクを更新せずに名前を変更します。相対パス、見出しアンカー、クエリ文字列、リンクタイトルを保ち、フェンス付き・インデント・インラインのコード内は更新しません。VS Code のワークスペース編集を使うため、元に戻せます。`markda.links.updateOnRename` で無効にできます。
- **参照元を探す:** 折りたたまれた **Backlinks** ビューを開くか、**Markda: Show Backlinks** を実行します。結果をクリックすると文書を開けます。別ファイルでリンクを編集した場合はビューを更新してください。

Backlinks と名前変更時のリンク確認では、開いているワークスペース内の Markdown・テキストファイルを最大 5,000 件まで調べます。依存関係やビルド用フォルダーは除外し、未保存の内容も対象にします。リンク更新には信頼済みワークスペースが必要です。Markdown のリンク・画像の参照先と参照定義が対象で、HTML リンクや VS Code 外で行った名前変更は更新されません。

## 主な機能

- CommonMark と Markda 拡張記法のうち対応するものを、表示を保ったまま編集できます。参照リンク・画像、脚注、インデントコード、文字参照、絵文字ショートコード、YAML Front Matter、`[toc]`、明示的に許可した HTML に対応します。全文ソース表示にも切り替えられます。
- 文書向けの段落改行、HTML から Markdown へのスマート貼り付け、修飾キーを使ったリンクのクリック操作に対応します。
- 表のセルを直接編集し、行・列の操作、ドラッグ並べ替え、サイズ変更、配置、Tab キーでの移動ができます。
- シンタックスハイライト付きコードブロックをソースモードに切り替えずに編集できます。Undo/Redo は文書編集と連動します。
- KaTeX の数式、番号付き・ラベル付きの数式と参照、Mermaid 図をローカルで描画します。文書をオンライン描画サービスに送信しません。
- 複数画像の挿入、クリップボード画像の保存、ドラッグ＆ドロップに対応。画像の保存先フォルダーを設定できます。
- 絞り込み可能な Outline / Files ビュー、ワークスペース内 Markdown 検索、Quick Open で移動できます。
- 集中モード、タイプライターモード、ライト・ダークテーマ、検索、文書統計を利用できます。
- スタイル付きまたはシンプルな HTML を書き出せます。インストール済み Chromium 系ブラウザーで PDF を作成したり、Pandoc など信頼した外部の書き出し先を設定したりできます。
- 文書内・文書間の見出しリンクをたどれます。スペルチェッカー、markdownlint、Vale など言語ツールの VS Code 診断をライブエディターに表示できます。
- VS Code のテキスト文書を介して分割エディターを同期します。
- 開いている Markdown タブ間で選択中のエディターテーマを同期します。
- 統計、Outline の追跡、ライブビューのカーソル更新を最適化し、長い文書でも快適に使えます。
- ツールバー、選択範囲の操作、リンクダイアログ、`/` のクイック挿入から、表示を保ったまま書式を設定できます。
- 保存状態、現在のセクション、文書統計、対処可能な診断情報をステータスバーに表示します。

## コマンドとショートカット

Markda のショートカットは VS Code の既存キー設定を上書きしないよう、初期状態では無効です。**Markda › Editor: Enable Default Keybindings** を有効にすると次のキーを使えます。エディターツールバーでショートカットの優先順位を切り替えるか、Keyboard Shortcuts で `Markda:` コマンドごとに割り当てることもできます。

| 操作 | Windows/Linux | macOS |
| --- | --- | --- |
| ソースモード切り替え | `Ctrl+/` | `Cmd+/` |
| 集中モード切り替え | `F8` | `F8` |
| タイプライターモード切り替え | `F9` | `F9` |
| 太字 | `Ctrl+B` | `Cmd+B` |
| 斜体 | `Ctrl+I` | `Cmd+I` |
| リンク挿入 | `Ctrl+K` | `Cmd+K` |
| 番号付きリスト | `Ctrl+Shift+[` | `Cmd+Option+O` |
| 箇条書き | `Ctrl+Shift+]` | `Cmd+Option+U` |
| 引用 | `Ctrl+Shift+Q` | `Cmd+Option+Q` |
| コードブロック | `Ctrl+Shift+K` | `Cmd+Option+C` |
| 取り消し線 | `Alt+Shift+5` | `Ctrl+Shift+Backtick` |
| Markdown としてコピー | `Ctrl+Shift+C` | `Cmd+Shift+C` |
| プレーンテキストとして貼り付け | `Ctrl+Shift+V` | `Cmd+Shift+V` |

コマンドパレットで `Markda:` を検索すると、表・数式の挿入、ワークスペース検索、統計、HTML/PDF 書き出し、設定済みの外部書き出し先などのコマンドを確認できます。

**Markda: Configure File Associations** で、`.md`、`.markdown`、`.mdown`、`.mkd`、`.mkdn`、`.mdwn`、`.txt` のどれを Markda で開くか選べます。設定は現在のユーザーまたはワークスペース単位で保存でき、VS Code の `workbench.editorAssociations` 設定からも確認・変更できます。

## 設定

`markda.*` 設定で、エディター幅、記号の補完、タイプライター動作、分割プレビューの遅延、ライブ表のサイズ上限、Markdown 機能、画像パス、テーマ、書き出し、リモートリソース、安全でない HTML を調整できます。`markda.export.pdfBrowserPath` で Edge / Chrome / Chromium のパスを指定できます。空欄の場合は PATH や一般的なアプリケーションの場所を検索します。`markda.export.targets` では `${source}`、`${destination}`、`${documentDir}`、`${documentName}`、`${workspaceFolder}` を使う信頼済みコマンドを登録できます。Settings で `markda` を検索すると、説明と初期値を確認できます。

初期状態では、リモートリソースを読み込む前に確認を求め、安全でない HTML は無効です。信頼されていないワークスペースでは、ワークスペースから制御できる画像保存先とセキュリティ設定が制限されます。

## 要件と対応範囲

- VS Code Desktop 1.100 以降
- ローカルまたはリモートのデスクトップ拡張ホストに対応。`vscode.dev` 向けの Web 拡張ではありません。
- HTML と PDF の書き出しに対応します。それ以外の形式は外部の書き出し先を設定できますが、変換ツールは同梱していません。
- 拡張機能の UI は、英語、アラビア語、ドイツ語、スペイン語、フランス語、日本語、韓国語、ブラジルポルトガル語、ロシア語、簡体字中国語、繁体字中国語に対応しています。表示言語は VS Code の設定に従います。

## プライバシーとセキュリティ

Markda はテレメトリーを含みません。Markdown の描画、同梱の図と数式の機能はローカルで動作します。外部リンクを開く操作やリモートリソースの読み込みは、Markda のセキュリティ設定と VS Code Workspace Trust に従います。

## 開発

```sh
npm install
npm run check
npm test
npm run build
```

VS Code で `F5` を押すと、`docs/DEMO.md` を使った Extension Development Host が開きます。互換性の仕様と実装状況は [`docs/SPECIFICATION.md`](SPECIFICATION.md)、リリース手順は [`docs/PUBLISHING.md`](PUBLISHING.md) を参照してください。

不具合や具体的な機能提案は [GitHub Issues](https://github.com/tetsuji16/Markda/issues) で受け付けています。

## ライセンス

MIT
