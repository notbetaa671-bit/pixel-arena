# PIXEL ARENA — beta 0.1

PIXEL ARENA es una arena multijugador 2D con estética pixel/cyberpunk. La beta está dividida en dos piezas:

- `client/`: cliente estático con Phaser 3, preparado para GitHub Pages.
- `server/`: servidor Node.js + Socket.IO con salas de hasta 20 jugadores y persistencia SQLite.

Incluye movimiento 360°, combate con apuntado por ángulo, respawn de 5 segundos, monedas, tienda de skins desbloqueables, ranking en tiempo real por sala, chat y estadísticas persistentes por nombre de jugador.

## Requisitos

- Node.js 20 o superior recomendado.
- npm 10 o superior.
- Un navegador moderno.

## Ejecutar en local

Desde la raíz del repositorio:

```bash
cd server
npm install
npm run dev
```

En otra terminal, sirve `client/` como archivos estáticos. Por ejemplo:

```bash
npx serve client -l 4173
```

Abre `http://localhost:4173`. La configuración inicial del cliente apunta a `http://localhost:3000`.

También puedes abrir `client/index.html` directamente para una vista visual, pero el navegador puede bloquear la conexión Socket.IO desde `file://`; para jugar usa un servidor estático.

## Configuración del servidor

Copia las variables de ejemplo:

```bash
cd server
cp .env.example .env
```

Variables disponibles:

| Variable | Por defecto | Uso |
| --- | --- | --- |
| `PORT` | `3000` | Puerto HTTP y Socket.IO |
| `CLIENT_ORIGIN` | `*` | Origen permitido para CORS; en producción usa la URL exacta de GitHub Pages |
| `DATABASE_PATH` | `data/pixel-arena.sqlite` | Ubicación del archivo SQLite |
| `ROOM_MAX_PLAYERS` | `20` | Límite de jugadores por sala |

La base de datos se crea automáticamente al iniciar. El identificador de perfil se deriva del nombre de jugador de esta beta, por lo que no hay autenticación: no uses datos sensibles ni nombres que quieras reservar.

## Despliegue del servidor

Puedes desplegar `server/` en Render, Railway, Fly.io, una VPS u otro proveedor Node.js.

Configuración genérica:

- Root directory: `server`
- Build command: `npm install`
- Start command: `npm start`
- Node: 20+
- `CLIENT_ORIGIN`: la URL HTTPS de GitHub Pages, por ejemplo `https://tu-usuario.github.io`
- Añade un disco persistente y apunta `DATABASE_PATH` a ese disco si el proveedor tiene filesystem efímero.

El endpoint `GET /health` responde con el estado del servidor. El endpoint `GET /api/rooms` devuelve el número de jugadores por sala.

## Despliegue del cliente en GitHub Pages

1. Edita `client/config.js` y cambia `serverUrl` por la URL HTTPS pública de tu servidor.
2. En GitHub, abre **Settings → Pages**.
3. Selecciona **Deploy from a branch**, elige `main` y la carpeta `/client` si tu configuración de Pages lo permite.
4. Si tu configuración solo permite la raíz, copia el contenido de `client/` a una rama o workflow de publicación.

El cliente carga Phaser y Socket.IO desde CDN. Por eso no necesita un build de frontend. GitHub Pages debe usar HTTPS y el servidor también debe exponerse por HTTPS para evitar contenido mixto.

## Pruebas locales

```bash
cd server
npm test
node --check src/index.js
```

`npm test` cubre las funciones deterministas de movimiento, ángulos, distancias y selección de spawn. La prueba multijugador completa requiere instalar dependencias y levantar el servidor.

## Controles

- `WASD` o flechas: movimiento 360°.
- Ratón: apuntar.
- Click izquierdo o `Espacio`: disparar.
- `Enter` en el campo de chat: enviar mensaje.

## Alcance de beta 0.1

La autoridad de movimiento, daño, cooldowns, monedas y compras está en el servidor. El cliente solo dibuja el estado recibido. El ranking se calcula por sala activa; las kills, muertes, monedas y skins compradas quedan persistidas por perfil en SQLite. No se incluye autenticación, matchmaking avanzado, anti-cheat completo, matchmaking regional ni escalado horizontal con Redis en esta beta.

