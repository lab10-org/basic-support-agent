# Olivia · agente base (versión light)

Agente de soporte en TypeScript con [Mastra](https://mastra.ai), modelos vía [OpenRouter](https://openrouter.ai), SQLite local y una interfaz web.

```
persona → triage (Jev) → Olivia (tools) → Ticketizer (Jev) → caso de soporte (código) → equipo en Slack
```

1. **La persona** escribe en su hilo.
2. **Triage** ([Jev](https://openrouter.ai/docs/guides/community/jev.md), `src/triage.ts`): una pregunta
   sí/no (`noul`) por regla: cliente de pago, bug crítico, problema legal, problema de pagos. Una regla se
   marca desde `TRIAGE_UMBRAL` (0.7). Con una basta para que sea **crítica** → derivación habilitada.
3. **Olivia** (LLM, `src/mastra/agents/olivia.ts`): responde con sus tools (base de conocimiento, pagos,
   caso). Solo si es crítica tiene `derivar-a-soporte`.
4. **Ticketizer** (Jev, `src/ticketizer.ts`): dos `choice` en una llamada: la acción
   `none | open | update | resolve` y, para resolve, el `basis`: `user_confirmed | db_verified | team_stated`.
   Jev no escribe texto: si la acción abre o actualiza el caso, un LLM pequeño
   (`src/mastra/agents/ticketizer.ts`) redacta título y resumen.
5. **Caso de soporte** (`src/ticketGate.ts`): `resolveGate()` lee qué tools llamó el turno.
   `user_confirmed`, o `db_verified` con una lectura real → `resolved`. Si no → `awaiting_confirmation`;
   un turno nuevo clasificado `update` lo devuelve a `open`. Con la confianza de Jev: si es menor a
   `TICKET_CONFIANZA_MIN` (0.5) no se actúa (se actualiza el caso activo o no se hace nada), y un `resolve`
   con `update` por encima de 0.25 pide confirmación. (Sin cron ni recordatorios.)
6. **Equipo de soporte**: si Olivia derivó, el caso aparece en la pestaña *Slack · soporte* (y en un Slack
   real si defines `SLACK_WEBHOOK_URL`). El equipo puede tomar, responder y marcar resuelto
   (eso es `team_stated`, así que queda esperando confirmación de la persona).

## Correr

```bash
cp .env.example .env   # pon tu OPENROUTER_API_KEY
npm install
npm run dev            # http://localhost:3000
```

Todo se guarda en `data/olivia.db`. Las personas `ana` y `carlos` tienen pagos de ejemplo
(carlos tiene un cobro duplicado; ana ya tiene el reembolso) para probar `db_verified`.

## Versiones

Cada versión queda marcada con un tag de git, así puedes volver a ella cuando quieras.

| Versión | Qué incluye |
|---|---|
| [`v0.1.0`](https://github.com/lab10-org/basic-support-agent/tree/v0.1.0) | Versión light: triage con 4 reglas, Olivia con derivación, Ticketizer + `resolveGate()`, Slack simulado, OpenRouter. |
| [`v0.2.0`](https://github.com/lab10-org/basic-support-agent/tree/v0.2.0) | Triage y Ticketizer con [Jev](https://openrouter.ai/docs/guides/community/jev.md): decisiones con probabilidades, un LLM pequeño solo para título y resumen, compuerta que usa la confianza y panel con las decisiones de Jev en *Último turno*. |

Para usar una versión concreta:

```bash
git clone --branch v0.1.0 https://github.com/lab10-org/basic-support-agent.git
```

O, si ya clonaste el repo:

```bash
git checkout v0.1.0
```
