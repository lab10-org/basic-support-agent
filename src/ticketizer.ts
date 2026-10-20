// Paso 4: el Ticketizer. Jev decide la acción y su base; un LLM pequeño redacta el texto
// solo si la acción abre o actualiza el caso.
import type { SupportCase } from './db.ts'
import { decide, toDecision, type JevDecision } from './jev.ts'
import { mastra } from './mastra/index.ts'
import { caseTextSchema } from './mastra/agents/ticketizer.ts'

export const ACCIONES = ['none', 'open', 'update', 'resolve'] as const
export const BASES = ['user_confirmed', 'db_verified', 'team_stated'] as const
export type Accion = (typeof ACCIONES)[number]
export type Basis = (typeof BASES)[number]

const PREGUNTAS = {
  accion: {
    type: 'choice',
    instructions: 'Tras el último turno de Olivia, ¿qué acción corresponde sobre el caso de soporte?',
    criteria: {
      none: {
        what: 'Charla o pregunta sin un problema concreto, y no hay caso activo',
        not_for: 'Un problema concreto, aunque sea pequeño',
      },
      open: {
        what: 'Hay un problema concreto y no hay caso activo',
        not_for: 'Un hilo que ya tiene caso activo',
      },
      update: {
        what: 'Hay caso activo y el problema sigue, o aparece información nueva',
        not_for: 'Un problema que ya quedó resuelto',
      },
      resolve: {
        what: 'Hay caso activo y el problema parece resuelto',
        not_for: 'Una promesa de arreglo que aún no se cumplió, o un problema que sigue',
      },
    },
  },
  basis: {
    type: 'choice',
    instructions: 'Si el problema estuviera resuelto, ¿en qué se apoya esa resolución?',
    criteria: {
      user_confirmed: 'La persona dijo explícitamente que ya funciona',
      db_verified: 'Olivia lo vio en la base: por ejemplo, consultó los pagos y el reembolso figura como hecho',
      team_stated: 'Solo lo afirma el equipo de soporte u Olivia, sin confirmación ni lectura de la base',
    },
  },
} as const

export interface TicketProposal {
  accion: Accion
  basis: Basis | null
  confianza: number
  probabilidades: Record<Accion, number>
  decisiones: JevDecision[]
  titulo: string | null
  resumen: string | null
  costo: number | null
}

export async function runTicketizer(opts: { caso: SupportCase | undefined; toolsCalled: string[]; hilo: string }) {
  const { caso, toolsCalled, hilo } = opts
  const contexto = [
    `Caso activo: ${caso ? `#${caso.id} (${caso.status}) — ${caso.resumen}` : 'ninguno'}`,
    `Tools que llamó Olivia en este turno: ${toolsCalled.join(', ') || 'ninguna'}`,
    `Hilo:\n${hilo}`,
  ].join('\n\n')

  const { answers, cost } = await decide(contexto, PREGUNTAS)
  const accion = answers.accion.choice
  const proposal: TicketProposal = {
    accion,
    basis: accion === 'resolve' ? answers.basis.choice : null,
    confianza: answers.accion.confidence,
    probabilidades: answers.accion.probabilities,
    decisiones: [
      toDecision('accion', PREGUNTAS.accion, answers.accion, 'Se propone a la compuerta, que la valida en el paso 5.'),
      toDecision('basis', PREGUNTAS.basis, answers.basis,
        accion === 'resolve' ? 'Se usa en resolveGate() para decidir el cierre.' : 'Se ignora: solo aplica cuando la acción es resolve.'),
    ],
    titulo: null,
    resumen: null,
    costo: cost,
  }
  return proposal
}

/** Redacta título y resumen con el LLM. Solo para open y update. */
export async function writeCaseText(opts: { caso: SupportCase | undefined; hilo: string }) {
  const { caso, hilo } = opts
  const res = await mastra.getAgentById('case-writer').generate(
    [`Caso activo: ${caso ? `#${caso.id} — ${caso.titulo}: ${caso.resumen}` : 'ninguno'}`, `Hilo:\n${hilo}`].join('\n\n'),
    { structuredOutput: { schema: caseTextSchema } },
  )
  return res.object
}
