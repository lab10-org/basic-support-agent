// Paso 5: el código aplica la acción que propone el Ticketizer y decide el cierre.
// Paso 6: si Olivia derivó, el caso se publica en Slack (simulado + webhook opcional).
import { addCaseEvent, addMessage, db, getActiveCase, getCase, type CaseStatus, type SupportCase } from './db.ts'
import type { TicketProposal } from './ticketizer.ts'

// Tools de Olivia que leen la base: respaldan un basis "db_verified".
const READ_TOOLS = ['consultar-pagos', 'consultar-caso', 'paymentsTool', 'caseStatusTool']

// Jev da probabilidades: con poca confianza en la acción no se actúa sobre el caso,
// y un resolve con update como alternativa real pide confirmación.
const CONFIANZA_MIN = Number(process.env.TICKET_CONFIANZA_MIN ?? 0.5)
const ALTERNATIVA = 0.25

type CaseText = { titulo: string; resumen: string }

/** La compuerta: decide si un "resolve" cierra el caso o pide confirmación a la persona. */
export function resolveGate(basis: TicketProposal['basis'], toolsCalled: string[], dudaUpdate = false): {
  status: CaseStatus
  motivo: string
} {
  if (dudaUpdate)
    return { status: 'awaiting_confirmation', motivo: 'Jev ve update como alternativa real: se pide confirmación a la persona.' }
  if (basis === 'user_confirmed') return { status: 'resolved', motivo: 'La persona confirmó que ya funciona.' }
  if (basis === 'db_verified' && toolsCalled.some((t) => READ_TOOLS.includes(t)))
    return { status: 'resolved', motivo: `Hubo una lectura real en la base (${toolsCalled.join(', ')}).` }
  if (basis === 'db_verified')
    return { status: 'awaiting_confirmation', motivo: 'Dice db_verified pero el turno no llamó ninguna tool de lectura.' }
  return { status: 'awaiting_confirmation', motivo: 'Solo lo afirma el equipo: se pide confirmación a la persona.' }
}

export interface CaseDecision {
  propuesta: TicketProposal
  aplicada: string
  motivo: string
  caso: SupportCase | null
  slack: string | null
}

export async function applyTurn(opts: {
  threadId: string
  persona: string
  critica: boolean
  proposal: TicketProposal
  toolsCalled: string[]
  derivacion: string | undefined
  /** Redacta título y resumen; solo se llama si la acción aplicada abre o actualiza el caso. */
  escribir: () => Promise<CaseText>
}): Promise<CaseDecision> {
  const { threadId, persona, critica, proposal, toolsCalled, derivacion, escribir } = opts
  let caso = await getActiveCase(threadId)
  let aplicada = 'ninguna'
  let motivo = 'El Ticketizer no propuso cambios.'

  let accion = proposal.accion
  let nota = ''
  if (proposal.confianza < CONFIANZA_MIN && accion !== 'none') {
    accion = caso ? 'update' : 'none'
    nota = `Jev dudó (confianza ${proposal.confianza.toFixed(2)}): ${proposal.accion} pasa a ${accion}.`
  }
  // Derivar exige un caso: si Olivia derivó y no hay caso, se abre.
  if (!caso && derivacion && accion === 'none') accion = 'open'

  if (accion === 'open' || (accion === 'update' && !caso)) {
    const texto = await escribir()
    if (caso) {
      await updateCase(caso.id, caso.status, texto, proposal)
      aplicada = 'update'
      motivo = `Ya existía el caso #${caso.id}: se actualiza.`
    } else {
      const res = await db.execute({
        sql: `INSERT INTO app_cases (thread_id, status, critica, titulo, resumen) VALUES (?, 'open', ?, ?, ?) RETURNING id`,
        args: [threadId, critica ? 1 : 0, texto.titulo, texto.resumen],
      })
      const id = Number(res.rows[0].id)
      await addCaseEvent(id, 'open', { ...proposal, ...texto })
      aplicada = 'open'
      motivo = `Se abre el caso #${id}.`
    }
  } else if (accion === 'update' && caso) {
    // Un turno nuevo clasificado update devuelve a la cola un caso que esperaba confirmación.
    await updateCase(caso.id, 'open', await escribir(), proposal)
    aplicada = 'update'
    motivo = caso.status === 'awaiting_confirmation' ? 'Turno nuevo clasificado update: el caso vuelve a open.' : 'Caso actualizado.'
  } else if (accion === 'resolve' && caso) {
    const gate = resolveGate(proposal.basis, toolsCalled, proposal.probabilidades.update > ALTERNATIVA)
    await resolveCase(caso.id, gate.status, proposal.basis, proposal)
    aplicada = gate.status
    motivo = gate.motivo
  } else if (accion === 'resolve') {
    motivo = 'Propuso resolve pero no hay caso activo.'
  }

  caso = (await getActiveCase(threadId)) ?? (await lastCase(threadId))

  let slack: string | null = null
  if (derivacion && caso && caso.status !== 'resolved') {
    if (!caso.derivado) {
      slack = await postToSlack(caso, persona, derivacion, 'nuevo')
      await db.execute({ sql: "UPDATE app_cases SET derivado = 1, updated_at = datetime('now') WHERE id = ?", args: [caso.id] })
      await addCaseEvent(caso.id, 'derivado', { motivo: derivacion })
      await addMessage(threadId, 'sistema', `Caso #${caso.id} derivado al equipo de soporte.`)
      caso = await getCase(caso.id)
    } else {
      // Ya estaba en manos del equipo: se avisa la novedad en Slack.
      slack = await postToSlack(caso, persona, derivacion, 'novedad')
      await addCaseEvent(caso.id, 'novedad_slack', { motivo: derivacion })
      await addMessage(threadId, 'sistema', `Novedad del caso #${caso.id} enviada al equipo de soporte.`)
    }
  }

  return { propuesta: proposal, aplicada, motivo: nota ? `${nota} ${motivo}` : motivo, caso: caso ?? null, slack }
}

