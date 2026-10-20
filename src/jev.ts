// Cliente mínimo de Jev (TypeSafe) vía la Decisions API de OpenRouter.
// Jev no genera texto: responde preguntas tipadas (choice, noul, score) con probabilidades.
// Docs: https://openrouter.ai/docs/guides/community/jev.md
export const JEV_MODEL = process.env.JEV_MODEL ?? 'typesafe/jev-1.14'
const JEV_URL = 'https://openrouter.ai/api/alpha/decisions'

type Guidance = string | Record<string, unknown> | unknown[]

export type JevQuestion =
  | { type: 'choice'; instructions: Guidance; criteria: Record<string, Guidance | null> }
  | { type: 'noul'; instructions: Guidance; criteria: { true: Guidance; false: Guidance } }

type AnswerFor<Q> = Q extends { type: 'choice'; criteria: infer C }
  ? { type: 'choice'; choice: keyof C & string; confidence: number; probabilities: Record<keyof C & string, number> }
  : { type: 'noul'; noul: number }

export interface JevResult<Q extends Record<string, JevQuestion>> {
  answers: { [K in keyof Q]: AnswerFor<Q[K]> }
  cost: number | null
}

/** Una pregunta que respondió Jev y qué hizo el código con la respuesta; va al trace del turno. */
export interface JevDecision {
  pregunta: string
  instrucciones: string
  tipo: 'choice' | 'noul'
  respuesta: string
  probabilidades: Record<string, number>
  /** Solo en choice: qué tan concentrada está la probabilidad en una opción. */
  confianza: number | null
  efecto: string
}

/** Aplana una pregunta y su respuesta para el trace. En noul, la respuesta es sí desde 0.5. */
export function toDecision(pregunta: string, q: JevQuestion, a: AnswerFor<JevQuestion>, efecto: string): JevDecision {
  const instrucciones = typeof q.instructions === 'string' ? q.instructions : JSON.stringify(q.instructions)
  if (a.type === 'noul')
    return { pregunta, instrucciones, tipo: 'noul', respuesta: a.noul >= 0.5 ? 'sí' : 'no', probabilidades: { sí: a.noul, no: 1 - a.noul }, confianza: null, efecto }
  return { pregunta, instrucciones, tipo: 'choice', respuesta: a.choice, probabilidades: a.probabilities, confianza: a.confidence, efecto }
}

/** Pide a Jev las respuestas de varias preguntas sobre el mismo estado; se evalúan en paralelo. */
export async function decide<const Q extends Record<string, JevQuestion>>(state: string, questions: Q): Promise<JevResult<Q>> {
  const res = await fetch(JEV_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: JEV_MODEL, state, questions }),
  })
  if (!res.ok) throw new Error(`Jev respondió ${res.status}: ${await res.text()}`)
  const body = (await res.json()) as { answers: JevResult<Q>['answers']; usage?: { cost?: number } }
  return { answers: body.answers, cost: body.usage?.cost ?? null }
}
