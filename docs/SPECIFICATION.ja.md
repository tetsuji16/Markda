# markda 仕様書

## 1. 適用範囲

markdaはVS Code Desktop上で動作する、原文保持型のMarkdownカスタムエディターである。Windows、macOS、Linuxのローカルワークスペースを対象とし、Remote、Web、モバイルは対象外とする。対象拡張子は`.md`、`.markdown`、`.mdown`、`.mkd`、`.mkdn`、`.mdwn`、`.txt`である。

Typoraの商標・ロゴ・同梱資産は使用しない。公開仕様および合法的に観察できる入出力との文書・操作互換性を目標とする。テレメトリは行わず、外部URLは設定されたポリシーに従って確認する。

## 2. 文書モデル

- VS Codeの`TextDocument`を永続データの唯一の正本とする。
- Webviewは文書バージョンと同期済みテキストを保持し、一度に一つの差分を送信する。
- WebviewはCodeMirrorの変更セットを入力フレーム単位で合成し、全文比較を行わずに差分を送信する。非表示化・終了時は、期待するホスト本文が一致する場合だけ最終差分を適用する。
- 差分はUTF-16オフセットの`from`、`to`、`insert`で表し、共通接頭辞・接尾辞を除いた最小の単一置換として送信する。
- 拡張ホストは`baseVersion`が現在の`TextDocument.version`と一致する場合だけ`WorkspaceEdit`を適用する。不一致時は全文と現在バージョンを返す。
- Webview起因の更新は`transactionId`で確認し、外部変更だけを全文再同期する。
- 無編集の文書は書き換えない。編集範囲外の改行、空白、参照リンク、リスト記号を再整形しない。

## 3. エディター

CodeMirror 6の同一文書上でライブ表示とソース表示を切り替える。ライブ表示は非アクティブ行の構文記号を隠し、見出し、引用、強調、リンク、画像、タスクリスト、コードブロック、数式、Mermaidおよび表を編集面内で視覚化する。キャレットがあるブロックでは原文へ戻せる。

ライブ表示の通常段落ではEnterを段落区切り、Shift+EnterをMarkdownハードブレークとして扱う。リスト、引用、見出し、コードフェンスおよびソース表示ではCodeMirrorのMarkdown操作を優先する。HTMLクリップボードは見出し、段落、書式、リンク、画像、リスト、引用および表をMarkdownへ変換して貼り付ける。

ライブ表ではセルの直接編集、IME確定後の逐次同期、Tab移動、セル内書式ショートカット、行列の追加・削除、ドラッグによる行列並べ替え、列幅変更および列整列を行える。設定したセル数を超える表はDOMを大量生成せずソース編集へ切り替える。画像は複数ファイル選択、クリップボード貼り付け、ドラッグ＆ドロップ、移動・名前変更、コピー、ごみ箱への削除に対応する。コードブロックは内容の直接編集、IME、言語変更、コピーに対応する。

Focus Modeは現在行以外を減光する。Typewriter Modeは選択変更時にキャレットを表示領域中央へスクロールする。両モードはビューごとに保持し、同一文書の内容だけを分割ビュー間で共有する。

レンダリングプレビューはMarkdown、表、タスクリスト、脚注、下付き、上付き、ハイライト、KaTeX、Mermaidを表示する。生成HTMLはDOMPurifyでサニタイズする。生HTMLは`allowUnsafeHtml`が有効な場合だけMarkdownパーサーへ渡し、その後もサニタイズする。
KaTeXとMermaidは対応要素が初めて表示された時だけ読み込む。分割プレビューは既定で無効とし、有効時も入力停止後にだけ全文を更新する。

## 4. VS Code統合

View typeは`markda.editor`である。アウトラインは見出し階層、現在セクション、フィルターを表示し、選択時に当該位置へ移動する。Filesビューはワークスペース内の対応ファイルをフォルダー階層で列挙し、最近開いた文書と現在文書を表示する。ファイル絞り込み、Quick Open、ワークスペース検索への導線を持つ。

語数表示は選択範囲を追従し、単語、文字、空白を除く文字、行、読了時間をポップアップ表示する。Previewは編集面とスクロール同期し、見出し選択で編集位置へ戻る。モードボタンは`aria-pressed`、アイコンボタンはアクセシブル名、操作要素はキーボードフォーカス表示を持つ。

公開コマンド:

