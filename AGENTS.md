# Aulaforma — especificación del producto

Este archivo documenta el producto solicitado y sirve como referencia para el trabajo posterior. Si la implementación actual contradice esta especificación, seguir esta especificación y conservar el alcance del MVP.

## 1. Objetivo

Crear una aplicación web para que docentes armen pruebas listas para imprimir usando formularios sencillos, con una experiencia de edición similar a Google Forms. El docente organiza secciones, preguntas y encabezados; Aulaforma genera los PDF y permite crear varias formas de una misma prueba.

La aplicación se alojará en Vercel y usará Supabase para cuentas y persistencia. La solicitud inicial mencionó Turso; el usuario corrigió expresamente la base de datos a Supabase.

## 2. Principios del producto

- El flujo principal debe ser visual y guiado: editar campos y preguntas, no diseñar páginas a mano.
- El PDF debe ser generado en JavaScript a partir de los datos de la prueba.
- Guardar en la base de datos los datos estructurados de la prueba y el historial; no guardar los archivos PDF generados.
- Mantener las claves secretas de Supabase fuera del navegador. Usar Supabase Auth, clave publicable y políticas RLS.
- Compartir bancos mediante enlaces de importación; al importar, el docente obtiene su propia copia editable.
- La aleatorización debe conservar una pauta de respuestas correspondiente a cada forma.

## 3. Usuarios y cuentas

El MVP está dirigido a docentes. Debe permitir:

- Crear una cuenta con correo y contraseña.
- Iniciar y cerrar sesión.
- Guardar y consultar las pruebas propias.
- Proteger los documentos de cada docente con Supabase Auth y RLS.
- Exigir autenticación para guardar documentos o publicar bancos.

Los PDF deben poder generarse desde el editor. El historial y el intercambio persistente entre dispositivos requieren una cuenta.

## 4. Flujo para crear una prueba

1. Crear una prueba nueva y completar sus datos generales: título, asignatura, curso/nivel, docente y duración.
2. Personalizar el encabezado imprimible.
3. Crear una o más secciones con título e instrucciones.
4. Añadir preguntas mediante controles apropiados para su tipo.
5. Definir puntajes y, cuando corresponda, marcar una o varias respuestas correctas.
6. Elegir cuántas preguntas de cada sección entran en cada forma.
7. Configurar la cantidad de formas y generar el PDF para estudiantes.
8. Descargar por separado la pauta de respuestas que corresponde exactamente a esas formas.
9. Guardar la prueba para poder retomarla desde el historial.

La interfaz debe ofrecer vista previa del papel y acceso visible a la configuración del encabezado, secciones, banco, historial y exportación.

## 5. Encabezado de la prueba

El docente debe poder personalizar el encabezado sin editar HTML o PDF directamente:

- Subir, reemplazar y quitar el logo o insignia del establecimiento.
- Escribir el nombre del establecimiento.
- Definir un título principal impreso y un subtítulo institucional opcional.
- Dejar vacío el título personalizado para usar el título general de la prueba.
- Añadir, renombrar, activar/desactivar y quitar espacios para completar.
- Elegir si un espacio ocupa una línea completa o comparte fila con otro.
- Incluir campos sugeridos: nombre y apellido, RUT/identificador, curso, fecha, puntaje, nota y firma.
- Añadir campos propios para adaptarse a formatos de cada establecimiento.
- Ver una previsualización y usar el mismo encabezado en todas las formas.

Los logos se deben reducir/comprimir en el navegador antes de guardarlos en el JSON de la prueba. El límite de carga y el tamaño final deben evitar documentos excesivos.

## 6. Secciones y banco de preguntas

Cada sección debe incluir:

- Título e instrucciones.
- Preguntas disponibles para esa sección.
- Un número seleccionable de preguntas que se incluirá en cada forma.
- Puntaje total calculado usando las preguntas seleccionadas en cada forma.

El MVP debe permitir reusar preguntas de un banco compartido y también importar/exportar preguntas en un formato estructurado sencillo cuando resulte útil.

### Tipos de preguntas recomendados

Implementar primero los tipos que cubren evaluaciones escolares frecuentes:

1. **Selección única:** alternativas y una respuesta correcta.
2. **Selección múltiple:** alternativas y varias respuestas correctas; indicar en el enunciado que puede haber más de una respuesta.
3. **Verdadero o falso:** dos alternativas, una correcta.
4. **Respuesta breve o desarrollo:** enunciado y espacio de líneas imprimibles configurable o con un valor inicial razonable.
5. **Completar:** enunciado con uno o más espacios y respuesta esperada para la pauta.
6. **Términos pareados:** pares editables; imprimir dos columnas y mezclar las opciones de la segunda columna por forma.

Los tipos 1–6 constituyen la propuesta para el MVP. Cada tipo debe tener un editor comprensible, impresión adecuada y una representación de respuesta que permita generar la pauta. Mantener la respuesta correcta fuera del PDF para estudiantes.