async function lastCase(threadId: string) {
  const { rows } = await db.execute({ sql: 'SELECT * FROM app_cases WHERE thread_id = ? ORDER BY id DESC LIMIT 1', args: [threadId] })
  return rows[0] as unknown as SupportCase | undefined
}

async function updateCase(id: number, status: CaseStatus, texto: CaseText, proposal: TicketProposal) {
  await db.execute({
    sql: "UPDATE app_cases SET status = ?, titulo = ?, resumen = ?, updated_at = datetime('now') WHERE id = ?",
    args: [status, texto.titulo, texto.resumen, id],
  })
  await addCaseEvent(id, 'update', { ...proposal, ...texto })
}

async function resolveCase(id: number, status: CaseStatus, basis: string | null, detail: unknown) {
  await db.execute({
    sql: "UPDATE app_cases SET status = ?, resolved_basis = ?, updated_at = datetime('now') WHERE id = ?",
    args: [status, status === 'resolved' ? basis : null, id],
  })
  await addCaseEvent(id, status, detail)
  const caso = await getCase(id)
  await addMessage(
    caso!.thread_id,
    'sistema',
    status === 'resolved' ? `Caso #${id} resuelto (${basis}).` : `Caso #${id} en espera de confirmación de la persona.`,
  )
}

async function postToSlack(caso: SupportCase, persona: string, motivo: string, tipo: 'nuevo' | 'novedad') {
  const encabezado =
    tipo === 'nuevo'
      ? `🔴 *Caso #${caso.id}* · ${caso.titulo}`
      : `🔁 *Novedad en caso #${caso.id}*${caso.assignee ? ` · @${caso.assignee}` : ''} · ${caso.titulo}`
  const text = `${encabezado}\n*${persona}*: ${caso.resumen}\n_Olivia: ${motivo}_`
  await db.execute({ sql: 'INSERT INTO app_slack_posts (case_id, text) VALUES (?, ?)', args: [caso.id, text] })

  if (process.env.SLACK_WEBHOOK_URL) {
    fetch(process.env.SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    }).catch((err) => console.error('No se pudo enviar a Slack:', err))
  }
  return text
}

// --- acciones del equipo de soporte (paso 6) ---

export async function takeCase(caseId: number, agente: string) {
  const caso = await getCase(caseId)
  if (!caso || caso.status === 'resolved') throw new Error('El caso no existe o ya está resuelto')
  await db.execute({ sql: "UPDATE app_cases SET assignee = ?, updated_at = datetime('now') WHERE id = ?", args: [agente, caseId] })
  await addCaseEvent(caseId, 'tomado', { agente })
  await addMessage(caso.thread_id, 'sistema', `${agente} (equipo de soporte) tomó el caso #${caseId}.`)
}

export async function replyAsSupport(caseId: number, agente: string, texto: string) {
  const caso = await getCase(caseId)
  if (!caso) throw new Error('El caso no existe')
  await addMessage(caso.thread_id, 'soporte', texto, agente)
  await addCaseEvent(caseId, 'respuesta_soporte', { agente, texto })
}

/** El equipo dice que está resuelto: basis team_stated, así que pasa por la compuerta. */
export async function teamResolve(caseId: number, agente: string) {
  const caso = await getCase(caseId)
  if (!caso || caso.status === 'resolved') throw new Error('El caso no existe o ya está resuelto')
  const gate = resolveGate('team_stated', [])
  await resolveCase(caseId, gate.status, 'team_stated', { por: agente, motivo: gate.motivo })
}
