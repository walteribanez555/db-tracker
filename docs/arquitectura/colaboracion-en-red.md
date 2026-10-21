# Colaboración en red: una app de escritorio como servidor

[← Volver al README](../../README.md) · Estado: **fases 1 a 3 implementadas** (ver el [tutorial](../tutoriales/13-colaboracion.md)); fase 4 (fuera de la red local) pendiente.

## Objetivo

Una instancia de escritorio pasa a ser **anfitriona**: comparte su proyecto en la red local y otras instancias, de escritorio o web, **se unen** a la misma sesión. Todos ven y editan el mismo proyecto en tiempo real: diagrama, triggers, versiones y flujos, más quién está conectado y qué está tocando.

## Punto de partida

La arquitectura actual ya favorece este modo:

- **Una sola app HTTP (`server/app.ts`)** sirve la API y el frontend compilado. Electron ya la levanta dentro del proceso principal.
- **Hoy escucha en `127.0.0.1`**, con puerto aleatorio en producción. Para ser anfitrión basta con escuchar también en la red local (`0.0.0.0`) solo mientras se comparte.
- **Todo el estado del proyecto vive en el cliente**, en un store zustand persistido en `localStorage`. No hay servidor de datos que sincronizar: hay que añadir una capa de sincronización.

## Propuesta

```
            Escritorio ANFITRIÓN (Electron)
  ┌────────────────────────────────────────────────┐
  │ Ventana DB Tracker  ──►  Hono en 0.0.0.0:PUERTO │
  │                          ├─ /            frontend (dist)
  │                          ├─ /api/...     db, github
  │                          └─ /sync/:sala  WebSocket (Yjs)
  │ Documento Yjs + copia en disco (userData)       │
  └──────────────▲───────────────────▲──────────────┘
                 │ WebSocket (LAN)   │
     Escritorio invitado          Navegador invitado
     (descubre por mDNS)          (abre http://IP:PUERTO/?sala=…)
```

### 1. Sincronización: CRDT con Yjs

**Recomendado:** representar el proyecto como un documento **Yjs** y sincronizarlo por WebSocket con `y-protocols` (sync + awareness).

| Opción | Ventajas | Inconvenientes |
|---|---|---|
| **Yjs (CRDT)** | Fusión automática sin conflictos; funciona sin conexión y se reconcilia al volver; awareness (presencia y cursores) incluido; sin servidor de base de datos | Hay que mapear el modelo a estructuras Yjs |
| Parches del servidor (el anfitrión decide, último en escribir gana) | Simple de razonar | Pierde ediciones concurrentes de la misma tabla, no tolera desconexiones, hay que escribir presencia y reconexión a mano |
| Sincronizar el JSON completo | Trivial | Conflictos constantes y tráfico alto con proyectos grandes |

**Cómo se mapea el modelo** (`src/types/schema.ts`):

- `Y.Map<proyecto>` contiene `ramas: Y.Map<id, Branch>`, `versiones: Y.Map<id, Version>` y `borradores: Y.Map<ramaId, Y.Map>`.
- El borrador de cada rama tiene `tablas: Y.Map<id, Y.Map>`, `columnas` (dentro de cada tabla, `Y.Array` de `Y.Map` para conservar el orden), `relaciones`, `vistas`, `triggers`, `funciones`, `notas` y `enums`, todos `Y.Map<id, Y.Map>`.
- El cuerpo de las funciones y el SQL de las vistas van en **`Y.Text`**: dos personas pueden escribir a la vez en el mismo SQL, y Monaco se enlaza con `y-monaco` (cursores remotos dentro del editor).
- Las **versiones son inmutables**: se guardan como JSON congelado y solo se añaden, así que nunca hay conflicto.

**Puente con zustand:** un módulo `src/collab/binding.ts` traduce las acciones del store (`mutate`, `commit`, `createBranch`…) en transacciones Yjs, y los cambios remotos (`observeDeep`) al store. El resto de la app no cambia: sigue leyendo `useProjectStore`. Sin sesión activa, el binding no se monta y todo funciona como hoy.

**Borrador compartido o por persona:** por defecto, un **borrador compartido por rama** (estilo Figma). Para trabajar aislado basta con crear una rama. «Confirmar versión» lo puede hacer cualquiera, y el autor queda registrado.

### 2. Transporte y servidor

- **WebSocket** en la misma app Hono con `@hono/node-ws`, ruta `/sync/:sala`. El anfitrión mantiene el `Y.Doc` en memoria y lo guarda en disco (`app.getPath('userData')/salas/<id>.ydoc`) cada pocos segundos y al cerrar.
- **Escucha en la red solo al compartir:** al pulsar «Compartir en la red», se abre un segundo listener en `0.0.0.0:<puerto fijo o elegido>`; la ventana local sigue en `127.0.0.1`. Al dejar de compartir, ese listener se cierra.
- **Invitados web:** el anfitrión sirve también el frontend, así que el navegador solo necesita abrir `http://192.168.x.x:PUERTO/?sala=ABC123`. No hay que instalar nada.

