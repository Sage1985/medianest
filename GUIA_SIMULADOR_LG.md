# Guia rapida: probar MediaNest en simulador LG webOS

Este proyecto ya quedo preparado en esta laptop para abrirse en el webOS TV Simulator.

## Lo que ya esta instalado

- VS Code extension: `webOS Studio` (`webOSSDK.webosstudio`).
- webOS CLI local del proyecto: `@webos-tools/cli` 3.2.5.
- webOS TV 6.0 Simulator para Windows:

```text
C:\LG_WEBOS_STUDIO_SDK\TV\Simulator\webOS_TV_6.0_Simulator_1.4.1
```

## Ejecutar el simulador

Desde PowerShell:

```powershell
cd "C:\Users\Emmanuel Valencia\Downloads\medianest"
npm run sim:webos6
```

Ese comando abre MediaNest directamente dentro del simulador LG.

Si quieres usar el comando completo:

```powershell
npx ares-launch -s 6.0 -sp "C:\LG_WEBOS_STUDIO_SDK\TV\Simulator\webOS_TV_6.0_Simulator_1.4.1" app
```

## Ejecutarlo desde VS Code

1. Abre VS Code.
2. Abre esta carpeta:

```text
C:\Users\Emmanuel Valencia\Downloads\medianest
```

3. Si VS Code pregunta por el SDK Path, selecciona:

```text
C:\LG_WEBOS_STUDIO_SDK
```

4. En la barra lateral de webOS Studio, revisa `Simulator Manager`.
5. Tambien puedes abrir la paleta con `Ctrl + Shift + P` y ejecutar:

```text
webOS TV: Run on Simulator
```

Si te pregunta por version, elige `webOS TV 6.0 Simulator`.

## Empaquetar para la LG real

El simulador sirve para diseno, navegacion y errores basicos. Para instalar en la TV LG real de la escuela se genera un `.ipk`:

```powershell
npm run package:webos
```

Archivo esperado:

```text
com.emman.medianest_0.1.0_all.ipk
```

## Nota importante

La LG 32LM570BPUA de la escuela es una TV 2019/webOS 4.x, pero LG ya marca los emuladores viejos como deprecados. El Simulator 6.0 es la opcion practica para trabajar diario en esta laptop. Antes de entregar, conviene hacer una prueba final en la LG real porque ahi se confirman codecs, rendimiento y Developer Mode.
