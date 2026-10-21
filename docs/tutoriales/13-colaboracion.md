# 13. Colaborar en la red local

[← Volver al README](../../README.md) · Diseño técnico: [colaboración en red](../arquitectura/colaboracion-en-red.md)

Un equipo con DB Tracker hace de **anfitrión**: comparte su proyecto en la red local y otros se unen desde el **escritorio**, el **navegador** o el **móvil**. Todos editan el mismo proyecto en tiempo real, con cursores y selección de cada persona.

## Compartir (anfitrión)

1. Pulsa **Compartir** en la cabecera.
2. Activa **Compartir en la red local**. Verás:
   - un **código** de 6 caracteres para dictarlo;
   - la **dirección** (`IP:puerto`, por defecto 47123);
   - el **enlace** y su **QR**, para abrirlo en el navegador o el móvil.
3. Opciones, que se pueden cambiar sin cortar la sesión:
   - **Aprobar a cada invitado**: tú decides quién entra. Con esta opción basta el código para pedir entrada; sin ella hace falta el enlace o el QR.
   - **Las bases de datos remotas y GitHub siguen siendo solo de este equipo**: los invitados no pueden usar tus conexiones ni tu token. Las contraseñas y el token nunca viajan por la sesión.
4. En **Participantes** acepta o rechaza solicitudes, cambia el rol (Editor / Solo lectura) o expulsa a alguien.
5. Para terminar, usa **Dejar de compartir**. Cada invitado elige si se queda con una copia del proyecto o vuelve al suyo.

> La conexión en la red local no está cifrada: compártela solo en redes de confianza.

## Unirse

- **Navegador o móvil**: escanea el QR o abre el enlace. Escribe tu nombre y pulsa **Unirse**. Si solo tienes el código, la página `http://IP:puerto/unirse` te lo pide.
- **Escritorio**: **Unirse** en la cabecera muestra las sesiones encontradas en tu red. También puedes escribir la dirección y el código, o pegar el enlace completo.

Si el anfitrión aprueba a cada invitado, verás «Esperando a que … te acepte».

## Mientras colaboras

- **Cabecera:** los avatares y «En sesión · N personas», con un punto de estado (verde conectado, ámbar reconectando o esperando, rojo desconectado).
- **Lienzos:** en el diagrama y en triggers ves el cursor, la selección y lo que edita cada persona.
- **SQL compartido:** el de vistas y funciones se edita a la vez, con los cursores de los demás dentro del editor.
- **Ramas:** el borrador es **compartido por rama**. Para trabajar aislado, crea tu propio flujo.
- **Deshacer** (<kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>Z</kbd>) solo deshace **tus** cambios, nunca los de otros.
- **Sin conexión:** si se corta, sigues editando y todo se fusiona al reconectar.
- **Actividad:** la pestaña **Actividad** del dock muestra las entradas, salidas y cambios de rol.

## Probarlo en un solo equipo

1. `npm run dev` y abre http://localhost:5173 → **Compartir**.
2. En otra pestaña abre `http://<tu IP>:47123/unirse?sala=<código>`. Al ser otro origen, actúa como otro equipo.
3. Acepta la solicitud en la primera pestaña y edita en cualquiera de las dos.

[← Volver al README](../../README.md)
