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

## Horarios y asistencia de admisión — 15 de octubre de 2026

Pasaron 31 pruebas automatizadas y la compilación de GitHub Pages. Se verificaron las tres fechas de octubre de 2026, los tres bloques de Costa Rica, asignación individual y múltiple, eliminación, validación de fechas y bloques, permiso del digitador, bloqueo de selección repetida, acceso privado, control de versiones entre sesiones y rechazo atómico de cambios concurrentes. Programar una cita conserva calificaciones, versión del expediente, decisión y corte.

Los respaldos cifrados conservan fecha, bloque y versión del horario. Una restauración con el formato anterior repone los estudiantes sin asignación; el reinicio anual elimina horarios y prepara octubre del año anterior al nuevo ciclo. Las pruebas de interfaz verifican búsqueda, filtros, selección múltiple, versiones al guardar, escape de nombres y que la búsqueda de la tabla no omita estudiantes del PDF.

Se generó y revisó visualmente un PDF Carta de siete páginas con 55 estudiantes en un bloque, otro vacío y un tercer bloque con una estudiante. Se comprobó encabezado institucional de 470 pt (16,59 cm), fecha, bloque, horario y tabla repetidos en cada página, numeración continua por bloque, nombres e identificaciones extensos, firma y persona aplicadora. La extracción confirmó que todos los textos permanecen dentro de los márgenes. No se ejecutó revisión de la interfaz en navegador: el entorno no dispone de la capacidad control-browser requerida; se usaron pruebas del código de interfaz y revisión visual del PDF.

En producción se añadieron tres columnas a la tabla privada sin modificar estudiantes existentes y se actualizó el gateway SQL. La prueba autenticada con datos ficticios dentro de una transacción comprobó asignación, filtro de asistencia, rechazo de versión anterior y acceso anónimo rechazado. La transacción se revirtió y no dejó estudiantes, horarios ni sesiones de prueba. RLS y los permisos exclusivos del servidor siguen activos.

El asesor de seguridad no encontró problemas nuevos relacionados con el horario. Conserva el aviso informativo de tablas privadas sin políticas, deliberadamente reservadas al servidor. También informa de la protección contra contraseñas filtradas deshabilitada en Supabase Auth, una configuración ajena a este cambio; referencia: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection.

## Períodos y reprogramaciones — 15 de octubre de 2026

Pasaron 35 pruebas automatizadas y la compilación. La captura de notas tiene 25 casillas independientes: cuarto I/II, quinto I/II y sexto I. Un conjunto con valores distintos por período dio promedio 80,2324, aporte de presentación 48,1394, aporte de prueba 30,0494 y nota final 78,1888. Se verificaron notas cero, casillas vacías, rechazo del formulario anual anterior, ranking, informe PDF, invalidación del corte y conservación de notas anteriores como referencias. Una prueba de interfaz verifica cinco filas y el envío de 25 campos.

Se verificó reprogramación individual y múltiple con fecha y horas libres de Costa Rica, razón obligatoria, rechazo de fechas inexistentes y horas invertidas, control de versión, limpieza al quitar asignación, auditoría con los datos previos y nuevos, exclusión de la lista anterior e inclusión única en la nueva. Los respaldos restauran la reprogramación, motivo y versión. Las pruebas de interfaz comprueban los campos, su validación y el filtro PDF de reprogramados. El PDF de siete páginas se revisó nuevamente con un horario reprogramado para el 3 de noviembre de 2026, de 9:15 a.m. a 11:15 a.m.; conserva encabezado y firma. No se ejecutó revisión visual de la interfaz en navegador por la limitación control-browser ya documentada.

La actualización de producción conservó los 15 estudiantes. Una comparación interna antes/después confirmó que identificaciones, nombres, credenciales, calificaciones, versiones y horarios previos no cambiaron. Se añadieron únicamente los campos de horario excepcional y las funciones de cálculo. Una prueba autenticada, íntegramente revertida, confirmó el promedio y nota final anteriores, la reprogramación, su lista de firmas y el rechazo de motivo vacío. No quedaron estudiantes ni sesiones de prueba. Los permisos de ejecución continúan exclusivos del servidor y RLS sigue activo. El asesor de seguridad conserva los mismos avisos previos: tablas privadas sin políticas y protección de contraseñas filtradas de Supabase Auth deshabilitada; no hubo avisos nuevos por estos cambios.

## Indicadores de avance y asignación directa — 15 de octubre de 2026

Se reprodujo el problema de interacción anterior: elegir una tarjeta de bloque cambiaba los filtros y reducía la tabla de tres estudiantes visibles a cero cuando ninguno tenía cita en ese bloque. En los registros de la API de horarios del intervalo revisado solo figuraban consultas y preflight, sin solicitudes PUT. Las tarjetas ahora seleccionan el destino de la asignación y mantienen visibles y seleccionados a los estudiantes. La fecha, el bloque y Guardar quedan juntos en cada fila; la asignación múltiple tiene controles separados de los filtros y la impresión.

La columna de avance calcula contraseña registrada, notas completas (25/25), nota de prueba registrada y cita asignada. Las notas y pruebas cero cuentan como registradas; se muestra el conteo parcial de notas y los pasos pendientes. Los indicadores abren los formularios correspondientes, y Cita abre horarios con el estudiante visible y seleccionado. Se conserva el control de versiones del horario y se rechazan cambios concurrentes sin sobrescribir.

Pasaron 38 pruebas y la compilación. Se incorporó jsdom 28.1.0, fijado en el archivo de bloqueo y compatible con Node 24, para verificar el HTML y los scripts reales junto con la función HTTP y PostgreSQL local. Las pruebas ejercitan selección de tarjetas sin ocultar estudiantes, guardado múltiple y por fila, recarga de datos, indicadores y filtros, cero, formularios por paso, reprogramación, motivo, PDF y conflictos de versión. La dependencia se usa únicamente para pruebas y no se publica en el sitio estático. No se ejecutó una revisión visual en navegador: la capacidad control-browser sigue sin estar disponible.

La actualización de producción conserva íntegros los 33 estudiantes, incluidas credenciales, notas y versiones; se comparó una huella de todos los registros antes y después de instalar las funciones. La prueba autenticada y revertida confirmó el avance inicial 1/4, guardado de 25 notas cero, prueba cero y cita, avance final 4/4 y lectura del horario persistido. No quedaron datos ni sesiones de prueba, y no se expuso el hash de contraseña. RLS y los permisos exclusivos del servidor siguen vigentes. El asesor conserva únicamente los avisos previos descritos arriba, sin hallazgos nuevos de esta actualización.

Los indicadores también se actualizan inmediatamente al guardar desde los formularios reales de notas y prueba, sin salir de la sección ni recargar toda la tabla de horarios. Se probó guardar prueba cero desde el modal y observar el cambio del indicador. El cierre del modal cancela la reapertura automática pendiente y mantiene el horario que se estuviera preparando en otra fila.
