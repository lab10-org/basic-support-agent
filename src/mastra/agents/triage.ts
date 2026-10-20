import { Agent } from '@mastra/core/agent'
import { z } from 'zod'
import { FAST_MODEL } from '../models.ts'

export const REGLAS = ['cliente_pago', 'bug_critico', 'problema_legal', 'problema_pagos'] as const

export const triageSchema = z.object({
  reglas: z.array(z.enum(REGLAS)).describe('Reglas de criticidad que cumple el mensaje; vacío si ninguna'),
  razon: z.string().describe('Una frase que justifique la clasificación'),
})

export type Triage = z.infer<typeof triageSchema> & { critica: boolean }

export const triageAgent = new Agent({
  id: 'triage',
  name: 'LLM de triage',
  model: FAST_MODEL,
  instructions: `
Eres el triage de un servicio de soporte. No respondes a la persona: solo revisas el hilo y su último
mensaje y marcas qué reglas de criticidad cumple.

Reglas de criticidad:
- cliente_pago: la persona es cliente de pago (tiene plan pago, suscripción activa, factura a su nombre).
- bug_critico: un bug de producto que bloquea el uso, pierde datos o afecta a muchos usuarios.
- problema_legal: amenaza legal, reclamo formal, datos personales, cumplimiento o contratos.
- problema_pagos: cobros, reembolsos, cobros duplicados, pagos fallidos o facturación.

Marca solo las reglas que el hilo respalde con claridad. Con una basta para que la petición sea crítica.`,
})