### 3. Descubrimiento y unión

- **Escritorio → escritorio:** anuncio **mDNS/Bonjour** (`bonjour-service`, tipo `_dbtracker._tcp`) con el nombre del proyecto y del anfitrión. «Unirse» lista las sesiones de la red.
- **Web y móvil:** no pueden usar mDNS, así que se unen con **enlace o QR** (generado con `qrcode` en el anfitrión) o escribiendo `IP:puerto` y el código.
- **Código de sala:** 6 caracteres legibles (sin 0/O ni 1/I) más un secreto largo dentro del enlace. El código sirve para dictarlo; el enlace o QR lleva el secreto.

### 4. Seguridad

| Riesgo | Medida |
|---|---|
| Cualquiera en la red se une | Secreto por sesión obligatorio en el WebSocket (cabecera o primer mensaje); el anfitrión **aprueba** a cada invitado nuevo (opcional: «aprobar automáticamente») y puede expulsarlo |
| Tráfico sin cifrar en la red local | Aviso en la UI. Fase 2: TLS con certificado autofirmado y huella mostrada en el QR, o túnel opcional (Tailscale, Cloudflare Tunnel) para fuera de la red |
| La API `/api/db` del anfitrión queda accesible para los invitados | En modo red, **solo `/sync` y el frontend son públicos**. `/api/db` y `/api/github` responden únicamente a `127.0.0.1`. Cada invitado de escritorio usa su propia API local; los invitados web no pueden ejecutar contra bases remotas desde el anfitrión, salvo que este lo permita explícitamente por conexión |
| Contraseñas de bases de datos y token de GitHub | No viajan por la sesión: no forman parte del documento Yjs. Las conexiones remotas se comparten sin contraseña |
| Permisos | Roles por invitado: **editor** o **solo lectura** (el servidor descarta las actualizaciones de los lectores) |

### 5. Presencia (awareness)

- Avatar, nombre y color de cada participante en la cabecera.
- En el lienzo, cursores remotos, selección («Ana está editando `pedidos`») y un borde con el color de quien edita.
- En Monaco, cursores y selecciones remotas con `y-monaco`.
- En el dock de operaciones, una pestaña «Actividad» con las operaciones de los demás (crear rama, confirmar versión, aplicar normalización).

### 6. Desconexión y continuidad

- Cada cliente guarda una copia con `y-indexeddb`: si el anfitrión se cae, se sigue editando en local y todo se fusiona al reconectar.
- Si el anfitrión cierra la sesión, los invitados pueden **«Quedarse con una copia»**, que convierte el documento en su proyecto local, o esperar.
- Un invitado de escritorio puede **convertirse en anfitrión** de la copia (fase 3).

### 7. Interfaz

- **Escritorio, anfitrión:** el botón «Compartir» en la cabecera abre un diálogo con interruptor «Compartir en la red», dirección y código, QR, participantes (aprobar, rol, expulsar) y «Dejar de compartir».
- **Escritorio, invitado:** «Unirse a una sesión», con las sesiones encontradas en la red y la opción de escribir dirección y código.
- **Web y móvil:** al abrir el enlace aparece la pantalla «Unirse»: nombre visible, código si falta y la espera de aprobación.
- **Indicador de sesión** en la cabecera, siempre visible: «En sesión · 3 personas · anfitrión: Walter», con el estado de conexión.

## Plan por fases

| Fase | Alcance | Resultado |
|---|---|---|
| **1. Sincronización base** | Documento Yjs y binding con zustand; WebSocket `/sync` en Hono; anfitrión con listener LAN; unión por enlace o código; persistencia del anfitrión | Dos personas editan el mismo diagrama en tiempo real (escritorio y web) |
| **2. Presencia y seguridad** | Awareness (avatares, cursores, selección); aprobación de invitados y roles; API local solo en loopback; QR | Sesiones seguras y con contexto social |
| **3. Descubrimiento y robustez** | mDNS entre escritorios; `y-indexeddb` offline; «Quedarse con una copia»; `y-monaco` en el SQL | Uso cómodo en oficina y tolerancia a cortes |
| **4. Fuera de la red local** | TLS autofirmado o túnel opcional | Colaborar entre redes distintas |

## Paquetes a añadir

`yjs`, `y-protocols`, `y-indexeddb`, `y-monaco`, `@hono/node-ws`, `bonjour-service` (solo Electron) y `qrcode`. Para el servidor de sincronización no hace falta `y-websocket`: los mensajes de `y-protocols` se reenvían directamente desde `@hono/node-ws`, lo que evita un segundo servidor.

## Decisiones abiertas

1. **Borrador compartido** por rama (recomendado) o un borrador por persona con fusión al confirmar.
2. **Invitados web**: solo edición del modelo (recomendado) o también ejecución contra bases remotas a través del anfitrión.
3. **Alcance de red**: solo LAN en la fase 1 (recomendado) o un túnel desde el principio.
