# Markda

[English](../README.md) · [日本語](README.ja.md) · [简体中文](README.zh-cn.md) · **Español** · [Deutsch](README.de.md)

**Edita el documento que ves. Conserva el Markdown que es tuyo.**

Markda es un editor de Markdown para VS Code Desktop que conserva el código fuente. Está pensado para escritores, desarrolladores, investigadores y quienes toman notas y quieren editar documentos con formato sin renunciar a archivos Markdown legibles. Edita directamente encabezados, tareas, tablas, código, fórmulas, diagramas e imágenes; el archivo del disco sigue siendo Markdown limpio y portátil.

[Sitio oficial](https://o-server.main.jp/markda/) · [Instalar desde Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=tetsuji16.markda) · [Ver el código en GitHub](https://github.com/tetsuji16/Markda) · [Informar de un error](https://github.com/tetsuji16/Markda/issues)

Markda 0.1 es una versión preliminar.

> **Mira Markda en acción:** [Ver la introducción de 16 segundos](../media/videos/markda-intro.mp4) · [Ver el recorrido por la interfaz](../media/videos/markda-gui-demo.mp4)

## Primeros pasos

1. Instala Markda desde [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=tetsuji16.markda).
2. Abre un archivo Markdown. Si se abre en el editor de texto estándar de VS Code, selecciona **Open with markda** en el título del editor, ejecuta **Markda: Open with Markda** o elige **Reopen Editor With… → Markda** en el menú de la pestaña.
3. Edita el documento renderizado. Usa el botón `</>` o **Markda: Toggle Source Code Mode** cuando quieras trabajar directamente con el código Markdown.

Markda admite archivos `.md`, `.markdown`, `.mdown`, `.mkd`, `.mkdn`, `.mdwn` y `.txt`. Para volver al editor integrado de VS Code, usa **Reopen with Another Editor** en el título del editor Markda.

![Markda — edita el documento renderizado y conserva un código fuente Markdown limpio y portátil](../media/marketing/marketplace-hero.png)

## Diseñado para conservar el código fuente

![Muestra del editor en vivo de Markda: modo de código fuente, modos de concentración y máquina de escribir, tablas, tareas, fórmulas, código y renderizado local de Markdown](../media/screenshots/live-editing.png)

El documento de texto de VS Code sigue siendo la única fuente de verdad. Markda aplica cambios puntuales y conserva el contenido que no se modifica y la sintaxis Markdown. Cambia a la vista completa del código fuente cuando quieras revisarlo o editarlo directamente.

## Organiza documentos relacionados

- **Plegar secciones:** pasa el cursor junto a un encabezado para usar el marcador de plegado. El menú Outline ofrece Fold All Sections, Expand All Sections y Focus Current Section. Al navegar a un encabezado se expande automáticamente su sección. Plegar no modifica el archivo Markdown.
- **Comprobar enlaces:** después de editar se comprueban los enlaces a archivos locales, imágenes y encabezados Markdown. Ejecuta **Markda: Check Document Links** para ver los resultados en Problems. No se consultan URL remotas. Desactiva las comprobaciones automáticas con `markda.links.checkOnEdit`.
- **Crear desde una plantilla:** ejecuta **Markda: New Document from Template** para crear actas, especificaciones de proyecto o un diario. El documento nuevo se abre sin guardar. Añade objetos `{name, description, body}` a `markda.templates` para crear plantillas propias; `{{title}}` y `{{date}}` se sustituyen al crear el documento.
- **Actualizar enlaces al renombrar:** renombra un archivo o una carpeta desde VS Code o Markda. Revisa los destinos anteriores y nuevos, desmarca los cambios que no quieras y confirma. Pulsa Escape para continuar sin actualizar los enlaces. Se conservan las rutas relativas, los anclajes a encabezados, las cadenas de consulta y los títulos de enlace; se excluyen los bloques de código cercados, con sangría y en línea. Las actualizaciones usan las ediciones del espacio de trabajo de VS Code y se pueden deshacer. Desactívalas con `markda.links.updateOnRename`.
- **Buscar documentos que hacen referencia:** abre la vista **Backlinks** contraída o ejecuta **Markda: Show Backlinks**. Haz clic en un resultado para abrir el documento. Actualiza la vista después de editar enlaces en otro archivo.

Backlinks y la revisión de enlaces al renombrar abarcan hasta 5.000 archivos Markdown/texto del espacio de trabajo abierto, sin incluir carpetas de dependencias y compilación. Usan los documentos abiertos, incluso con cambios sin guardar. Para actualizar enlaces se necesita un espacio de trabajo de confianza. Se actualizan los destinos de enlaces/imágenes Markdown y las definiciones de referencia; no se reescriben los enlaces HTML ni los renombrados hechos fuera de VS Code.

## Funciones destacadas

- Edita directamente la sintaxis compatible de CommonMark y las extensiones de Markda, incluidos enlaces e imágenes de referencia, notas al pie, código con sangría, entidades, códigos abreviados de emoji, YAML Front Matter, `[toc]` y HTML permitido expresamente; o cambia a la vista completa del código fuente.
- Usa saltos de párrafo propios de documentos, pegado inteligente de HTML a Markdown y apertura de enlaces al hacer clic con una tecla modificadora.
- Edita celdas de tablas directamente, controla filas y columnas, reordena mediante arrastre, cambia el tamaño y la alineación, y navega con Tab.
- Edita bloques de código con resaltado de sintaxis sin abrir el modo de código fuente, con deshacer y rehacer unificados.
- Renderiza fórmulas con KaTeX, ecuaciones numeradas y etiquetadas con sus referencias, y diagramas Mermaid sin enviar el contenido del documento a un servicio de renderizado en línea.
- Inserta varias imágenes o guarda imágenes del portapapeles y arrastra y suelta imágenes en una carpeta de recursos configurable.
- Navega con las vistas Outline y Files filtrables, la búsqueda Markdown del espacio de trabajo y Quick Open.
- Usa los modos de concentración y máquina de escribir, temas claros y oscuros, búsqueda y estadísticas del documento.
- Exporta HTML con o sin estilos, crea PDF con un navegador de la familia Chromium instalado o usa destinos de exportación externos de confianza, como Pandoc.
- Sigue enlaces a encabezados del mismo documento y de otros documentos; consulta en el editor en vivo los diagnósticos de VS Code de correctores ortográficos, markdownlint, Vale y otras herramientas de lenguaje.
- Mantén sincronizados los editores divididos mediante el documento de texto de VS Code.
- Sincroniza el tema del editor seleccionado entre las pestañas Markdown abiertas.
- Mantén la capacidad de respuesta en documentos largos con estadísticas, seguimiento de Outline y actualizaciones del cursor de la vista en vivo optimizados.
- Aplica formato desde una barra de herramientas adaptable, controles de selección, el cuadro de diálogo de enlaces o la inserción rápida con `/`, sin salir del documento renderizado.
- Consulta en la barra de estado del editor la sincronización del guardado, la sección actual, las estadísticas del documento y los diagnósticos que requieren una acción.

La vista de Markda en la barra de actividad permite navegar por el esquema del documento y los archivos Markdown.

## Comandos y atajos útiles

Los atajos incluidos por Markda están desactivados de forma predeterminada para no reemplazar los de VS Code. Activa **Markda › Editor: Enable Default Keybindings** para usar los siguientes atajos; también puedes cambiar su prioridad desde la barra de herramientas del editor Markda o asignar comandos `Markda:` individuales en **Keyboard Shortcuts**.

| Acción | Windows/Linux | macOS |
| --- | --- | --- |
| Alternar el modo de código fuente | `Ctrl+/` | `Cmd+/` |
| Alternar el modo de concentración | `F8` | `F8` |
| Alternar el modo máquina de escribir | `F9` | `F9` |
| Negrita | `Ctrl+B` | `Cmd+B` |
| Cursiva | `Ctrl+I` | `Cmd+I` |
| Insertar enlace | `Ctrl+K` | `Cmd+K` |
| Lista numerada | `Ctrl+Shift+[` | `Cmd+Option+O` |
| Lista con viñetas | `Ctrl+Shift+]` | `Cmd+Option+U` |
| Cita en bloque | `Ctrl+Shift+Q` | `Cmd+Option+Q` |
| Bloque de código | `Ctrl+Shift+K` | `Cmd+Option+C` |
| Tachado | `Alt+Shift+5` | `Ctrl+Shift+Backtick` |
| Copiar como Markdown | `Ctrl+Shift+C` | `Cmd+Shift+C` |
| Pegar como texto sin formato | `Ctrl+Shift+V` | `Cmd+Shift+V` |

Busca `Markda:` en la paleta de comandos para ver todos los comandos disponibles, incluidos los de inserción de tablas y fórmulas, búsqueda en el espacio de trabajo, estadísticas, exportación HTML/PDF y destinos externos configurados.

Ejecuta **Markda: Configure File Associations** para elegir cuáles de estas extensiones se abrirán con Markda de forma predeterminada: `.md`, `.markdown`, `.mdown`, `.mkd`, `.mkdn`, `.mdwn` y `.txt`. Las asociaciones se pueden guardar para el usuario actual o solo para el espacio de trabajo. Se almacenan en el ajuste `workbench.editorAssociations` de VS Code y también se pueden revisar o cambiar más tarde en Settings.

## Configuración

Los ajustes `markda.*` controlan el ancho del editor, la pareja de delimitadores, el comportamiento de máquina de escribir, la demora de la vista previa dividida, el límite de tamaño de las tablas en vivo, las funciones Markdown, las rutas de imágenes, los temas, la exportación, los recursos remotos y el HTML no seguro. `markda.export.pdfBrowserPath` selecciona un ejecutable personalizado de Edge/Chrome/Chromium; si está vacío, Markda busca en `PATH` y en ubicaciones comunes de aplicaciones del sistema y del usuario. `markda.export.targets` registra comandos de confianza en forma de matriz de argumentos con `${source}`, `${destination}`, `${documentDir}`, `${documentName}` y `${workspaceFolder}`. Abre **Settings** y busca `markda` para ver las descripciones y los valores predeterminados.

De forma predeterminada, se pide confirmación antes de cargar recursos remotos y el HTML no seguro está desactivado. En un espacio de trabajo no confiable se restringen los destinos de imágenes controlados por el espacio de trabajo y las excepciones de seguridad.

## Requisitos y alcance

- VS Code Desktop 1.100 o posterior
- Hosts de extensión de escritorio locales o remotos; esta versión no es una extensión web para `vscode.dev`.
- Se admiten las exportaciones HTML y PDF. Se pueden configurar destinos externos para otros formatos, pero no se incluyen herramientas de conversión.
- La interfaz de la extensión está localizada en inglés, árabe, alemán, español, francés, japonés, coreano, portugués brasileño, ruso, chino simplificado y chino tradicional. VS Code usa el idioma de visualización elegido en sus ajustes.

## Privacidad y seguridad

Markda no incluye telemetría. El renderizado Markdown y las funciones incluidas para diagramas y fórmulas se ejecutan localmente. La apertura de enlaces externos y la carga de recursos remotos siguen sujetas a los ajustes de seguridad de Markda y a Workspace Trust de VS Code.

## Desarrollo

```text
npm install
npm run check
npm test
npm run build
```

Pulsa `F5` en VS Code para abrir Extension Development Host con `docs/DEMO.md`. Consulta [`docs/SPECIFICATION.md`](SPECIFICATION.md) para conocer el contrato de compatibilidad y el estado de implementación, y [`docs/PUBLISHING.md`](PUBLISHING.md) para la lista de comprobación de publicación.

Se agradecen los informes de errores y las solicitudes concretas de funciones en [GitHub Issues](https://github.com/tetsuji16/Markda/issues).

## Licencia

MIT
