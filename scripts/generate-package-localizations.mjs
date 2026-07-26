import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const messages = {
  'extension.description': 'A source-preserving live Markdown editor for VS Code: edit formatted Markdown in place while keeping ordinary, portable Markdown files.',
  'view.outline': 'Outline', 'view.files': 'Files',
  'command.open': 'Open with markda', 'command.new': 'New Markdown File', 'command.duplicate': 'Duplicate Document',
  'command.reopenWith': 'Reopen with Another Editor', 'command.configureAssociations': 'Configure File Associations',
  'command.source': 'Toggle Source Code Mode', 'command.focus': 'Toggle Focus Mode', 'command.typewriter': 'Toggle Typewriter Mode',
  'command.outline': 'Show Outline', 'command.files': 'Show Files', 'command.find': 'Find in Document',
  'command.copy': 'Copy as Markdown', 'command.paste': 'Paste as Plain Text', 'command.table': 'Insert Table',
  'command.image': 'Insert Image', 'command.math': 'Insert Math Block', 'command.statistics': 'Show Document Statistics',
  'command.export': 'Export: HTML', 'command.exportBare': 'Export: HTML without styles',
  'command.exportPdf': 'Export: PDF', 'command.exportExternal': 'Export: External Target',
  'command.exportPrevious': 'Export with Previous Settings', 'command.themeFolder': 'Open Theme Folder',
  'config.autoPair': 'Automatically pair Markdown delimiters.',
  'config.contentWidth': 'Maximum editor content width in pixels. 0 fills the window.',
  'config.themeMode': 'Editor theme: auto (follow VS Code), light, or dark.',
  'config.themeAuto': 'Follow the VS Code color theme automatically.',
  'config.themeLight': 'Always use the light editor theme.', 'config.themeDark': 'Always use the dark editor theme.',
  'config.previewDelay': 'Idle delay before refreshing the optional split preview, in milliseconds.',
  'config.tableCells': 'Maximum number of table cells rendered as editable controls before falling back to source editing.',
};

