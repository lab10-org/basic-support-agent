import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getActiveCase } from '../../db.ts'

export const caseStatusTool = createTool({
  id: 'consultar-caso',
  description: 'Consulta el caso de soporte abierto del hilo actual: estado, criticidad y quién lo tiene.',
  inputSchema: z.object({}),
  execute: async (_input, context) => {
    const threadId = context.requestContext?.get('threadId') as string | undefined
    if (!threadId) return { caso: null }
    const c = await getActiveCase(threadId)
    if (!c) return { caso: null }
    return {
      caso: {
        id: c.id,
        estado: c.status,
        derivado: Boolean(c.derivado),
        resumen: c.resumen,
        asignado_a: c.assignee,
      },
    }
  },
})
