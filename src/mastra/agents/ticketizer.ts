import { Agent } from '@mastra/core/agent'
import { z } from 'zod'
import { FAST_MODEL } from '../models.ts'

export const ticketizerSchema = z.object({
  accion: z.enum(['none', 'open', 'update', 'resolve']),
  basis: z
    .enum(['user_confirmed', 'db_verified', 'team_stated'])
    .nullable()
    .describe('Solo para resolve: en qué se apoya la resolución. null en otro caso'),
  titulo: z.string().describe('Título corto del caso'),
  resumen: z.string().describe('Resumen del caso en una o dos frases, en tercera persona'),
})

export type TicketProposal = z.infer<typeof ticketizerSchema>

export const ticketizerAgent = new Agent({
  id: 'ticketizer',
  name: 'Ticketizer',
  model: FAST_MODEL,
  instructions: `
Lees el hilo después de que Olivia terminó su turno y propones UNA acción sobre el caso de soporte.
No decides: el sistema valida tu propuesta.

Acciones:
- none: charla sin un problema concreto y no hay caso.
- open: hay un problema concreto y no hay caso activo.
- update: hay caso activo y el problema sigue o hay información nueva.
- resolve: el problema parece resuelto.

Si propones resolve, declara la base (basis):
- user_confirmed: la persona dijo explícitamente que ya funciona.
- db_verified: Olivia lo vio en la base (por ejemplo, consultó los pagos y el reembolso figura como hecho).
- team_stated: solo lo afirma el equipo de soporte o Olivia, nada más.
Para cualquier otra acción, basis es null.`,
})
