import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

// Olivia solo tiene esta tool cuando el triage marcó la petición como crítica.
// No toca la base: deja la intención en el requestContext y el código la aplica al cerrar el turno.
export const handoffTool = createTool({
  id: 'derivar-a-soporte',
  description: 'Pasa el caso al equipo humano de soporte en Slack. Úsala cuando la persona necesite que un humano actúe.',
  inputSchema: z.object({
    motivo: z.string().describe('Qué tiene que hacer el equipo, en una frase'),
  }),
  execute: async ({ motivo }, context) => {
    context.requestContext?.set('derivacion', motivo)
    return { ok: true, mensaje: 'El equipo de soporte recibirá el caso en Slack.' }
  },
})