const translations = {
  ja: {
    'extension.description':'通常の可搬性のあるMarkdownファイルを維持しながら、書式付きMarkdownをその場で編集できるVS Code用ライブエディター。',
    'command.reopenWith':'別のエディターで開き直す','command.configureAssociations':'ファイルの関連付けを構成',
    'view.outline':'アウトライン','view.files':'ファイル','command.open':'markdaで開く','command.new':'新しいMarkdownファイル','command.duplicate':'文書を複製',
    'command.source':'ソースコードモードを切り替え','command.focus':'フォーカスモードを切り替え','command.typewriter':'タイプライターモードを切り替え',
    'command.outline':'アウトラインを表示','command.files':'ファイルを表示','command.find':'文書内を検索','command.copy':'Markdownとしてコピー',
    'command.paste':'プレーンテキストとして貼り付け','command.table':'表を挿入','command.image':'画像を挿入','command.math':'数式ブロックを挿入',
    'command.statistics':'文書の統計を表示','command.export':'エクスポート: HTML','command.exportBare':'エクスポート: スタイルなしHTML',
    'command.exportPdf':'エクスポート: PDF','command.exportExternal':'エクスポート: 外部ターゲット',
    'command.exportPrevious':'前回の設定でエクスポート','command.themeFolder':'テーマフォルダーを開く',
    'config.autoPair':'Markdown区切り文字を自動的にペアにします。','config.contentWidth':'エディター本文の最大幅（ピクセル）。0でウィンドウ全体に広げます。',
    'config.themeMode':'エディターのテーマ: 自動（VS Codeに追従）、ライト、ダーク。','config.themeAuto':'VS Codeの配色テーマに自動的に追従します。',
    'config.themeLight':'常にライトテーマを使用します。','config.themeDark':'常にダークテーマを使用します。',
    'config.previewDelay':'分割プレビューを更新するまでの待機時間（ミリ秒）。','config.tableCells':'編集コントロールとして表示する表セル数の上限。超えるとソース編集に切り替えます。',
  },
  'zh-cn': {'view.outline':'大纲','view.files':'文件','command.open':'使用 markda 打开','command.new':'新建 Markdown 文件','command.duplicate':'复制文档','command.source':'切换源代码模式','command.focus':'切换专注模式','command.typewriter':'切换打字机模式','command.outline':'显示大纲','command.files':'显示文件','command.find':'在文档中查找','command.copy':'复制为 Markdown','command.paste':'粘贴为纯文本','command.table':'插入表格','command.image':'插入图片','command.math':'插入数学块','command.statistics':'显示文档统计信息','command.export':'导出: HTML','command.exportBare':'导出: 无样式 HTML','command.exportPrevious':'使用上次设置导出','command.themeFolder':'打开主题文件夹'},
  'zh-tw': {'view.outline':'大綱','view.files':'檔案','command.open':'使用 markda 開啟','command.new':'新增 Markdown 檔案','command.duplicate':'複製文件','command.source':'切換原始碼模式','command.focus':'切換專注模式','command.typewriter':'切換打字機模式','command.outline':'顯示大綱','command.files':'顯示檔案','command.find':'在文件中尋找','command.copy':'複製為 Markdown','command.paste':'貼上為純文字','command.table':'插入表格','command.image':'插入圖片','command.math':'插入數學區塊','command.statistics':'顯示文件統計','command.export':'匯出: HTML','command.exportBare':'匯出: 無樣式 HTML','command.exportPrevious':'使用上次設定匯出','command.themeFolder':'開啟佈景主題資料夾'},
  ko: {'view.outline':'개요','view.files':'파일','command.open':'markda로 열기','command.new':'새 Markdown 파일','command.duplicate':'문서 복제','command.source':'소스 코드 모드 전환','command.focus':'집중 모드 전환','command.typewriter':'타자기 모드 전환','command.outline':'개요 표시','command.files':'파일 표시','command.find':'문서에서 찾기','command.copy':'Markdown으로 복사','command.paste':'일반 텍스트로 붙여넣기','command.table':'표 삽입','command.image':'이미지 삽입','command.math':'수식 블록 삽입','command.statistics':'문서 통계 표시','command.export':'내보내기: HTML','command.exportBare':'내보내기: 스타일 없는 HTML','command.exportPrevious':'이전 설정으로 내보내기','command.themeFolder':'테마 폴더 열기'},
  es: {'view.outline':'Esquema','view.files':'Archivos','command.open':'Abrir con markda','command.new':'Nuevo archivo Markdown','command.duplicate':'Duplicar documento','command.source':'Alternar modo de código fuente','command.focus':'Alternar modo de concentración','command.typewriter':'Alternar modo máquina de escribir','command.outline':'Mostrar esquema','command.files':'Mostrar archivos','command.find':'Buscar en el documento','command.copy':'Copiar como Markdown','command.paste':'Pegar como texto sin formato','command.table':'Insertar tabla','command.image':'Insertar imagen','command.math':'Insertar bloque matemático','command.statistics':'Mostrar estadísticas del documento','command.export':'Exportar: HTML','command.exportBare':'Exportar: HTML sin estilos','command.exportPrevious':'Exportar con la configuración anterior','command.themeFolder':'Abrir carpeta de temas'},
  fr: {'view.outline':'Plan','view.files':'Fichiers','command.open':'Ouvrir avec markda','command.new':'Nouveau fichier Markdown','command.duplicate':'Dupliquer le document','command.source':'Activer/désactiver le mode source','command.focus':'Activer/désactiver le mode concentration','command.typewriter':'Activer/désactiver le mode machine à écrire','command.outline':'Afficher le plan','command.files':'Afficher les fichiers','command.find':'Rechercher dans le document','command.copy':'Copier en Markdown','command.paste':'Coller en texte brut','command.table':'Insérer un tableau','command.image':'Insérer une image','command.math':'Insérer un bloc mathématique','command.statistics':'Afficher les statistiques du document','command.export':'Exporter : HTML','command.exportBare':'Exporter : HTML sans styles','command.exportPrevious':'Exporter avec les paramètres précédents','command.themeFolder':'Ouvrir le dossier des thèmes'},
  de: {'view.outline':'Gliederung','view.files':'Dateien','command.open':'Mit markda öffnen','command.new':'Neue Markdown-Datei','command.duplicate':'Dokument duplizieren','command.source':'Quelltextmodus umschalten','command.focus':'Fokusmodus umschalten','command.typewriter':'Schreibmaschinenmodus umschalten','command.outline':'Gliederung anzeigen','command.files':'Dateien anzeigen','command.find':'Im Dokument suchen','command.copy':'Als Markdown kopieren','command.paste':'Als Nur-Text einfügen','command.table':'Tabelle einfügen','command.image':'Bild einfügen','command.math':'Mathematikblock einfügen','command.statistics':'Dokumentstatistik anzeigen','command.export':'Exportieren: HTML','command.exportBare':'Exportieren: HTML ohne Stile','command.exportPrevious':'Mit vorherigen Einstellungen exportieren','command.themeFolder':'Designordner öffnen'},
  'pt-br': {'view.outline':'Estrutura de tópicos','view.files':'Arquivos','command.open':'Abrir com markda','command.new':'Novo arquivo Markdown','command.duplicate':'Duplicar documento','command.source':'Alternar modo de código-fonte','command.focus':'Alternar modo de foco','command.typewriter':'Alternar modo máquina de escrever','command.outline':'Mostrar estrutura de tópicos','command.files':'Mostrar arquivos','command.find':'Localizar no documento','command.copy':'Copiar como Markdown','command.paste':'Colar como texto sem formatação','command.table':'Inserir tabela','command.image':'Inserir imagem','command.math':'Inserir bloco matemático','command.statistics':'Mostrar estatísticas do documento','command.export':'Exportar: HTML','command.exportBare':'Exportar: HTML sem estilos','command.exportPrevious':'Exportar com configurações anteriores','command.themeFolder':'Abrir pasta de temas'},
  ru: {'view.outline':'Структура','view.files':'Файлы','command.open':'Открыть с помощью markda','command.new':'Новый файл Markdown','command.duplicate':'Дублировать документ','command.source':'Переключить режим исходного кода','command.focus':'Переключить режим фокусировки','command.typewriter':'Переключить режим пишущей машинки','command.outline':'Показать структуру','command.files':'Показать файлы','command.find':'Найти в документе','command.copy':'Копировать как Markdown','command.paste':'Вставить как обычный текст','command.table':'Вставить таблицу','command.image':'Вставить изображение','command.math':'Вставить математический блок','command.statistics':'Показать статистику документа','command.export':'Экспорт: HTML','command.exportBare':'Экспорт: HTML без стилей','command.exportPrevious':'Экспортировать с предыдущими настройками','command.themeFolder':'Открыть папку тем'},
  ar: {'view.outline':'المخطط التفصيلي','view.files':'الملفات','command.open':'فتح باستخدام markda','command.new':'ملف Markdown جديد','command.duplicate':'تكرار المستند','command.source':'تبديل وضع الشفرة المصدرية','command.focus':'تبديل وضع التركيز','command.typewriter':'تبديل وضع الآلة الكاتبة','command.outline':'إظهار المخطط','command.files':'إظهار الملفات','command.find':'بحث في المستند','command.copy':'نسخ بتنسيق Markdown','command.paste':'لصق كنص عادي','command.table':'إدراج جدول','command.image':'إدراج صورة','command.math':'إدراج كتلة رياضية','command.statistics':'إظهار إحصائيات المستند','command.export':'تصدير: HTML','command.exportBare':'تصدير: HTML بدون أنماط','command.exportPrevious':'تصدير بالإعدادات السابقة','command.themeFolder':'فتح مجلد النُسق'},
};

