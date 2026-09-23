# Comparador de remesas COP → VES (vs Buda)

Compara la tasa de envío Colombia→Venezuela de Vita Wallet, Retorna, Global66, Western Union y
Cambios App contra TU tasa de Buda. Sin dependencias (solo Node). Fondo claro.

## Archivos (sueltos, sin carpetas)
- server.js, package.json, index.html, ves-rates.json

## Subir a GitHub y desplegar
Igual que el otro: sube los archivos sueltos, luego Railway → Deploy from GitHub → genera dominio
en **Public Networking** (puerto que asigne Railway; la app usa process.env.PORT).

## Cómo se usa
1. Abre la app. En el formulario, registra primero **Buda** (tu tasa): cuántos COP envías y cuántos
   VES llegan → calcula la tasa efectiva (VES por COP).
2. Registra cada competidor igual. La tabla ordena por quién da más VES y marca "¿Buda mejor?".

## Variables opcionales (Railway → Variables)
- MONTOSVE_API_KEY : referencia del bolívar (BCV / Binance / Bybit) vía montosve.com. Ancla, no
  las apps. Confirmar cabecera de auth en la primera corrida.
- VES_WEB_JSON : arreglo de conectores web (cuando captures el endpoint del conversor de cada app):
  [{"provider":"global66","url":"...","method":"GET","query":{...},"ratePath":"data.rate"}]
  ratePath debe apuntar a la tasa VES por 1 COP (o usa vesPath+copPath y se calcula).

## Nota de rigor (VES)
El bolívar tiene varias referencias (BCV oficial vs paralelo) y alta volatilidad intradía. Las apps
fijan su tasa sobre una de esas + spread. MontosVE da el ancla; las tasas de las apps se capturan
por su conversor (web) o a mano.
