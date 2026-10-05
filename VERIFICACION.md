# Verificación y estado de entrega

Se completaron 19 pruebas automatizadas y la compilación para GitHub Pages. Las pruebas en navegador verificaron formularios, navegación por teclado, cálculo con cuatro decimales, importación XLSX, PDF con fuentes incorporadas, bloqueo entre sesiones, consulta individual, escape de contenido y presentación móvil. También se generó un PDF de 55 registros para verificar su paginación.

## Configuración de producción — 1 de octubre de 2026

El proyecto elegido `ctp-canas-admision-2027` (`jeisglrbvenpqrofhnny`) estaba vacío. Se instalaron las tablas privadas, RLS, la función SQL de admisiones, la actualización de la nota final y las rutas de búsqueda fijas para las funciones privadas. Se creó el administrador principal con la contraseña del documento privado autorizado, que no forma parte del repositorio.

Se desplegó la Edge Function `admission`. La verificación HTTP confirmó estado público 200, rechazo 401 de operaciones privadas sin sesión, inicio de sesión principal 200 y consulta administrativa autenticada 200 con cero estudiantes. El análisis de seguridad no devolvió advertencias: solo avisos informativos de RLS sin políticas en las nueve tablas privadas, deliberadamente inaccesibles al cliente.

La clave `BACKUP_ENCRYPTION_KEY` requiere configuración en **Edge Functions → Secrets**. Sin esta clave, las operaciones de respaldo, restauración, reinicio y las importaciones que exigen respaldo previo no están habilitadas. No se copiaron ni modificaron datos de la bitácora.

La rama `archive/pre-admision-2027-20261001` conserva el código anterior de GitHub. El flujo nuevo publica únicamente `dist/`, toma la API pública del proyecto elegido y admite una variable de repositorio para cambiarla. El historial conserva los archivos anteriores.

## Corrección del servidor de vista previa

Se corrigió el error ERR_HTTP_HEADERS_SENT que cerraba el proceso cuando el navegador solicitaba un archivo inexistente. El servidor lee el archivo antes de enviar la respuesta y maneja las solicitudes fallidas sin cerrarse. Una prueba solicita el favicon ausente, dos recursos inexistentes y una dirección inválida; luego comprueba que la página de acceso y la página principal siguen disponibles.

Para actualizar una instalación existente, extraiga este ZIP en otra carpeta y copie únicamente `admision-2027/scripts/preview.mjs` a `scripts/preview.mjs` de su instalación actual, reemplazándolo. Reinicie con `npm.cmd run preview` desde la carpeta `admision-2027`. No elimine la carpeta `data`; contiene sus datos locales.

## Diseño institucional y consulta móvil

Se renovó el diseño con los colores del escudo: verde azulado como color principal, dorado como acento y naranja para distinguir los no admitidos en las estadísticas. Se conservaron los logos institucionales originales.

La consulta de resultados se verificó a 320, 360, 390 y 430 píxeles de ancho, en orientación horizontal y con texto ampliado al 200 %, sin desplazamiento horizontal. Los campos usan texto de 16 píxeles y los botones tienen al menos 44 píxeles de alto. Al recibir un resultado, el foco y el desplazamiento de la pantalla lo llevan al resultado.

El panel administrativo incorpora un gráfico circular de admitidos y no admitidos con cantidades, porcentajes y total de resultados definidos. Los pendientes, incompletos y renuncias se indican aparte. Se probaron datos vacíos, ambas categorías y una única categoría.

La imagen institucional, el título y el subtítulo de los PDF se centran y se repiten en todas las páginas, incluidas las páginas adicionales de firmas. Se verificó un informe de una página y otro de 55 registros en cinco páginas.

Para aplicar esta actualización a su vista previa actual: detenga el servidor con Ctrl+C, extraiga el ZIP en otra carpeta, copie la carpeta `public` y el archivo `scripts/preview.mjs` sobre los de su instalación, y reinicie con `npm.cmd run preview`. Conserve `data`, que contiene los registros locales. Recargue el navegador con Ctrl+F5.

## Nota final en la consulta individual

La consulta incluye la nota final sobre 100 y cuatro decimales para admitidos y no admitidos. El servidor devuelve únicamente la nota del expediente autenticado, junto con su nombre, estado e indicaciones. La nota proviene del cálculo oficial 60/40; el navegador cambia solamente el separador decimal para mostrarlo con coma.

Las pruebas comprueban notas de 0,0000 y 100,0000, el resultado ponderado 86,2149, ambas condiciones de admisión, bloqueo antes de la fecha de publicación y rechazo de credenciales incorrectas. Una prueba recrea la función anterior en una base persistente, reinicia la vista previa y confirma que la actualización conserva los tres expedientes, sus notas, decisiones y la contraseña administrativa anterior. También confirma que un segundo reinicio conserva los datos y los permisos privados.

Para actualizar su vista previa: detenga el servidor, copie `public`, `backend/local.mjs`, `supabase/update-public-result.sql`, `supabase/password-recovery.sql` y `supabase/functions/admission` del paquete sobre los mismos elementos de su instalación, y reinicie con `npm.cmd run preview`. Conserve `data` y recargue con Ctrl+F5. En Supabase se aplica `supabase/update-public-result.sql` después de la migración inicial, según las instrucciones del README. La API de producción incluye esta actualización; la disponibilidad del sitio se comprueba después de ejecutar el flujo de GitHub Pages.

La interacción de la consulta se verificó mediante pruebas del código del formulario: ambas condiciones, cero, máximo, cuatro decimales, limpieza de contraseña, foco en el resultado y escape de contenido. No fue posible repetir la revisión visual en navegador de esta actualización, porque el navegador de pruebas no está disponible en este entorno y su descarga falló. Las verificaciones visuales anteriores corresponden al diseño previo a la incorporación de la nota.

## Recuperación administrativa por correo — 5 de octubre de 2026

Pasaron 19 pruebas: autenticación y permisos existentes, recuperación con correo coincidente, respuesta genérica para cuentas desconocidas, rechazo de JWT sin el método `recovery`, contraseña mínima, vencimiento, uso único, rechazo de reutilización incluso después de una nueva solicitud, cierre de sesiones anteriores y acceso con la contraseña nueva. Se comprueba además que una dirección de retorno no permitida impida enviar enlaces a `localhost`, y que un fallo de envío elimine la solicitud pendiente. El formulario elimina el token de la URL antes de llamar a la API, valida la confirmación y vuelve al ingreso al finalizar.

La base de producción conserva su cuenta administrativa y sus registros; se añadieron los campos de correo, la identidad auxiliar de Auth y dos tablas privadas con RLS. El RPC nuevo no tiene permiso de ejecución para `anon` ni `authenticated`. La revisión de seguridad no reportó advertencias ni errores; el aviso informativo de RLS sin políticas corresponde al esquema privado, reservado al servidor.

En producción se verificaron: consulta pública HTTP 200, usuarios sin sesión HTTP 401 y rechazo de un enlace de recuperación inválido HTTP 401. La cuenta inicial tiene su correo de recuperación registrado y su identidad auxiliar vinculada. El envío quedó pendiente de permitir la dirección de retorno en Authentication → URL Configuration; no se envió un enlace roto ni se cambió la contraseña real durante la verificación.
