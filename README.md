# Resultados de admisión 2027 — CTP Cañas

Sitio web estático, accesible y adaptable a teléfonos, tabletas y computadoras. Está preparado para publicarse en GitHub Pages y utiliza Supabase como base de datos, autenticación administrativa y capa de seguridad.

## Estructura del proyecto

```text
.
├── index.html                  Consulta pública
├── admin.html                  Panel administrativo
├── admin/index.html            Permite ingresar mediante /admin/
├── app.js                      Lógica de consulta y administración
├── style.css                   Diseño responsive y accesible
├── config.js                   Configuración pública de Supabase
├── supabase.sql                Base de datos, RLS y funciones seguras
├── supabase_datos_prueba.sql   Carga opcional de aspirantes ficticios
├── plantilla_importacion.csv   Plantilla para carga masiva
├── datos_prueba.csv            Credenciales ficticias para verificar el sistema
├── assets/
│   ├── escudo-ctp-canas.webp
│   └── vendor/                 Bibliotecas fijadas para evitar dependencias remotas
├── scripts/
│   └── inject-config.mjs       Inserta variables durante el despliegue
└── .github/workflows/
    └── deploy-pages.yml        Publicación automática en GitHub Pages
```

## 1. Crear y preparar Supabase

1. Ingrese a [Supabase](https://supabase.com/dashboard) y cree un proyecto.
2. Abra **SQL Editor**, cree una consulta nueva, copie todo el contenido de `supabase.sql` y seleccione **Run**.
3. En **Authentication > Providers > Email**, desactive el registro público de usuarios. Solamente el personal autorizado debe poder crear cuentas.
4. En **Authentication > Users**, seleccione **Add user** y cree la cuenta administrativa. Para permitir el ingreso mediante usuario, use como correo interno `USUARIO@admin.ctpcanas.invalid`. Utilice una contraseña extensa y única y marque la cuenta como confirmada.
5. Copie el UUID del usuario creado y ejecute en SQL Editor:

```sql
insert into public.administradores (usuario_id)
values ('UUID-DEL-USUARIO-ADMINISTRADOR');
```

6. En **Project Settings > API** o en el cuadro **Connect**, copie:
   - Project URL.
   - Publishable key. En proyectos antiguos puede aparecer como `anon key`.

La *publishable key* puede estar en el navegador porque las tablas no ofrecen acceso directo y las reglas RLS están activas. **Nunca utilice la secret key ni la service_role key en `config.js`, GitHub o GitHub Pages.**

## 2. Configuración local

El archivo entregado ya está conectado con la base de datos de prueba. Si desea vincular otra instancia, abra `config.js` y sustituya solamente estos valores:

```js
supabaseUrl: "https://SU-PROYECTO.supabase.co",
supabasePublishableKey: "SU-PUBLISHABLE-KEY",
```

Para probar el sitio no conviene abrir `index.html` directamente desde el explorador de archivos. Desde la carpeta del proyecto ejecute uno de estos comandos:

```bash
py -m http.server 8000
```

o:

```bash
python3 -m http.server 8000
```

Luego visite `http://localhost:8000`.

## 3. Publicar en GitHub Pages

1. Cree un repositorio nuevo en GitHub.
2. Coloque el contenido de esta carpeta en la raíz del repositorio y súbalo a la rama `main`.
3. En el repositorio, abra **Settings > Secrets and variables > Actions > Variables** y agregue:
   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY`
4. En **Settings > Pages**, elija **GitHub Actions** como origen de publicación.
5. Abra la pestaña **Actions** y verifique que el flujo **Publicar en GitHub Pages** finalice correctamente.

El flujo de trabajo reemplaza los marcadores de `config.js` únicamente en el archivo publicado. Esto permite mantener el código fuente reutilizable. Estas dos variables son públicas; no coloque credenciales privadas en ellas.

La consulta quedará en una dirección similar a:

```text
https://USUARIO.github.io/NOMBRE-DEL-REPOSITORIO/
```

El panel administrativo se puede abrir con:

```text
https://USUARIO.github.io/NOMBRE-DEL-REPOSITORIO/admin/
```

## 4. Uso del panel administrativo

1. Ingrese a `/admin/` con el usuario y la contraseña administrativos.
2. En **Aspirantes** puede buscar, agregar, editar o eliminar registros individuales.
3. En **Importar Excel o CSV** puede descargar la plantilla y cargar hasta 5 000 filas. El archivo debe contener estas columnas exactas:

| Columna | Contenido |
| --- | --- |
| `cedula` | Identificación única; admite números con o sin guiones |
| `contrasena` | De 6 a 72 caracteres |
| `nombre` | Nombre de la persona aspirante |
| `primer_apellido` | Primer apellido |
| `segundo_apellido` | Segundo apellido; puede quedar vacío |
| `estado_admision` | `Admitido`, `No Admitido` o `En lista de espera` |

4. En **Disponibilidad** defina la fecha y hora de inicio, la fecha y hora final y active la publicación. Las horas se interpretan en la zona horaria de Costa Rica.
5. En **Acciones críticas** puede vaciar únicamente la tabla de aspirantes. Se exige escribir la frase `ELIMINAR TODO`; las cuentas administrativas, la bitácora y el horario no se borran.

Las contraseñas del archivo se transmiten por HTTPS y se convierten inmediatamente en hashes bcrypt dentro de PostgreSQL. Por seguridad, elimine el archivo de importación del equipo cuando termine y no lo comparta por correo o mensajería.

### Base de datos de prueba incluida

La instancia conectada contiene seis aspirantes ficticios, distribuidos entre los estados **Admitido**, **En lista de espera** y **No Admitido**. Sus credenciales se encuentran en `datos_prueba.csv`. El horario de consulta quedó habilitado durante 30 días para facilitar la verificación.

Antes de cargar datos reales, ingrese en **Acciones críticas**, vacíe los registros de prueba y cambie la contraseña administrativa. No publique `datos_prueba.csv` cuando el sistema entre en operación oficial.

## 5. Controles de seguridad incorporados

- Las tablas tienen RLS habilitado y no conceden lectura directa a visitantes ni a usuarios autenticados.
- La consulta pública devuelve solamente el nombre y el resultado cuando las credenciales coinciden.
- Las contraseñas se almacenan mediante bcrypt; no existe una función para recuperarlas.
- Después de cinco intentos fallidos para una identificación, la consulta queda bloqueada durante 15 minutos.
- El horario se comprueba en el servidor de Supabase, no con el reloj del dispositivo.
- Las operaciones administrativas validan la cuenta contra una lista autorizada.
- La carga masiva limita tipo, tamaño, columnas, cantidad y contenido del archivo.
- Las acciones de creación, edición, eliminación, importación y borrado general quedan registradas en `bitacora_administrativa`.
- La política de seguridad de contenido del navegador limita scripts, conexiones y recursos externos.
- Las bibliotecas del navegador se incluyen localmente y en versiones fijas; el sitio no depende de scripts remotos en cada visita.

## 6. Recomendaciones antes de abrir el sistema

- Use contraseñas aleatorias de al menos 10 caracteres para las personas aspirantes.
- Active autenticación multifactor para las cuentas administrativas si su configuración de Supabase lo permite.
- Pruebe los tres estados de admisión con cuentas ficticias.
- Confirme la fecha y hora de publicación desde un teléfono y una computadora.
- Realice un respaldo antes de utilizar el borrado general o una nueva importación.
- No publique archivos de Excel o CSV con datos reales dentro del repositorio.

## 7. Cambio del ciclo lectivo

El texto visible de 2027 se encuentra en `index.html` y `admin.html`. La base de datos también conserva `ciclo_lectivo` en `configuracion_sistema`. Para un ciclo posterior, actualice esos textos y ejecute:

```sql
update public.configuracion_sistema
set ciclo_lectivo = 2028,
    habilitado = false,
    actualizado_en = now()
where id = true;
```

Después puede vaciar los aspirantes desde el panel, importar la nueva lista y establecer el nuevo horario.
