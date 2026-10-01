# CTP Cañas · Admisión a sétimo año

Sitio del proceso de admisión a sétimo año para el repositorio `ctp-canas/admision_ctp_canas` y GitHub Pages. El navegador muestra la interfaz y la función `admission` de Supabase ejecuta las operaciones contra PostgreSQL.

El proyecto de producción elegido es **`ctp-canas-admision-2027`**, referencia `jeisglrbvenpqrofhnny`. La base se instaló vacía y conserva el esquema privado, la autenticación por sesiones y el cálculo oficial de las notas. La base de la bitácora es un proyecto separado.

La dirección de API es `https://jeisglrbvenpqrofhnny.supabase.co/functions/v1/admission`. Para habilitar los respaldos y las operaciones que requieren respaldo previo, configure `BACKUP_ENCRYPTION_KEY` en los secretos de Edge Functions antes de importar o trabajar con datos reales. Use una clave aleatoria de al menos 32 caracteres y conserve una copia institucional privada. La clave no se incluye en el repositorio.

## Funciones

- Consulta individual mediante identificación y contraseña, habilitada automáticamente en la fecha y hora de Costa Rica configuradas. Los admitidos y no admitidos ven su nota final sobre 100 con cuatro decimales, calculada en el servidor.
- Registro y modificación de estudiantes; contraseña de seis caracteres A-Z y 0-9; almacenamiento exclusivo de hashes bcrypt.
- Importación XLSX con encabezados exactos, identificación y contraseña como texto, vista previa, errores por fila, descarga de errores y confirmación sin sobrescribir duplicados.
- Récord académico de 15 notas, guardado parcial y navegación con Tab. Las casillas vacías permanecen nulas; cero es una nota válida.
- Prueba de admisión; promedio y aportes 60/40 con cuatro decimales calculados en PostgreSQL.
- Ranking, cupos y empates en el punto de corte: orden alfabético, todos los empatados, selección manual justificada o decisión pendiente.
- Renuncia justificada y nuevo corte para cubrir el cupo. Si el nuevo corte produce un empate, la publicación queda bloqueada hasta resolverlo.
- Bloqueo de notas por expediente y sesión, renovación cada 30 segundos, caducidad de 90 segundos y control de versión.
- Usuarios principal, administrador y digitador; controles de permisos en el servidor.
- PDF Carta horizontal con encabezado institucional, resumen, tabla, cuatro decimales, fin de admitidos, firmas y páginas. Los expedientes incompletos o cortes pendientes generan únicamente borradores.
- Respaldos ZIP cifrados con AES-256, metadatos e integridad; restauración con vista previa y respaldo obligatorio; reinicio anual con respaldo final obligatorio.
- Auditoría sin contraseñas; expiración de sesión de ocho horas y limitación persistente de intentos de acceso.

Cambiar notas, prueba, estudiantes o importar invalida el corte anterior. Vuelva a aplicar y resolver el corte para publicar resultados coherentes. La fecha por sí sola no publica un corte pendiente.

## Vista previa funcional en su equipo

Requiere Node.js 24 y acceso a npm para instalar la dependencia de pruebas. La vista previa usa PostgreSQL mediante PGlite, conserva sus datos localmente en `data/preview-db` y **no conecta con la base de producción**.

```sh
npm ci
npm test
```

Defina `LOCAL_ADMIN_PASSWORD` con una contraseña de al menos 12 caracteres y ejecute:

```sh
npm run preview
```

Abra `http://127.0.0.1:8080/admision-2027/`. El usuario inicial es `Admi2026`; utiliza la contraseña que usted definió. En PowerShell puede definirla con `$env:LOCAL_ADMIN_PASSWORD = Read-Host 'Contraseña de vista previa'`. Esta contraseña nunca forma parte del código. Para regenerar una vista previa vacía, detenga el servidor y elimine solo `data/preview-db`.

## Activar la base de producción

