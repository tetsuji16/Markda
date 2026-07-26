import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const common = {
  ja: ['見出しを絞り込み','見出しテキスト','Markdownファイルを絞り込み','ファイル名またはフォルダー名','作成','複製','{0}語 · {1}文字 · {2}行 · 読了{3}分','markda: アクティブなmarkda文書がありません。','エクスポート','markda: {0} をエクスポートしました','markda: この文書には前回のエクスポートがありません。','現在','最近使用したファイル','見出しへ移動','markda Markdownエディター','{0}語','{0}語 · {1}文字'],
  'zh-cn': ['筛选标题','标题文本','筛选 Markdown 文件','文件或文件夹名称','创建','复制','{0} 个词 · {1} 个字符 · {2} 行 · 阅读 {3} 分钟','markda: 没有活动的 markda 文档。','导出','markda: 已导出 {0}','markda: 此文档没有上次导出。','当前','最近','转到标题','markda Markdown 编辑器','{0} 个词','{0} 个词 · {1} 个字符'],
  'zh-tw': ['篩選標題','標題文字','篩選 Markdown 檔案','檔案或資料夾名稱','建立','複製','{0} 個詞 · {1} 個字元 · {2} 列 · 閱讀 {3} 分鐘','markda: 沒有作用中的 markda 文件。','匯出','markda: 已匯出 {0}','markda: 此文件沒有上次匯出。','目前','最近','移至標題','markda Markdown 編輯器','{0} 個詞','{0} 個詞 · {1} 個字元'],
  ko: ['제목 필터','제목 텍스트','Markdown 파일 필터','파일 또는 폴더 이름','만들기','복제','단어 {0}개 · 문자 {1}개 · {2}줄 · 읽기 {3}분','markda: 활성 markda 문서가 없습니다.','내보내기','markda: {0} 내보냄','markda: 이 문서에는 이전 내보내기가 없습니다.','현재','최근','제목으로 이동','markda Markdown 편집기','단어 {0}개','단어 {0}개 · 문자 {1}개'],
  es: ['Filtrar encabezados','Texto del encabezado','Filtrar archivos Markdown','Nombre de archivo o carpeta','Crear','Duplicar','{0} palabras · {1} caracteres · {2} líneas · {3} min de lectura','markda: No hay ningún documento markda activo.','Exportar','markda: Se exportó {0}','markda: Este documento no tiene una exportación anterior.','actual','Recientes','Ir al encabezado','Editor Markdown de markda','{0} palabras','{0} palabras · {1} caracteres'],
  fr: ['Filtrer les titres','Texte du titre','Filtrer les fichiers Markdown','Nom du fichier ou dossier','Créer','Dupliquer','{0} mots · {1} caractères · {2} lignes · {3} min de lecture','markda : Aucun document markda actif.','Exporter','markda : {0} exporté','markda : Ce document n’a aucune exportation précédente.','actuel','Récents','Accéder au titre','Éditeur Markdown markda','{0} mots','{0} mots · {1} caractères'],
  de: ['Überschriften filtern','Überschriftentext','Markdown-Dateien filtern','Datei- oder Ordnername','Erstellen','Duplizieren','{0} Wörter · {1} Zeichen · {2} Zeilen · {3} Min. Lesezeit','markda: Kein aktives markda-Dokument.','Exportieren','markda: {0} exportiert','markda: Dieses Dokument hat keinen vorherigen Export.','aktuell','Zuletzt verwendet','Zur Überschrift','markda Markdown-Editor','{0} Wörter','{0} Wörter · {1} Zeichen'],
  'pt-br': ['Filtrar títulos','Texto do título','Filtrar arquivos Markdown','Nome do arquivo ou pasta','Criar','Duplicar','{0} palavras · {1} caracteres · {2} linhas · {3} min de leitura','markda: Nenhum documento markda ativo.','Exportar','markda: {0} exportado','markda: Este documento não tem exportação anterior.','atual','Recentes','Ir para o título','Editor Markdown do markda','{0} palavras','{0} palavras · {1} caracteres'],
  ru: ['Фильтр заголовков','Текст заголовка','Фильтр файлов Markdown','Имя файла или папки','Создать','Дублировать','{0} слов · {1} символов · {2} строк · {3} мин чтения','markda: Нет активного документа markda.','Экспорт','markda: Экспортирован {0}','markda: У этого документа нет предыдущего экспорта.','текущий','Недавние','Перейти к заголовку','Редактор Markdown markda','{0} слов','{0} слов · {1} символов'],
  ar: ['تصفية العناوين','نص العنوان','تصفية ملفات Markdown','اسم الملف أو المجلد','إنشاء','تكرار','{0} كلمة · {1} حرفًا · {2} سطرًا · {3} دقيقة قراءة','markda: لا يوجد مستند markda نشط.','تصدير','markda: تم تصدير {0}','markda: لا يحتوي هذا المستند على تصدير سابق.','الحالي','الأخيرة','الانتقال إلى العنوان','محرر Markdown من markda','{0} كلمة','{0} كلمة · {1} حرفًا'],
};
const keys = ['Filter headings','Heading text','Filter Markdown files','File or folder name','Create','Duplicate','{0} words · {1} characters · {2} lines · {3} min read','markda: No active markda document.','Export','markda: Exported {0}','markda: This document has no previous export.','current','Recent','Go to heading','markda Markdown editor','{0} words','{0} words · {1} characters'];
const extras = {
  ja: {
    'VS Code Text Editor': 'VS Codeテキストエディター',
    'Open this file once with the default text editor': '今回だけ既定のテキストエディターで開きます',
    'Choose Another Editor...': '別のエディターを選択...',
    'Select from all editors available for this file': 'このファイルで利用可能なすべてのエディターから選択します',
    'Configure File Associations...': 'ファイルの関連付けを構成...',
    'Choose which file types open with markda by default': 'markdaで既定で開くファイル形式を選択します',
    'Reopen with another editor': '別のエディターで開き直す',
    'Select file types to open with markda by default': 'markdaで既定で開くファイル形式を選択してください',
    'markda File Associations': 'markda ファイルの関連付け',
    'User': 'ユーザー',
    'Use these associations in every workspace': 'すべてのワークスペースでこの関連付けを使用します',
    'Workspace': 'ワークスペース',
    'Use these associations only in this workspace': 'このワークスペースだけでこの関連付けを使用します',
    'Where should these file associations be saved?': 'ファイルの関連付けをどこに保存しますか?',
    'Open Settings': '設定を開く',
    'markda file associations were saved in VS Code settings.': 'markdaのファイル関連付けをVS Codeの設定に保存しました。',
  },
};
const folder = join(root, 'l10n');
await mkdir(folder, { recursive: true });
for (const [locale, values] of Object.entries(common)) {
  await writeFile(join(folder, `bundle.l10n.${locale}.json`), `${JSON.stringify({ ...Object.fromEntries(keys.map((key, index) => [key, values[index]])), ...(extras[locale] ?? {}) }, null, 2)}\n`, 'utf8');
}
