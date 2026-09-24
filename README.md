# Apollo

Editor de pruebas imprimibles con Next.js, Supabase Auth, Postgres y generación de PDF en el navegador.

## Preparación

1. Crea un proyecto Supabase y ejecuta [`supabase/schema.sql`](./supabase/schema.sql) en el SQL Editor.
2. Copia `.env.example` a `.env.local` y completa la URL y la **publishable key** de Supabase. No uses una secret/service-role key en variables `NEXT_PUBLIC_*`.
3. En Supabase Auth, configura la URL del sitio y habilita correo/contraseña. Para desarrollo, añade `http://localhost:3000` a las URL permitidas.
4. Ejecuta `npm install` y `npm run dev`. Para Vercel, define las dos variables de Supabase; PostHog es opcional y se configura con las variables indicadas abajo.

Las pruebas guardan su JSON en Postgres. El PDF se genera en el navegador y se puede revisar en la vista previa antes de descargarlo; los archivos PDF no se guardan. Los enlaces de bancos permiten importar sus preguntas.
El encabezado permite elegir entre una distribución institucional o en dos columnas, añadir logotipos y datos académicos, y repetir una versión compacta en páginas continuadas. Por defecto, nombre, fecha y nota comparten la primera fila y RUT, curso y puntaje la segunda; cada campo permite ajustar el ancho de escritura y elegir fila. Las preguntas abiertas pueden incluir o quitar líneas; LaTeX queda separado del enunciado y se renderiza en la vista previa y PDF. Las expresiones delimitadas por `$...$`, `$$...$$`, `\(...\)` o `\[...\]` se admiten dentro del texto. En la personalización del encabezado, la vista previa muestra el PDF real y se actualiza automáticamente; su panel se redimensiona arrastrando el divisor y ajustando el alto, y en pantallas pequeñas queda debajo del formulario.
El sitio público es `/` y el editor queda disponible directamente en `/editor`; el CTA de la portada abre el editor sin exigir registro. Los enlaces de bancos usan `/editor?banco=<id>` y los enlaces antiguos `/?banco=<id>` se redirigen para conservar la importación. En escritorio la barra lateral muestra nombres de pestañas y se puede contraer; en resoluciones intermedias aparece compacta y en móvil la navegación y las acciones se agrupan en menús. La vista previa del PDF y el minimapa tienen controles de ocultar/mostrar.

## Comentarios y analítica

El formulario flotante permite enviar sugerencias o informar problemas, de forma anónima. Evita incluir datos personales, información de estudiantes o respuestas. Los comentarios se guardan en `public.feedback`; el rol de la aplicación sólo puede insertar y no puede listar ni leerlos. El equipo puede revisarlos desde el panel de Supabase. Para un proyecto ya creado, vuelve a ejecutar `supabase/schema.sql` en el SQL Editor para aplicar la tabla y sus políticas de inserción.

PostHog es opcional. Define `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` con el token público del proyecto y `NEXT_PUBLIC_POSTHOG_HOST` con el host de ingestión (por defecto `https://us.i.posthog.com`; para EU usa `https://eu.i.posthog.com`). Si el token no está definido, no se muestra la preferencia ni se inicializa el SDK. La analítica sólo empieza después de que la persona elige «Aceptar analítica»; la elección se puede cambiar en «Privacidad».

La configuración desactiva autocaptura, grabaciones de sesión, reproducción, identificación de perfiles y captura automática de errores/rendimiento. Sólo se envían visitas con la ruta sin parámetros y eventos de uso permitidos; las propiedades URL se limpian y se omiten parámetros de campaña. El texto de comentarios, el contenido de las pruebas, preguntas y respuestas nunca se envía a PostHog. PostHog sí recibe un identificador anónimo y datos técnicos de la visita.
