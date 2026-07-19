# MediaNest TV

Proyecto base para una app tipo reproductor de películas, series y música orientada a la LG 32LM570BPUA de la escuela.

La app está hecha como web app nativa de webOS: HTML, CSS y JavaScript sin frameworks pesados, sin módulos modernos y con canvas fijo de `1280x720`, porque esa es la resolución práctica de app recomendada para una TV HD/FHD en webOS. La meta es que se pueda probar localmente muchas veces sin ir a la escuela, y que al final se empaquete como `.ipk` para instalarla en la LG.

## Respuesta corta: LG y Samsung no funcionan igual

Tu LG 32LM570BPUA usa webOS. Tu Samsung UN70DU7000FXZX usa Tizen. Ambas aceptan apps web para TV, pero no comparten el mismo sistema de instalación:

- LG webOS: empaqueta `.ipk`, usa `appinfo.json`, Developer Mode app y comandos `ares-*`.
- Samsung Tizen: empaqueta `.wgt`, usa `config.xml`, requiere certificados Samsung/Tizen y Tizen Studio.
- Navegación con control remoto: se parece bastante; flechas, OK y Back sí pueden programarse de forma muy similar.
- APIs nativas, publicación, instalación y depuración: son diferentes.

Por eso, la Samsung puede ayudarte a ver si la interfaz se siente bien en una TV grande, pero no garantiza que la app se instale correctamente en la LG.

## Mejor flujo de trabajo

1. Desarrollar aquí en la laptop como sitio local.
2. Probar con teclado simulando control remoto:
   - Flechas: mover foco.
   - Enter: OK.
   - Escape: Back en navegador.
3. Probar en webOS Simulator/Emulator cuando quieras validar cosas de LG sin ir a la escuela.
4. Al final, empaquetar `.ipk`.
5. Instalar en la LG de la escuela con Developer Mode.

## Comandos locales

Instalar dependencias:

```bash
npm install
```

Ejecutar en navegador:

```bash
npm run dev
```

Abrir:

```text
http://localhost:8080
```

## Comandos para LG webOS

Instalar webOS CLI:

```bash
npm install -g @webos-tools/cli
```

Agregar la TV de la escuela cuando estés en la misma red:

```bash
ares-setup-device
```

Valores típicos para Developer Mode en LG:

- Host/IP: la IP que muestra la TV.
- Port: `9922`.
- User: `prisoner`.
- Password: vacío.

Pedir la llave de la TV:

```bash
ares-novacom --device school-lg-tv --getkey
```

Empaquetar:

```bash
npm run package:webos
```

Instalar:

```bash
npm run install:webos
```

Lanzar:

```bash
npm run launch:webos
```

## Nota importante sobre Developer Mode

La app instalada por Developer Mode no queda como instalación final permanente. LG indica que Developer Mode puede desactivarse por vencimiento de sesión o reinicios sin red, y al desactivarse se eliminan las apps instaladas en Developer Mode. Para entrega escolar normalmente basta; para distribución real se requiere el proceso formal de LG.

## Estructura

```text
medianest/
  app/
    appinfo.json
    index.html
    assets/
    scripts/
    styles/
  package.json
```

## Códigos de control remoto contemplados

- Flecha izquierda: `37`
- Flecha arriba: `38`
- Flecha derecha: `39`
- Flecha abajo: `40`
- OK / Enter: `13`
- Back LG: `461`
- Play: `415`
- Pause: `19`
- Stop: `413`
- Rewind: `412`
- Fast forward: `417`

## Reglas usadas para compatibilidad LG

- JavaScript estilo ES5, sin `import`, sin módulos, sin `async/await`.
- CSS simple, sin animaciones 3D, blur pesado ni efectos caros.
- UI fija 16:9 a `1280x720`.
- Foco visible grande para navegación con control remoto.
- Sin dependencias gigantes como React, Vue, jQuery completo o Firebase SDK.