- `markda.open`
- `markda.newFile`
- `markda.duplicate`
- `markda.toggleSourceMode`
- `markda.toggleFocusMode`
- `markda.toggleTypewriterMode`
- `markda.showOutline`
- `markda.showFiles`
- `markda.showSearch`
- `markda.copyAsMarkdown`
- `markda.pastePlainText`
- `markda.insertTable`
- `markda.insertImage`
- `markda.insertMathBlock`
- `markda.toggleBold`
- `markda.toggleItalic`
- `markda.toggleInlineCode`
- `markda.insertLink`
- `markda.toggleBulletList`
- `markda.toggleOrderedList`
- `markda.toggleTaskList`
- `markda.toggleBlockquote`
- `markda.toggleStrikethrough`
- `markda.insertCodeBlock`
- `markda.clearFormatting`
- `markda.showStatistics`
- `markda.exportHtml`
- `markda.exportHtmlBare`
- `markda.exportWithPrevious`
- `markda.openThemeFolder`

公開設定:

| キー | 型 | 既定値 |
|---|---|---|
| `markda.editor.autoPairMarkdown` | boolean | `true` |
| `markda.editor.contentWidth` | integer | `860` |
| `markda.editor.typewriterKeepCentered` | boolean | `true` |
| `markda.editor.previewUpdateDelay` | integer | `500` |
| `markda.editor.liveTableMaxCells` | integer | `600` |
| `markda.markdown.math` | boolean | `true` |
| `markda.markdown.diagrams` | boolean | `true` |
| `markda.markdown.html` | boolean | `true` |
| `markda.markdown.breaks` | boolean | `false` |
| `markda.image.folder` | string | `${currentFileNameWithoutExt}.assets` |
| `markda.image.useRelativePath` | boolean | `true` |
| `markda.image.ensureDotSlash` | boolean | `false` |
| `markda.theme.light` | string | `paper` |
| `markda.theme.dark` | string | `midnight` |
| `markda.export.defaultFolder` | `same \| ask` | `ask` |
| `markda.export.allowFrontMatterOverrides` | boolean | `false` |
| `markda.security.allowRemoteResources` | `never \| prompt \| always` | `prompt` |
| `markda.security.allowUnsafeHtml` | boolean | `false` |

## 5. セキュリティ

Webview CSPの`default-src`は`none`とする。スクリプトはリクエストごとのnonceを持つ拡張同梱バンドルだけを許可する。リンクはWebview内で直接遷移せず拡張ホストへ通知する。HTTP(S)は`never`、`prompt`、`always`のポリシーを適用する。HTMLエクスポートでは生HTMLを既定で無効にし、文書タイトルをエスケープする。

## 6. 変換

0.1ではスタイル付きHTML、スタイルなしHTML、文書単位の直前出力先への再出力を実装する。PDF、画像、Pandoc形式、インポート、OS別ツール同梱は、バイナリの再配布ライセンス、署名、SHA-256、Marketplace容量を確定した後に有効化する。存在しないツールを外部PATHから暗黙実行しない。

## 7. 受入基準と実装状況

| 領域 | 状態 | 受入条件 |
|---|---|---|
| TextDocument同期 | 実装済み | 版検証、外部更新、分割表示、最小置換 |
| ライブ編集 | 基盤実装済み | 原文保持、主要インライン構文、見出し、引用 |
| 数式・図表 | プレビュー実装済み | KaTeXおよびMermaid strict mode |
| アウトライン・ファイル | 実装済み | 階層、現在位置、絞り込み、Recent、Quick Open、横断検索 |
| HTML変換 | 実装済み | styled/bare、再出力、タイトルのエスケープ |
| 画像選択・コピー | 基盤実装済み | ワークスペース内の指定フォルダー、安全な重複回避、相対URL挿入 |
| 表GUI | 実装済み | 直接セル編集、行列操作、並べ替え、列幅・整列、Tab移動、非破壊なソース差分 |
| Pandoc/PDF/画像 | 未実装 | OS/CPU別署名済みツールと全形式テスト |
| Typoraユーザビリティ比較 | 実施済み | 一画面ライブ編集、表・画像・検索・アウトライン・統計・アクセシビリティの差分反映 |

1.0は本仕様の未実装項目がなく、三OS・二CPUアーキテクチャの試験、アクセシビリティ試験、性能試験、セキュリティ試験をすべて満たした時点で成立する。
