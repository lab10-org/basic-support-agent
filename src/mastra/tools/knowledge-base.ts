import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { searchKb } from '../../db.ts'

export const knowledgeBaseTool = createTool({
  id: 'buscar-base-conocimiento',
  description: 'Busca artículos de ayuda en la base de conocimiento. Úsala antes de responder cualquier duda.',
  inputSchema: z.object({
    consulta: z.string().describe('Palabras clave del problema, en español'),
  }),
  outputSchema: z.object({
    articulos: z.array(z.object({ title: z.string(), body: z.string() })),
  }),
  execute: async ({ consulta }) => {
    const results = await searchKb(consulta)
    return { articulos: results.map(({ title, body }) => ({ title, body })) }
  },
})
