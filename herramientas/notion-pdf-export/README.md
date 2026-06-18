# Exportar plantillas de Notion a PDF con subpaginas

## Objetivo

Permitir rellenar una plantilla en Notion y generar PDFs completos sin depender del plan Business. La limitacion actual de Notion es clara: el PDF con `Incluir subpaginas` solo esta disponible en Business o Enterprise. En cambio, la exportacion HTML si puede incluir subpaginas.

La solucion operativa es:

1. Rellenar la plantilla en Notion.
2. Exportar desde Notion en formato `HTML` con `Incluir subpaginas`.
3. Convertir esa exportacion localmente a PDF con el script de este directorio.

## Resultado

El script genera:

- `PR2026_compilado.pdf`: un PDF unico con la pagina principal y sus subpaginas.
- `paginas/*.pdf`: un PDF individual por cada pagina o subpagina exportada.
- `_notion_pdf_compilado.html`: HTML intermedio para revisar si algo necesita ajuste visual.

## Uso

Desde la raiz del workspace:

```bash
node herramientas/notion-pdf-export/notion-html-to-pdf.mjs ~/Downloads/PR2026.zip --out ~/Desktop/PR2026_PDF
```

Tambien acepta una carpeta ya descomprimida:

```bash
node herramientas/notion-pdf-export/notion-html-to-pdf.mjs ~/Downloads/PR2026 --out ~/Desktop/PR2026_PDF
```

## Uso con interfaz web local

Para seleccionar visualmente las paginas que quieres incluir:

```bash
node herramientas/notion-pdf-export/server.mjs
```

Despues abre:

```text
http://127.0.0.1:4173
```

Para permitir que otra persona acceda desde la misma red local:

```bash
HOST=0.0.0.0 PORT=4173 node herramientas/notion-pdf-export/server.mjs
```

Despues comparte la URL con la IP local del Mac que ejecuta la app, por ejemplo:

```text
http://192.168.0.138:4173
```

Cuando la app escucha fuera de `localhost`, la deteccion por ruta local queda desactivada por seguridad. En ese modo la persona usuaria debe subir el `.zip`, la carpeta exportada o los `.html` desde la interfaz.

La interfaz permite:

- subir una carpeta exportada desde Notion;
- subir un `.zip`;
- subir uno o varios `.html`;
- detectar directamente una ruta local del Mac, por ejemplo `/Users/yamilmeliansantos/Downloads/Privado y compartido`;
- ver las paginas detectadas;
- seleccionar que paginas entran en el PDF;
- descargar el PDF compilado y los PDFs individuales.

Para conservar imagenes y subpaginas, lo mas fiable es subir la carpeta completa exportada desde Notion o el `.zip` original.

Si ya tienes el HTML descomprimido en `Downloads`, usa `Detectar desde ruta`. Subir solo el HTML principal no permite al navegador leer automaticamente las subpaginas hermanas.

El PDF compilado no añade portada, indice ni cabeceras propias: usa la plantilla de Notion y las subpaginas seleccionadas, manteniendo el CSS original de Notion y anadiendo solo saltos de pagina entre secciones.

La impresion fuerza formato `A4`, elimina cabecera y pie automaticos de Chrome, neutraliza enlaces locales para que no se incrusten rutas del Mac y aplica reglas de salto para evitar cortes feos en callouts, tablas, columnas y bloques largos.

## Flujo recomendado para PR2026

1. Duplicar la plantilla de Notion para cada persona o ciclo de revision.
2. Rellenar la informacion en Notion manteniendo las subpaginas necesarias.
3. En Notion, abrir la pagina raiz de la revision.
4. Ir a `...` > `Exportar`.
5. Seleccionar formato `HTML`.
6. Activar `Incluir subpaginas`.
7. Descargar el `.zip`.
8. Ejecutar el comando anterior sobre el `.zip`.
9. Revisar `PR2026_compilado.pdf` y, si hace falta, usar los PDFs individuales de `paginas/`.

## Criterio de calidad

- Para archivo interno o entrega consolidada, usar `PR2026_compilado.pdf`.
- Para enviar secciones por separado, usar los PDFs individuales.
- Si una pagina tiene tablas muy anchas, revisar el HTML intermedio y valorar dividir la tabla en Notion antes de exportar.
- Evitar pegar secretos, salarios completos o datos sensibles si el PDF se va a compartir fuera del circuito autorizado.

## Dependencias

No requiere licencia Business de Notion.

Requiere Google Chrome instalado en macOS. Si Chrome no esta en la ruta habitual, se puede indicar manualmente:

```bash
CHROME_PATH="/ruta/a/Chrome" node herramientas/notion-pdf-export/notion-html-to-pdf.mjs ~/Downloads/PR2026.zip --out ~/Desktop/PR2026_PDF
```

## Limitaciones conocidas

- El PDF consolidado recompone varias paginas HTML en un unico documento; para maxima fidelidad visual, comparar con los PDFs individuales.
- Los comentarios de Notion solo apareceran si se exportan dentro del HTML.
- Bases de datos complejas o vistas muy horizontales pueden necesitar ajuste previo en Notion.
- No evita controles de acceso: solo convierte contenido que ya has exportado legitimamente desde Notion.