const secondaryMessages = {
  'command.bold':'Format: Bold','command.italic':'Format: Italic','command.inlineCode':'Format: Inline Code','command.link':'Format: Link',
  'command.bullets':'Format: Bulleted List','command.numbered':'Format: Numbered List','command.tasks':'Format: Task List',
  'command.quote':'Format: Block Quote','command.strike':'Format: Strikethrough','command.codeBlock':'Format: Code Block','command.clearFormat':'Format: Clear Formatting',
  'command.filterOutline':'Filter Outline','command.clearOutline':'Clear Outline Filter','command.filterFiles':'Filter Files','command.clearFiles':'Clear File Filter',
  'command.searchWorkspace':'Search across Markdown Files','command.quickOpen':'Quick Open Markdown File',
};
const secondaryKeys = Object.keys(secondaryMessages);
const secondaryTranslations = {
  ja:['書式: 太字','書式: 斜体','書式: インラインコード','書式: リンク','書式: 箇条書き','書式: 番号付きリスト','書式: タスクリスト','書式: 引用','書式: 取り消し線','書式: コードブロック','書式: 書式をクリア','アウトラインを絞り込み','アウトラインの絞り込みを解除','ファイルを絞り込み','ファイルの絞り込みを解除','Markdownファイル全体を検索','Markdownファイルをクイックオープン'],
  'zh-cn':['格式: 粗体','格式: 斜体','格式: 行内代码','格式: 链接','格式: 项目符号列表','格式: 编号列表','格式: 任务列表','格式: 块引用','格式: 删除线','格式: 代码块','格式: 清除格式','筛选大纲','清除大纲筛选','筛选文件','清除文件筛选','搜索 Markdown 文件','快速打开 Markdown 文件'],
  'zh-tw':['格式: 粗體','格式: 斜體','格式: 行內程式碼','格式: 連結','格式: 項目符號清單','格式: 編號清單','格式: 工作清單','格式: 區塊引文','格式: 刪除線','格式: 程式碼區塊','格式: 清除格式','篩選大綱','清除大綱篩選','篩選檔案','清除檔案篩選','搜尋 Markdown 檔案','快速開啟 Markdown 檔案'],
  ko:['서식: 굵게','서식: 기울임꼴','서식: 인라인 코드','서식: 링크','서식: 글머리 기호 목록','서식: 번호 매기기 목록','서식: 작업 목록','서식: 블록 인용','서식: 취소선','서식: 코드 블록','서식: 서식 지우기','개요 필터','개요 필터 지우기','파일 필터','파일 필터 지우기','Markdown 파일 검색','Markdown 파일 빠르게 열기'],
  es:['Formato: Negrita','Formato: Cursiva','Formato: Código en línea','Formato: Vínculo','Formato: Lista con viñetas','Formato: Lista numerada','Formato: Lista de tareas','Formato: Cita en bloque','Formato: Tachado','Formato: Bloque de código','Formato: Borrar formato','Filtrar esquema','Borrar filtro del esquema','Filtrar archivos','Borrar filtro de archivos','Buscar en archivos Markdown','Apertura rápida de archivo Markdown'],
  fr:['Format : Gras','Format : Italique','Format : Code en ligne','Format : Lien','Format : Liste à puces','Format : Liste numérotée','Format : Liste de tâches','Format : Citation','Format : Barré','Format : Bloc de code','Format : Effacer la mise en forme','Filtrer le plan','Effacer le filtre du plan','Filtrer les fichiers','Effacer le filtre des fichiers','Rechercher dans les fichiers Markdown','Ouverture rapide d’un fichier Markdown'],
  de:['Format: Fett','Format: Kursiv','Format: Inlinecode','Format: Link','Format: Aufzählung','Format: Nummerierte Liste','Format: Aufgabenliste','Format: Blockzitat','Format: Durchgestrichen','Format: Codeblock','Format: Formatierung löschen','Gliederung filtern','Gliederungsfilter löschen','Dateien filtern','Dateifilter löschen','Markdown-Dateien durchsuchen','Markdown-Datei schnell öffnen'],
  'pt-br':['Formato: Negrito','Formato: Itálico','Formato: Código embutido','Formato: Link','Formato: Lista com marcadores','Formato: Lista numerada','Formato: Lista de tarefas','Formato: Citação em bloco','Formato: Tachado','Formato: Bloco de código','Formato: Limpar formatação','Filtrar estrutura de tópicos','Limpar filtro da estrutura','Filtrar arquivos','Limpar filtro de arquivos','Pesquisar em arquivos Markdown','Abertura rápida de arquivo Markdown'],
  ru:['Формат: Полужирный','Формат: Курсив','Формат: Встроенный код','Формат: Ссылка','Формат: Маркированный список','Формат: Нумерованный список','Формат: Список задач','Формат: Блочная цитата','Формат: Зачёркнутый','Формат: Блок кода','Формат: Очистить форматирование','Фильтр структуры','Очистить фильтр структуры','Фильтр файлов','Очистить фильтр файлов','Поиск в файлах Markdown','Быстро открыть файл Markdown'],
  ar:['تنسيق: غامق','تنسيق: مائل','تنسيق: شفرة مضمنة','تنسيق: رابط','تنسيق: قائمة نقطية','تنسيق: قائمة مرقمة','تنسيق: قائمة مهام','تنسيق: اقتباس كتلي','تنسيق: يتوسطه خط','تنسيق: كتلة شفرة','تنسيق: مسح التنسيق','تصفية المخطط','مسح تصفية المخطط','تصفية الملفات','مسح تصفية الملفات','البحث في ملفات Markdown','فتح سريع لملف Markdown'],
};
Object.assign(messages, secondaryMessages);
for (const [locale, values] of Object.entries(secondaryTranslations)) {
  Object.assign(translations[locale], Object.fromEntries(secondaryKeys.map((key, index) => [key, values[index]])));
}
const configurationKeys = ['config.autoPair','config.contentWidth','config.themeMode','config.themeAuto','config.themeLight','config.themeDark','config.previewDelay','config.tableCells'];
const configurationTranslations = {
  'zh-cn':['自动配对 Markdown 分隔符。','编辑器内容最大宽度（像素）。0 表示填满窗口。','编辑器主题：自动（跟随 VS Code）、浅色或深色。','自动跟随 VS Code 颜色主题。','始终使用浅色编辑器主题。','始终使用深色编辑器主题。','刷新可选拆分预览前的空闲延迟（毫秒）。','以可编辑控件呈现的最大表格单元格数；超出后改用源码编辑。'],
  'zh-tw':['自動配對 Markdown 分隔符號。','編輯器內容最大寬度（像素）。0 表示填滿視窗。','編輯器佈景主題：自動（跟隨 VS Code）、淺色或深色。','自動跟隨 VS Code 色彩佈景主題。','一律使用淺色編輯器佈景主題。','一律使用深色編輯器佈景主題。','重新整理選用分割預覽前的閒置延遲（毫秒）。','以可編輯控制項呈現的最大表格儲存格數；超出後改用原始碼編輯。'],
  ko:['Markdown 구분 기호를 자동으로 짝지웁니다.','편집기 콘텐츠 최대 너비(픽셀)입니다. 0이면 창을 채웁니다.','편집기 테마: 자동(VS Code 따름), 밝게 또는 어둡게.','VS Code 색 테마를 자동으로 따릅니다.','항상 밝은 편집기 테마를 사용합니다.','항상 어두운 편집기 테마를 사용합니다.','선택적 분할 미리 보기를 새로 고치기 전 유휴 지연 시간(밀리초)입니다.','소스 편집으로 전환하기 전 편집 컨트롤로 렌더링할 최대 표 셀 수입니다.'],
  es:['Emparejar automáticamente los delimitadores Markdown.','Ancho máximo del contenido del editor en píxeles. 0 llena la ventana.','Tema del editor: automático (seguir VS Code), claro u oscuro.','Seguir automáticamente el tema de color de VS Code.','Usar siempre el tema claro del editor.','Usar siempre el tema oscuro del editor.','Espera antes de actualizar la vista previa dividida opcional, en milisegundos.','Máximo de celdas de tabla como controles editables antes de usar edición de código fuente.'],
  fr:['Associer automatiquement les délimiteurs Markdown.','Largeur maximale du contenu de l’éditeur en pixels. 0 remplit la fenêtre.','Thème de l’éditeur : auto (suivre VS Code), clair ou sombre.','Suivre automatiquement le thème de couleurs VS Code.','Toujours utiliser le thème clair.','Toujours utiliser le thème sombre.','Délai avant l’actualisation de l’aperçu fractionné facultatif, en millisecondes.','Nombre maximal de cellules rendues modifiables avant de passer à l’édition source.'],
  de:['Markdown-Trennzeichen automatisch paaren.','Maximale Breite des Editorinhalts in Pixeln. 0 füllt das Fenster.','Editordesign: automatisch (VS Code folgen), hell oder dunkel.','Dem VS Code-Farbdesign automatisch folgen.','Immer das helle Editordesign verwenden.','Immer das dunkle Editordesign verwenden.','Leerlaufzeit vor dem Aktualisieren der optionalen geteilten Vorschau in Millisekunden.','Maximale Anzahl editierbarer Tabellenzellen, bevor zur Quelltextbearbeitung gewechselt wird.'],
  'pt-br':['Emparelhar delimitadores Markdown automaticamente.','Largura máxima do conteúdo do editor em pixels. 0 preenche a janela.','Tema do editor: automático (seguir o VS Code), claro ou escuro.','Seguir automaticamente o tema de cores do VS Code.','Sempre usar o tema claro do editor.','Sempre usar o tema escuro do editor.','Atraso antes de atualizar a visualização dividida opcional, em milissegundos.','Máximo de células renderizadas como controles editáveis antes de usar edição de código-fonte.'],
  ru:['Автоматически создавать пары разделителей Markdown.','Максимальная ширина содержимого редактора в пикселях. 0 заполняет окно.','Тема редактора: авто (следовать VS Code), светлая или тёмная.','Автоматически следовать цветовой теме VS Code.','Всегда использовать светлую тему редактора.','Всегда использовать тёмную тему редактора.','Задержка перед обновлением дополнительного разделённого предпросмотра в миллисекундах.','Максимальное число редактируемых ячеек таблицы перед переходом к исходному коду.'],
  ar:['إقران محددات Markdown تلقائيًا.','أقصى عرض لمحتوى المحرر بالبكسل. القيمة 0 تملأ النافذة.','نسق المحرر: تلقائي (يتبع VS Code) أو فاتح أو داكن.','اتباع نسق ألوان VS Code تلقائيًا.','استخدام نسق المحرر الفاتح دائمًا.','استخدام نسق المحرر الداكن دائمًا.','مهلة الخمول قبل تحديث المعاينة المنقسمة الاختيارية بالمللي ثانية.','الحد الأقصى لخلايا الجدول القابلة للتحرير قبل الرجوع إلى تحرير المصدر.'],
};
for (const [locale, values] of Object.entries(configurationTranslations)) {
  Object.assign(translations[locale], Object.fromEntries(configurationKeys.map((key, index) => [key, values[index]])));
}

const packagePath = join(root, 'package.json');
const manifest = JSON.parse(await readFile(packagePath, 'utf8'));
const byEnglish = new Map(Object.entries(messages).map(([key, value]) => [value, `%${key}%`]));
function replace(value) {
  if (typeof value === 'string') return byEnglish.get(value) ?? value;
  if (Array.isArray(value)) return value.map(replace);
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) value[key] = replace(child);
  }
  return value;
}
replace(manifest);
await writeFile(packagePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
await writeFile(join(root, 'package.nls.json'), `${JSON.stringify(messages, null, 2)}\n`, 'utf8');
for (const [locale, translated] of Object.entries(translations)) {
  await writeFile(join(root, `package.nls.${locale}.json`), `${JSON.stringify({ ...messages, ...translated }, null, 2)}\n`, 'utf8');
}
