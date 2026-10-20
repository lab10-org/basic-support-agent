// Paso 2: triage con Jev. Una pregunta sí/no (noul) por regla de criticidad; el código combina.
import { decide, toDecision, type JevDecision, type JevQuestion } from './jev.ts'

export const REGLAS = ['cliente_pago', 'bug_critico', 'problema_legal', 'problema_pagos'] as const
export type Regla = (typeof REGLAS)[number]

// Una regla se marca desde este valor de noul. Por debajo de DUDA no hay señal.
const UMBRAL = Number(process.env.TRIAGE_UMBRAL ?? 0.7)
const DUDA = 0.3

const PREGUNTAS = {
  cliente_pago: {
    type: 'noul',
    instructions: '¿La persona es cliente de pago?',
    criteria: {
      true: 'El hilo muestra que tiene plan pago, suscripción activa o factura a su nombre',
      false: 'No hay señal de que pague, o usa un plan gratuito o de prueba',
    },
  },
  bug_critico: {
    type: 'noul',
    instructions: '¿El hilo reporta un bug crítico del producto?',
    criteria: {
      true: 'Un fallo que bloquea el uso, pierde datos o afecta a muchos usuarios',
      false: 'Una duda, una molestia menor, un pedido de función o un fallo con alternativa',
    },
  },
  problema_legal: {
    type: 'noul',
    instructions: '¿El hilo plantea un problema legal?',
    criteria: {
      true: 'Amenaza legal, reclamo formal, datos personales, cumplimiento o contratos',
      false: 'Nada de eso aparece; pedir un reembolso o quejarse de un cobro, sin amenaza ni reclamo formal, no es legal',
    },
  },
  problema_pagos: {
    type: 'noul',
    instructions: '¿El hilo trata de un problema de pagos?',
    criteria: {
      true: 'Cobros, reembolsos, cobros duplicados, pagos fallidos o facturación',
      false: 'El problema no involucra dinero ni facturación',
    },
  },
} as const satisfies Record<Regla, JevQuestion>

export interface Triage {
  reglas: Regla[]
  /** Reglas en zona gris: ni claramente sí ni claramente no. */
  dudosas: Regla[]
  probabilidades: Record<Regla, number>
  decisiones: JevDecision[]
  critica: boolean
  costo: number | null
}

export async function runTriage(hilo: string): Promise<Triage> {
  const { answers, cost } = await decide(`Hilo de soporte:\n${hilo}`, PREGUNTAS)
  const probabilidades = Object.fromEntries(REGLAS.map((r) => [r, answers[r].noul])) as Record<Regla, number>
  const reglas = REGLAS.filter((r) => probabilidades[r] >= UMBRAL)
  const dudosas = REGLAS.filter((r) => probabilidades[r] >= DUDA && probabilidades[r] < UMBRAL)
  const decisiones = REGLAS.map((r) =>
    toDecision(r, PREGUNTAS[r], answers[r],
      reglas.includes(r) ? `Se marca: ${probabilidades[r].toFixed(2)} ≥ ${UMBRAL}.`
      : dudosas.includes(r) ? `Dudosa: entre ${DUDA} y ${UMBRAL}, no se marca.`
      : `Se descarta: ${probabilidades[r].toFixed(2)} < ${DUDA}.`),
  )
  return { reglas, dudosas, probabilidades, decisiones, critica: reglas.length > 0, costo: cost }
}