### Tipos posteriores (no bloquean el MVP)

- Ordenar pasos o eventos.
- Respuesta numérica con tolerancia o unidad.
- Pregunta basada en imagen o diagrama.
- Rúbrica de evaluación para desarrollo.
- Matriz de alternativas por filas/columnas.

Agregar estos tipos después de observar cuáles necesita el profesorado; no requieren un editor genérico complejo en el MVP.

## 7. Formas y aleatorización

- Permitir entre 1 y 10 formas por exportación inicial, con una configuración sencilla.
- Para cada forma, seleccionar aleatoriamente la cantidad elegida de preguntas de cada sección.
- Aleatorizar el orden de las preguntas seleccionadas.
- Aleatorizar la posición de las alternativas de preguntas cerradas entre formas.
- Aleatorizar la segunda columna de preguntas pareadas.
- Asignar identificadores visibles consecutivos (Forma A, B, C, etc.).
- Calcular el puntaje total de cada forma según las preguntas que realmente contiene.
- Generar la pauta como un archivo aparte con la forma, número de pregunta y respuesta correcta ya traducida a su nueva posición.
- La pauta y las pruebas de estudiantes de una misma exportación deben compartir el mismo plan aleatorio. No volver a sortear al generar la pauta.
- Si se requiere volver a producir exactamente la misma exportación, conservar su semilla o plan junto al documento/configuración, nunca el PDF.

## 8. PDF

- Generarlo en el navegador con JavaScript a partir de los datos guardados.
- Entregar un PDF de estudiantes con todas las formas solicitadas.
- Entregar un PDF de pauta separado; no añadir respuestas al mismo documento para estudiantes.
- Incluir el encabezado personalizado, datos generales, campos para completar, secciones, puntajes y espacios de respuesta.
- Respetar saltos de página, márgenes legibles y un tamaño de papel inicial consistente (carta; considerar A4 como opción posterior o configurable si el alcance lo permite).
- El PDF puede volver a generarse a demanda. No persistir su blob en Supabase.

## 9. Historial y persistencia

Supabase Postgres debe guardar, como mínimo:

- **documents:** id, propietario (auth user id), título, JSON completo de la prueba, fecha de actualización.
- **banks:** id/link compartible, propietario, título, JSON de preguntas y fecha de creación.

El historial debe listar pruebas recientes del usuario y permitir abrirlas, seguir editándolas y regenerar sus PDF. Guardar debe actualizar el mismo documento cuando tenga id, en vez de crear duplicados.

No almacenar PDFs generados. El JSON debe contener el encabezado, las secciones, las preguntas, sus respuestas, puntajes, selección por sección y configuración de formas.

## 10. Bancos compartidos

- El docente autenticado puede crear un enlace de lectura/importación para un banco.
- El enlace debe usar un identificador difícil de adivinar y permitir descargar/importar el JSON de preguntas.
- Quien importe recibe una copia independiente; no modifica el banco original.
- La lectura compartida se debe limitar al banco enlazado, con RLS y el token de enlace. No habilitar lectura anónima enumerable de todos los bancos.
- Un banco compartido incluye los datos pedagógicos necesarios para editar las preguntas, incluida la pauta para otros docentes.

## 11. Arquitectura y configuración

- **Web:** Next.js con TypeScript, desplegable en Vercel.
- **Cuentas y datos:** Supabase Auth y Postgres.
- **PDF:** generación en el navegador con JavaScript.
- **Seguridad:** clave publicable en cliente; nunca incluir claves secretas/service-role en código cliente ni variables `NEXT_PUBLIC_*`. Activar RLS en todas las tablas accesibles por la API.
- Documentar las variables de entorno, la ejecución de `supabase/schema.sql`, configuración de URLs de Auth y pasos de desarrollo/despliegue.

## 12. Criterios de aceptación del MVP

- Un docente puede registrarse, iniciar sesión y cerrar sesión.
- Puede crear una prueba con secciones y los seis tipos propuestos arriba.
- Puede configurar el encabezado con logo, títulos y campos imprimibles y verlo en la vista previa.
- Puede seleccionar una cantidad de preguntas por sección y producir hasta 10 formas aleatorias.
- Cambian el orden/selección de preguntas y las posiciones de alternativas entre formas; la pauta separada coincide con el plan de cada forma.
- Puede descargar PDF de estudiantes y PDF de pauta por separado.
- Puede guardar una prueba, verla en su historial, volver a abrirla y regenerar los archivos.
- Puede publicar un banco, compartir su enlace e importar una copia en otra prueba.
- Los datos de un usuario no se pueden leer o cambiar desde otra cuenta; el enlace de banco sólo permite leer el banco indicado.
- Los archivos PDF no se guardan en la base de datos.

## 13. Revisión de alcance

Construir primero el flujo completo de autoría → variantes → PDF/pauta → historial/compartir. Mantener la implementación pequeña, pero no quitar tipos, pauta, seguridad RLS ni personalización del encabezado, porque son requisitos funcionales explícitos.
