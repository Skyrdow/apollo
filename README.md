# Apollo

Editor de pruebas imprimibles con Next.js, Turso/libSQL y generación de PDF en el navegador.

## Preparación

1. Crea una base de datos en Turso y obtén su URL libSQL y un auth token.
2. Copia `.env.example` a `.env.local` y completa `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN`. El token es secreto y sólo se usa en el servidor.
3. Ejecuta `npm install`, luego `npm run db:setup` para crear las tablas y finalmente `npm run dev`.
4. En Vercel, define las mismas variables de entorno; PostHog es opcional.

El proyecto parte desde cero: no se importan cuentas ni datos existentes de Supabase. Las cuentas nuevas usan correo y contraseña; las contraseñas se guardan con scrypt y las sesiones usan cookies HttpOnly de 30 días. La API limita a 20 solicitudes de autenticación por IP cada 60 segundos. No hay confirmación ni recuperación por correo.
Las pruebas guardan su JSON en Turso. El PDF se genera en el navegador y no se persiste. Los enlaces de bancos permiten importar sus preguntas.
El encabezado permite elegir entre una distribución institucional o en dos columnas, añadir logotipos y datos académicos, y repetir una versión compacta en páginas continuadas. Por defecto, nombre, fecha y nota comparten la primera fila y RUT, curso y puntaje la segunda; cada campo permite ajustar el ancho de escritura y elegir fila. Las preguntas abiertas pueden incluir o quitar líneas; LaTeX queda separado del enunciado y se renderiza en la vista previa y PDF. Las expresiones delimitadas por `$...$`, `$$...$$`, `\(...\)` o `\[...\]` se admiten dentro del texto. En la personalización del encabezado, la vista previa muestra el PDF real y se actualiza automáticamente; su panel se redimensiona arrastrando el divisor y ajustando el alto, y en pantallas pequeñas queda debajo del formulario.
El sitio público es `/` y el editor queda disponible directamente en `/editor`; el CTA de la portada abre el editor sin exigir registro. Los enlaces de bancos usan `/editor?banco=<id>` y los enlaces antiguos `/?banco=<id>` se redirigen para conservar la importación. En escritorio la barra lateral muestra nombres de pestañas y se puede contraer; en resoluciones intermedias aparece compacta y en móvil la navegación y las acciones se agrupan en menús. La vista previa del PDF y el minimapa tienen controles de ocultar/mostrar.

## Comentarios y analítica

El formulario flotante permite enviar sugerencias o informar problemas, de forma anónima. Evita incluir datos personales, información de estudiantes o respuestas. Los comentarios se guardan en la tabla `feedback`; la API sólo permite insertarlos. Se pueden consultar desde Turso. `npm run db:setup` crea esta tabla junto con el resto del esquema.

PostHog es opcional. Define `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` con el token público del proyecto y `NEXT_PUBLIC_POSTHOG_HOST` con el host de ingestión (por defecto `https://us.i.posthog.com`; para EU usa `https://eu.i.posthog.com`). Si el token no está definido, no se muestra la preferencia ni se inicializa el SDK. La analítica sólo empieza después de que la persona elige «Aceptar analítica»; la elección se puede cambiar en «Privacidad».

La configuración desactiva autocaptura, grabaciones de sesión, reproducción, identificación de perfiles y captura automática de errores/rendimiento. Sólo se envían visitas con la ruta sin parámetros y eventos de uso permitidos; las propiedades URL se limpian y se omiten parámetros de campaña. El texto de comentarios, el contenido de las pruebas, preguntas y respuestas nunca se envía a PostHog. PostHog sí recibe un identificador anónimo y datos técnicos de la visita.
