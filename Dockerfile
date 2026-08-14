# API de Itadaki.
#
# Multi-stage: la primera etapa compila con todas las dependencias, la segunda
# se queda sólo con las de runtime. Ambas parten de la misma imagen base
# porque sharp trae binarios nativos — compilarlos contra una libc y correrlos
# contra otra falla recién al procesar la primera foto.

# ---------- build ----------
FROM node:22-bookworm-slim AS build

WORKDIR /app

# Las dependencias cambian mucho menos que el código: copiarlas primero deja
# esta capa en caché entre despliegues.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.base.json angular.json ./
COPY libs ./libs
COPY apps ./apps

RUN npm run build:api

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
# Sin dependencias de desarrollo: la imagen queda con lo que la API usa y nada
# más. El CI verifica que este árbol alcance para arrancar.
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist/api ./dist/api

# Las migraciones se leen desde el fuente (tsc no copia .sql) y el seed las
# busca relativas al directorio de trabajo.
COPY libs/shared/persistence/src/lib/migrations ./libs/shared/persistence/src/lib/migrations

# Donde caen las fotos cuando no hay bucket configurado.
#
# Creado y cedido a `node` antes de bajar de privilegios: /app pertenece a
# root, así que el proceso no podría crear la carpeta él mismo — y eso falla
# recién al subir la primera foto, no al arrancar. Un volumen montado acá
# sobrevive al redespliegue; un bucket es mejor.
ENV IMAGE_ROOT=/app/.image-store
RUN mkdir -p /app/.image-store && chown -R node:node /app/.image-store

# Nunca root: si algo logra ejecutar código, que no sea con todos los permisos.
USER node

VOLUME ["/app/.image-store"]

EXPOSE 3000

# El chequeo pega a /health, que responde 503 cuando Postgres no contesta —
# un contenedor que no puede tomar un pedido no debe figurar como sano.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/api/apps/api/src/main.js"]
