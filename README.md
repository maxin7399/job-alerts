# job-alerts

Avisos a Telegram de ofertas de desarrollo (junior/semi/senior/fullstack, ≤ 3 años de experiencia) de **Computrabajo Colombia** y **LinkedIn**, publicadas hace ≤ 20 min. Corre en GitHub Actions cada 15 min.

## Cómo funciona
Cada ejecución: lee el estado (rama `state`) → procesa `/on`, `/off`, `/status` → consulta las fuentes → filtra (ventana, no vistas, rol/tecnología, años de experiencia) → envía un mensaje por oferta al canal → guarda el estado. La primera ejecución marca lo existente como visto sin avisar. Los comandos se responden en la siguiente ejecución (hasta ~15 min).

LinkedIn usa tu cookie `li_at`. Ante captcha/verificación/HTTP 429/999/authwall **se desactiva solo, avisa por Telegram y no reintenta** hasta que envíes `/on`.

Se configura todo en [`config.json`](config.json): búsquedas, palabras de rol/tecnología, `windowMinutes`, `maxExperienceYears`.

## Pasos para ti
1. **Bot:** habla con @BotFather → `/newbot` → guarda el token.
2. **Canal:** crea un canal de Telegram, añade el bot como **administrador** (permiso de publicar) e invita a tu amigo.
3. **IDs:** `TELEGRAM_CHAT_ID` es el id del canal (`-100…`; o `@nombre_publico`). `ALLOWED_CHAT_IDS` son los ids (separados por coma) de quienes pueden usar los comandos: tu id y el de tu amigo (puedes obtenerlos con @userinfobot). Escribe los comandos al bot en privado o en el canal.
4. **Repo público** (minutos de Actions ilimitados) — cuando quieras:
   ```bash
   gh repo create job-alerts --public --source . --push
   ```
5. **Secrets** (los escribes tú en tu terminal; `gh` te los pide sin mostrarlos):
   ```bash
   gh secret set TELEGRAM_BOT_TOKEN
   gh secret set TELEGRAM_CHAT_ID
   gh secret set ALLOWED_CHAT_IDS
   gh secret set LINKEDIN_LI_AT
   ```
   `LINKEDIN_LI_AT` es el valor de la cookie `li_at` de linkedin.com (DevTools → Application → Cookies). Si no la defines, LinkedIn corre en modo público.
6. **Probar:** pestaña Actions → *check* → *Run workflow*. Luego envía `/status`, `/off`, `/on`.
7. Revisa 24 h: sin duplicados ni verificaciones de LinkedIn.

## Desarrollo
```bash
npm install
npm test                    # pruebas (Vitest, HTML de ejemplo en test/fixtures)
npm run dev -- --dry-run    # consulta real y muestra lo que avisaría, sin enviar ni guardar
```
Variables en [`.env.example`](.env.example) (solo nombres; nunca subas valores).

## Límites
- LinkedIn desde IPs de datacenter es arriesgado: puede pedir verificación o restringir la cuenta. Alternativa: quitar `LINKEDIN_LI_AT` (modo público) o `"linkedin": {"enabled": false}`.
- LinkedIn solo entrega el día de publicación; se acota con el filtro de tiempo de la búsqueda, por eso muestra "hace 0 min".
- Los cron de Actions pueden retrasarse; si se pierden ofertas, sube `windowMinutes` a 30.
- Si cambia el HTML de una fuente, el bot avisa tras 3 fallos seguidos.
