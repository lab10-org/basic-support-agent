import { Agent } from '@mastra/core/agent'
import { z } from 'zod'
import { FAST_MODEL } from '../models.ts'

// Jev decide la acción del caso pero no escribe texto: este LLM redacta título y resumen,
// y solo se llama cuando la acción es open o update.
export const caseTextSchema = z.object({
  titulo: z.string().describe('Título corto del caso'),
  resumen: z.string().describe('Resumen del caso en una o dos frases, en tercera persona'),
})

export const caseWriterAgent = new Agent({
  id: 'case-writer',
  name: 'Redactor de casos',
  model: FAST_MODEL,
  instructions: `
Lees un hilo de soporte y redactas el título y el resumen del caso. No decides nada sobre el caso:
eso ya está decidido. Si hay un caso activo, actualiza su resumen con la información nueva del hilo.`,
})
