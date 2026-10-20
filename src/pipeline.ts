// Un turno completo de la topología:
// 1 persona → 2 triage (Jev) → 3 Olivia → 4 Ticketizer (Jev + LLM de texto) → 5 caso de soporte → 6 Slack.
// Jev decide; los LLM solo responden (Olivia) o redactan (título y resumen del caso).
import { RequestContext } from '@mastra/core/request-context'
import { addMessage, getActiveCase, listMessages, type Message } from './db.ts'
import { mastra } from './mastra/index.ts'
import { applyTurn } from './ticketGate.ts'
import { runTicketizer, writeCaseText } from './ticketizer.ts'
import { runTriage } from './triage.ts'

const LABEL = { persona: 'Persona', olivia: 'Olivia', soporte: 'Equipo de soporte', sistema: 'Sistema' } as const

const TRACE = '__trace__'

// Jev pasa a modo de contexto largo (más lento y menos preciso) desde ~32 KB de texto.
const MAX_HILO = 24_000

function transcript(messages: Message[]) {
  const lineas = messages
    .filter((m) => m.content !== TRACE)
    .map((m) => `${LABEL[m.role]}${m.author ? ` (${m.author})` : ''}: ${m.content}`)
  // Se conservan los mensajes más recientes que quepan.
  let total = 0
  let desde = lineas.length
  while (desde > 0 && total + lineas[desde - 1].length + 1 <= MAX_HILO) total += lineas[--desde].length + 1
  return lineas.slice(Math.min(desde, lineas.length - 1)).join('\n')
}

// Todas las tools que llamó el turno, en todos sus pasos.
function toolNames(result: any): string[] {
  const calls = result.steps?.length ? result.steps.flatMap((s: any) => s.toolCalls ?? []) : (result.toolCalls ?? [])
  return [...new Set<string>(calls.map((tc: any) => String(tc.payload?.toolName ?? tc.toolName)))]
}

export async function runTurn(threadId: string, persona: string, text: string) {
  // 1. La persona escribe en su hilo.
  await addMessage(threadId, 'persona', text, persona)
  const history = await listMessages(threadId)

  // 2. Triage: qué reglas de criticidad cumple. Con una basta.
  const triage = await runTriage(transcript(history))

  // 3. Olivia responde con sus tools. La derivación solo existe si el triage dijo crítica.
  const requestContext = new RequestContext()
  requestContext.set('threadId', threadId)
  requestContext.set('persona', persona)
  requestContext.set('critica', triage.critica)
  requestContext.set('reglas', triage.reglas.join(', '))

  const oliviaRes = await mastra.getAgentById('olivia').generate(
    history
      .filter((m) => m.role !== 'sistema')
      .map((m) =>
        m.role === 'persona'
          ? { role: 'user' as const, content: m.content }
          : { role: 'assistant' as const, content: m.role === 'soporte' ? `[Equipo de soporte, ${m.author}]: ${m.content}` : m.content },
      ),
    { requestContext, maxSteps: 5 },
  )
  const toolsCalled = toolNames(oliviaRes)
  const derivacion = requestContext.get('derivacion') as string | undefined
  await addMessage(threadId, 'olivia', oliviaRes.text, null, { triage, toolsCalled })

  // 4. Termina el turno: Jev lee el hilo y propone una acción sobre el caso.
  const caso = await getActiveCase(threadId)
  const hilo = transcript(await listMessages(threadId))
  const proposal = await runTicketizer({ caso, toolsCalled, hilo })

  // 5 y 6. El código aplica la acción, decide el cierre y publica en Slack si Olivia derivó.
  const decision = await applyTurn({
    threadId,
    persona,
    critica: triage.critica,
    proposal,
    toolsCalled,
    derivacion,
    escribir: () => writeCaseText({ caso, hilo }),
  })

  const trace = { triage, olivia: { toolsCalled, derivacion: derivacion ?? null }, ticketizer: proposal, decision }
  await addMessage(threadId, 'sistema', TRACE, null, trace)
  return trace
}
