# Comparador de remesas COP → VES (vs Buda)

Compara la tasa de envío Colombia→Venezuela de Vita Wallet, Retorna, Global66, Western Union y
Cambios App contra la tasa de Buda. Sin dependencias (solo Node). Fondo claro.

## Buda automático (API Cross-Border Payments)
La tasa de Buda se consume en vivo, firmada, desde su API privada. Configura en Railway → Variables:
- BUDA_API_KEY        (tu API key de Buda)
- BUDA_API_SECRET     (tu API secret de Buda)
- BUDA_CBP_QUOTE_BODY (JSON EXACTO del quote COP→VES con su recipient_data; lo da tu equipo Buda)
- BUDA_CBP_QUOTE_PATH (opcional; por defecto /api/v2/cross_border_payments/quotations)
- BUDA_API_BASE       (opcional; por defecto https://www.buda.com)

Autenticación implementada según doc Buda: HMAC-SHA384 hex, headers X-SBTC-APIKEY / X-SBTC-NONCE /
X-SBTC-SIGNATURE, string firmado "POST {path} {body_base64} {nonce}", nonce en microsegundos.
La tasa efectiva se calcula como amount_in_destination_currency / amount_in_source_currency (VES por COP).

## Competidores (Vita, Retorna, Global66, WU, Cambios)
No tienen feed público. Dos vías para que salgan automáticos:
- VES_WEB_JSON: arreglo de conectores al conversor web de cada app (cuando captures su endpoint):
  [{"provider":"global66","url":"...","method":"GET","query":{...},"ratePath":"data.rate"}]
  ratePath = tasa VES por 1 COP (o usa vesPath+copPath y se calcula).
- Captura manual (fallback), desde el formulario de la página, mientras no haya endpoint.

## Referencia MontosVE (opcional)
- MONTOSVE_API_KEY : ancla del bolívar (BCV / Binance / Bybit). No son las apps; es referencia.

## Archivos (sueltos, sin carpetas) y despliegue
server.js, package.json, index.html, ves-rates.json. Sube a un repo NUEVO (no lo mezcles con el de
stablecoins: nombres iguales, contenido distinto). Railway → Deploy from GitHub → genera dominio en
Public Networking. La app usa process.env.PORT.

## Nota de rigor (VES)
El bolívar tiene varias referencias (BCV oficial vs paralelo) y alta volatilidad intradía.
