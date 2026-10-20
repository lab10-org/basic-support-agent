// Un turno completo de la topología:
// 1 persona → 2 triage → 3 Olivia → 4 Ticketizer → 5 caso de soporte → 6 Slack si hay derivación.
import { RequestContext } from '@mastra/core/request-context'
import { addMessage, getActiveCase, listMessages, type Message } from './db.ts'
import { mastra } from './mastra/index.ts'
import { ticketizerSchema } from './mastra/agents/ticketizer.ts'
import { triageSchema, type Triage } from './mastra/agents/triage.ts'
import { applyTurn } from './ticketGate.ts'

const LABEL = { persona: 'Persona', olivia: 'Olivia', soporte: 'Equipo de soporte', sistema: 'Sistema' } as const

const TRACE = '__trace__'

function transcript(messages: Message[]) {
  return messages
    .filter((m) => m.content !== TRACE)
    .map((m) => `${LABEL[m.role]}${m.author ? ` (${m.author})` : ''}: ${m.content}`).join('\n')
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
  const triageRes = await mastra.getAgentById('triage').generate(`Hilo:\n${transcript(history)}`, {
    structuredOutput: { schema: triageSchema },
  })
  const triage: Triage = { ...triageRes.object, critica: triageRes.object.reglas.length > 0 }

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

  // 4. Termina el turno: el Ticketizer lee el hilo y propone una acción.
  const caso = await getActiveCase(threadId)
  const ticketRes = await mastra.getAgentById('ticketizer').generate(
    [
      `Caso activo: ${caso ? `#${caso.id} (${caso.status}) — ${caso.resumen}` : 'ninguno'}`,
      `Tools que llamó Olivia en este turno: ${toolsCalled.join(', ') || 'ninguna'}`,
      `Hilo:\n${transcript(await listMessages(threadId))}`,
    ].join('\n\n'),
    { structuredOutput: { schema: ticketizerSchema } },
  )

  // 5 y 6. El código aplica la acción, decide el cierre y publica en Slack si Olivia derivó.
  const decision = await applyTurn({
    threadId,
    persona,
    critica: triage.critica,
    proposal: ticketRes.object,
    toolsCalled,
    derivacion,
  })

  const trace = { triage, olivia: { toolsCalled, derivacion: derivacion ?? null }, ticketizer: ticketRes.object, decision }
  await addMessage(threadId, 'sistema', TRACE, null, trace)
  return trace
}
