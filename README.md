# Apollo

Editor de pruebas imprimibles con Next.js, Supabase Auth, Postgres y generación de PDF en el navegador.

## Preparación

1. Crea un proyecto Supabase y ejecuta [`supabase/schema.sql`](./supabase/schema.sql) en el SQL Editor.
2. Copia `.env.example` a `.env.local` y completa la URL y la **publishable key** del proyecto. No uses una secret/service-role key en variables `NEXT_PUBLIC_*`.
3. En Supabase Auth, configura la URL del sitio y habilita correo/contraseña. Para desarrollo, añade `http://localhost:3000` a las URL permitidas.
4. Ejecuta `npm install` y `npm run dev`. Para Vercel, define esas mismas dos variables de entorno en el proyecto y despliega.

Las pruebas guardan su JSON en Postgres. El PDF se genera en el navegador y se puede revisar en la vista previa antes de descargarlo; los archivos PDF no se guardan. Los enlaces de bancos permiten importar sus preguntas.
El encabezado permite elegir entre una distribución institucional o en dos columnas, añadir logotipos y datos académicos, y repetir una versión compacta en páginas continuadas. Por defecto, nombre, fecha y nota comparten la primera fila y RUT, curso y puntaje la segunda; cada campo permite ajustar el ancho de escritura y elegir fila. Las preguntas abiertas pueden incluir o quitar líneas; LaTeX queda separado del enunciado y se renderiza en la vista previa y PDF. Las expresiones delimitadas por `$...$`, `$$...$$`, `\(...\)` o `\[...\]` se admiten dentro del texto.
