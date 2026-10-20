import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { listPayments } from '../../db.ts'

export const paymentsTool = createTool({
  id: 'consultar-pagos',
  description: 'Lee en la base los pagos de la persona del hilo: plan, fecha, monto y estado (cobrado/reembolsado).',
  inputSchema: z.object({}),
  execute: async (_input, context) => {
    const persona = context.requestContext?.get('persona') as string | undefined
    return { pagos: persona ? await listPayments(persona) : [] }
  },
})
