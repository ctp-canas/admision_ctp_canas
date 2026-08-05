-- Datos completamente ficticios para verificar los tres posibles resultados.
-- Ejecute este archivo solo en un ambiente de prueba y elimine los registros
-- antes de cargar la información oficial del proceso de admisión.

begin;

insert into public.estudiantes (
  cedula, contrasena_hash, nombre, primer_apellido, segundo_apellido, estado_admision
)
values
  ('701230456', extensions.crypt('Prueba2027-Ana', extensions.gen_salt('bf', 10)), 'Ana Sofía', 'Jiménez', 'Rojas', 'Admitido'),
  ('702340567', extensions.crypt('Prueba2027-Bruno', extensions.gen_salt('bf', 10)), 'Bruno Andrés', 'Solano', 'Vargas', 'Admitido'),
  ('703450678', extensions.crypt('Prueba2027-Camila', extensions.gen_salt('bf', 10)), 'Camila María', 'Fernández', 'López', 'En lista de espera'),
  ('704560789', extensions.crypt('Prueba2027-Diego', extensions.gen_salt('bf', 10)), 'Diego José', 'Mora', 'Cordero', 'En lista de espera'),
  ('705670890', extensions.crypt('Prueba2027-Elena', extensions.gen_salt('bf', 10)), 'Elena Isabel', 'Rodríguez', 'Araya', 'No Admitido'),
  ('706780901', extensions.crypt('Prueba2027-Fabian', extensions.gen_salt('bf', 10)), 'Fabián Alejandro', 'Castro', 'Chaves', 'No Admitido')
on conflict (cedula) do update
set contrasena_hash = excluded.contrasena_hash,
    nombre = excluded.nombre,
    primer_apellido = excluded.primer_apellido,
    segundo_apellido = excluded.segundo_apellido,
    estado_admision = excluded.estado_admision,
    actualizado_en = pg_catalog.now();

update public.configuracion_sistema
set inicio = pg_catalog.now() - interval '1 day',
    fin = pg_catalog.now() + interval '30 days',
    habilitado = true,
    ciclo_lectivo = 2027,
    actualizado_en = pg_catalog.now()
where id = true;

commit;