1. El proyecto de producción es `jeisglrbvenpqrofhnny` y su base ya está instalada. Los pasos siguientes documentan cómo reproducir la instalación en una base vacía. Antes de cambiar otra base, revise sus registros y respalde la versión anterior; estos scripts no traspasan datos de sistemas anteriores. No use el proyecto de la bitácora.
2. Instale la [CLI oficial de Supabase](https://supabase.com/docs/guides/local-development/cli/getting-started), inicie sesión y vincule este directorio al proyecto:

```sh
supabase login
supabase link --project-ref PROJECT_REF
supabase db push
```

La migración crea `admission_private`, sus tablas con RLS, una vista de cálculo y dos funciones públicas a las que solo `service_role` tiene permiso de ejecución. No exponga el esquema privado en la API.

Después de aplicar la migración, ejecute el contenido de `supabase/update-public-result.sql` desde el SQL Editor del proyecto. Este archivo agrega la nota final a la respuesta individual, conserva los permisos de la función, fija las rutas de búsqueda de las funciones privadas y no elimina registros. También sirve para una base existente de esta versión.

3. Genere una clave aleatoria de al menos 32 caracteres para `BACKUP_ENCRYPTION_KEY`. Guárdela en un lugar institucional seguro; los respaldos no se pueden descifrar sin la misma clave. Puede generar una con `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` y copiarla directamente a la configuración del servidor.
4. Cree un archivo privado `.env.server` con **solo** estas dos variables y despliegue sus valores:

```dotenv
BACKUP_ENCRYPTION_KEY=su_clave_aleatoria
ALLOWED_ORIGINS=https://ctp-canas.github.io
```

```sh
supabase secrets set --env-file .env.server
supabase functions deploy admission --no-verify-jwt
```

`--no-verify-jwt` permite los accesos públicos de consulta y login. La función aplica su propia autenticación mediante sesiones opacas; todas las operaciones privadas verifican la sesión y el rol en PostgreSQL. No retire esos controles. Supabase proporciona `SUPABASE_URL` y las claves de servidor a la función. Se prefiere la clave `default` de `SUPABASE_SECRET_KEYS`, enviada únicamente como `apikey`; se conserva compatibilidad con `SUPABASE_SERVICE_ROLE_KEY`. Esta clave jamás se copia a GitHub Pages.

5. Para crear el administrador inicial, defina únicamente en su terminal `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `BOOTSTRAP_ADMIN_PASSWORD`. Use la contraseña inicial del documento privado autorizado, o una nueva que cumpla la política. Ejecute `npm run seed-admin`. El proceso solo funciona cuando no existe ningún usuario y guarda un hash bcrypt. No use el archivo de variables del servidor como archivo público.
6. Pruebe `https://PROJECT_REF.supabase.co/functions/v1/admission/api/public/status`: debe responder el ciclo y la disponibilidad, sin datos personales.

## Publicar en GitHub Pages

1. Use el repositorio existente `ctp-canas/admision_ctp_canas`. Si la organización tiene políticas de repositorios privados, verifique que su plan admita Pages; el código no contiene los datos del proceso.
2. Suba el contenido de esta carpeta a la rama `main`, incluidos `.github`, el archivo de bloqueo y la migración. No suba los paquetes antiguos: contienen bases de datos locales y documentación privada.
3. El flujo usa por defecto la API pública del proyecto elegido. Para apuntar a otro proyecto, agregue la variable de repositorio `ADMISSION_API_URL` en **Settings → Secrets and variables → Actions → Variables**. Es una dirección pública, no una clave.
4. En **Settings → Pages → Build and deployment**, seleccione **GitHub Actions**. El flujo `deploy.yml` instala las dependencias, ejecuta las pruebas, genera `dist/` y publica únicamente el sitio estático.
5. Revise que ambos trabajos terminen correctamente. La dirección prevista es `https://ctp-canas.github.io/admision_ctp_canas/`. No debe anunciarse como activa hasta comprobar que carga y se conecta con la API.

Todas las rutas HTML, recursos institucionales, bibliotecas y descargas son relativas y funcionan bajo `/admision_ctp_canas/` (y también bajo otras rutas de proyecto). Las páginas son `index.html`, `admin-login.html` y `admin.html`; no requieren reglas de reescritura ni un servidor Node en GitHub.

## Respaldo y recuperación

El administrador principal puede crear y descargar ZIP desde la pantalla de respaldo. Dentro encontrará `manifest.json` y `datos-cifrados.txt`; el segundo contiene los datos cifrados, incluidos hashes de credenciales, notas, decisiones, configuración, usuarios e historial de auditoría. Los archivos no incluyen sesiones activas ni claves de cifrado. La base conserva las copias y su historial de forma privada.

Para restaurar: seleccione el ZIP, valide su integridad y contenido, revise el ciclo y los conteos, escriba `RESTAURAR` y confirme. El servidor crea el respaldo previo y reemplaza los datos en una única transacción. Si falla cualquier paso, conserva el estado original. La restauración invalida las sesiones. El historial de respaldos y auditoría existente se conserva.

Para reiniciar: defina nuevo ciclo, cupos, publicación e indicaciones, y escriba `REINICIAR 2027` (o el ciclo activo). El sistema exige un respaldo final antes de eliminar estudiantes. Preserva usuarios, roles y antecedentes. Los títulos de la interfaz y los informes usan el nuevo año; la URL del repositorio permanece estable.

La recuperación ante la pérdida completa del proyecto requiere recrear la migración, conservar la clave de cifrado, crear una cuenta principal temporal y restaurar el ZIP. Los respaldos descargados son privados y no deben subirse al repositorio.

## Verificación y límites

`npm test` usa datos ficticios y ejecuta el SQL y la misma función HTTP del backend en PostgreSQL local. Verifica permisos, RLS, cálculo de cuatro decimales, bloqueos por sesión, versiones, nulos y cero, empates, renuncia, consulta individual, importación, cifrado, integridad, reinicio, restauración y limitación de intentos. Las pruebas reducen el costo bcrypt únicamente para datos ficticios; la migración desplegada usa costo 12.

La vista previa no demuestra disponibilidad, latencia o cuotas del servicio publicado. Antes de usar datos reales, haga una prueba en el proyecto nuevo con dos usuarios, un XLSX ficticio, fecha de publicación futura y un respaldo descargado/restaurado. Para archivos grandes, divida la importación en lotes pequeños: el cifrado de contraseñas y el límite de tiempo de consultas dependen del plan del servidor. No se incluye matrícula pública ni envío de correo, funciones que no forman parte del proceso solicitado.

Fuentes oficiales: [GitHub Pages y flujos](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [despliegue de funciones](https://supabase.com/docs/guides/functions/deploy), [variables de servidor](https://supabase.com/docs/guides/functions/secrets). Las bibliotecas para ZIP y PDF están vendorizadas; sus licencias se incluyen en `public/vendor/`.

## Diseño y estadísticas

La interfaz utiliza la paleta del escudo institucional y adapta la consulta individual a celulares. El panel principal muestra un gráfico circular de admitidos y no admitidos. Sus porcentajes se calculan sobre la suma de esas dos categorías; los pendientes, incompletos y renuncias se muestran por separado. El gráfico se actualiza al cargar el panel y al aplicar el corte o resolver decisiones administrativas.

## Actualización de la nota en la consulta de resultados

La consulta muestra «Nota final de admisión», cuatro decimales y «Sobre 100 puntos» para admitidos y no admitidos. Usa el resultado oficial del promedio ponderado 60/40, sin recalcularlo en el navegador. Una nota de cero se muestra como `0,0000`. Los pendientes y las renuncias conservan su mensaje de estado.

Para actualizar una vista previa existente: detenga el servidor con Ctrl+C, extraiga el paquete en otra carpeta y copie `public`, `backend/local.mjs` y `supabase/update-public-result.sql` sobre los mismos elementos de su instalación. Conserve la carpeta `data`. Ejecute `npm.cmd run preview` y recargue con Ctrl+F5. Al arrancar, el servidor aplica la actualización a la base local conservando estudiantes, notas, configuración y credenciales.

Los encabezados de los informes PDF están centrados en todas las páginas.

Para actualizar una vista previa existente, detenga el servidor, reemplace la carpeta `public` y el archivo `scripts/preview.mjs` por los del paquete actualizado, conserve la carpeta `data` y reinicie la vista previa. Recargue el navegador con Ctrl+F5 para cargar los nuevos estilos y scripts.
