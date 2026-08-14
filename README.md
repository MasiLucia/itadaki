# ITADAKI

Pedidos desde la mesa por QR, para restaurantes. El comensal escanea, arma su
pedido y lo sigue en vivo; la cocina lo recibe plato por plato; el mozo ve quién
lo llama y qué hay listo para llevar.

## Cómo levantarlo

Requiere Node 22+ y Docker (para Postgres).

```bash
npm install
npm run db:up      # levanta postgres en el puerto 5433 (docker compose)
npm run db:seed    # aplica las migraciones y carga una carta de ejemplo
npm run start:api  # API en :3000
```

`db:up` crea la base desde cero, rol de aplicación incluido: no hace falta
ningún paso manual. Si algo quedó raro, `npm run db:reset` la rehace vacía.

Después, cada app en su terminal:

```bash
npx ng serve diner-pwa  --port 4200   # comensal
npx ng serve kds-web    --port 4300   # cocina
npx ng serve admin-web  --port 4400   # dueño
npx ng serve floor-web  --port 4500   # mozo
```

### Entrar como comensal

La app del comensal necesita el token de la mesa, que en producción viene del
QR. Para desarrollo, el panel del dueño lo genera: entrá a `:4400`, abrí
**Mesas y códigos QR** y copiá el link de una mesa.

### Cuentas del seed

El seed crea el restaurante `itadaki`. Para tener un usuario, usá:

```bash
node dist/api/apps/api/src/create-staff.js itadaki tu@email.ar TuClave123! OWNER
```

Roles: `OWNER`, `MANAGER`, `KITCHEN`, `WAITER`.

## Las cuatro apps

| App | Puerto | Quién la usa |
|-----|--------|--------------|
| `diner-pwa` | 4200 | El comensal, desde su teléfono tras escanear el QR |
| `kds-web` | 4300 | La cocina: tickets por estación, un botón por plato |
| `admin-web` | 4400 | El dueño: carta, fotos, mesas, equipo, métricas |
| `floor-web` | 4500 | El mozo: llamadas de mesa y platos listos para llevar |

## Arquitectura

Hexagonal, en `libs/` por dominio:

```
libs/<dominio>/domain       reglas puras, sin framework ni IO
libs/<dominio>/application  casos de uso y puertos
libs/<dominio>/infra        adaptadores (Postgres, HTTP, cripto)
```

Las dependencias sólo apuntan hacia adentro — `eslint-plugin-boundaries` lo
verifica en cada build. Los dominios son `identity`, `catalog`, `ordering`,
`billing`, `analytics` y `shared`.

Decisiones que conviene conocer antes de tocar el código:

- **El dinero vive en unidades menores** (centavos) como enteros, nunca en
  punto flotante. Dividir una cuenta reparte el resto, no lo pierde.
- **Los precios se congelan al pedir.** Cambiar un precio en la carta no altera
  un pedido ya hecho: la orden guarda su propia copia.
- **Cada mesa tiene su propio secreto** y su QR va firmado con él, así un
  código no sirve para otra mesa ni para otro restaurante.
- **El estado vive en cada plato**, no en el pedido: la cocina termina las
  empanadas mientras el asado sigue, y el ticket va al ritmo del más lento.
- **Aislamiento entre restaurantes** por row-level security en Postgres; el
  tenant sale siempre de un token firmado, nunca de un parámetro.

## Comandos

```bash
npm test           # 395 tests
npm run lint
npm run typecheck
npm run db:trial   # administrar las pruebas gratis (list | extend | pay)
```

## Variables de entorno

En desarrollo funcionan los valores por defecto. Para producción:

| Variable | Para qué |
|----------|----------|
| `AUTH_SECRET` | Firma las sesiones del personal. Obligatoria; la API no arranca sin ella. |
| `CORS_ORIGINS` | Los orígenes que pueden llamar a la API, separados por coma. Obligatoria. |
| `DATABASE_URL` | Conexión de la app (rol sin privilegios, con RLS aplicada). |
| `DATABASE_ADMIN_URL` | Sólo para migraciones y seed. |
| `GOOGLE_CLIENT_ID` | Habilita el ingreso con Google. Sin ella, el botón no aparece. |
| `SESSION_STALE_HOURS` | Cuánto puede quedar abierta una mesa antes de cerrarse sola (8 por defecto). |
| `RESEND_API_KEY` | Envía los mails de recuperación de contraseña. Obligatoria en producción. |
| `MAIL_FROM` | Remitente verificado, p. ej. `Itadaki <hola@tudominio.com>`. Obligatoria en producción. |
| `NODE_ENV=production` | Endurece el arranque: exige los secretos, falla si Postgres no responde y agrega HSTS. |
| `IMAGE_BASE_URL` | Prefijo de las URLs de las fotos, p. ej. `https://api.tudominio.com/api/images`. Se guarda dentro de cada registro: definila antes de la primera subida. |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Guarda las fotos en un bucket. Sin ellas van al disco local, que no sirve con más de una instancia. `S3_REGION` es opcional (`auto`). |

Las apps del navegador no llevan la URL de la API compilada: la leen en runtime
del `<meta name="itadaki-api">` de su `index.html`. El mismo build sirve para
cualquier despliegue; el entorno completa la etiqueta.

## Respaldos

```bash
scripts/backup.sh                    # dump a ./backups, guarda los últimos 14
scripts/restore.sh backups/<archivo> # restaura (pide confirmación)
```

El restore está probado de punta a punta: restaura los datos, reaplica los
permisos del rol de la app y deja la API operativa sin pasos manuales.

Un respaldo en el mismo disco que la base no es un respaldo. Copialo afuera —
un cron diario con `rclone`, `scp` o lo que uses — y **probá una restauración
antes de necesitarla**: un dump que nunca se restauró es una suposición, no
una copia de seguridad.

## Desplegar

```bash
docker build -t itadaki-api .
docker run -p 3000:3000 \
  -e NODE_ENV=production \
  -e AUTH_SECRET=<32+ caracteres> \
  -e DATABASE_URL=<conexión del rol de la app> \
  -e CORS_ORIGINS=https://pedi.tudominio.com,https://cocina.tudominio.com \
  -e IMAGE_BASE_URL=https://api.tudominio.com/api/images \
  -e RESEND_API_KEY=<clave> -e MAIL_FROM='Itadaki <hola@tudominio.com>' \
  -e S3_ENDPOINT=<...> -e S3_BUCKET=<...> \
  -e S3_ACCESS_KEY_ID=<...> -e S3_SECRET_ACCESS_KEY=<...> \
  itadaki-api
```

Con `NODE_ENV=production` la API se niega a arrancar sin `AUTH_SECRET`, sin
proveedor de correo o con Postgres caído, y avisa si las fotos quedan en disco
local. Las migraciones se aplican con `npm run db:seed` apuntando a
`DATABASE_ADMIN_URL`.

Las cuatro apps del navegador son estáticas: `npx ng build <app>` y servir
`dist/<app>/browser` desde donde quieras, completando el
`<meta name="itadaki-api">` de cada `index.html` con la URL de la API.

## Pendiente antes de producción

- No hay integración de cobro ni facturación ARCA. Decisión tomada: el
  restaurante cobra con su propio sistema.
