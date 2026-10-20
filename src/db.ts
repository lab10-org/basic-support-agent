import { mkdirSync } from 'node:fs'
import { createClient } from '@libsql/client'

mkdirSync('data', { recursive: true })

export const DB_URL = 'file:./data/olivia.db'
export const db = createClient({ url: DB_URL })

export type Role = 'persona' | 'olivia' | 'soporte' | 'sistema'
export type CaseStatus = 'open' | 'awaiting_confirmation' | 'resolved'

export interface Thread {
  id: string
  persona: string
  created_at: string
}

export interface Message {
  id: number
  thread_id: string
  role: Role
  author: string | null
  content: string
  meta: string | null
  created_at: string
}

export interface SupportCase {
  id: number
  thread_id: string
  status: CaseStatus
  critica: number
  derivado: number
  assignee: string | null
  titulo: string
  resumen: string
  resolved_basis: string | null
  created_at: string
  updated_at: string
}

export async function initDb() {
  await db.batch(
    [
      `CREATE TABLE IF NOT EXISTS app_threads (
        id TEXT PRIMARY KEY,
        persona TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS app_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        role TEXT NOT NULL,
        author TEXT,
        content TEXT NOT NULL,
        meta TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS app_cases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        status TEXT NOT NULL,
        critica INTEGER NOT NULL DEFAULT 0,
        derivado INTEGER NOT NULL DEFAULT 0,
        assignee TEXT,
        titulo TEXT NOT NULL,
        resumen TEXT NOT NULL,
        resolved_basis TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS app_case_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS app_slack_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS app_kb_articles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        keywords TEXT NOT NULL,
        body TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS app_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        persona TEXT NOT NULL,
        plan TEXT NOT NULL,
        fecha TEXT NOT NULL,
        monto REAL NOT NULL,
        estado TEXT NOT NULL
      )`,
    ],
    'write',
  )

  const { rows } = await db.execute('SELECT COUNT(*) AS n FROM app_kb_articles')
  if (Number(rows[0].n) === 0) await seed()
}

async function seed() {
  const articles = [
    ['Restablecer contraseña', 'contraseña password clave acceso login olvidé entrar sesión',
      'Desde el inicio de sesión, pulsa "¿Olvidaste tu contraseña?" e ingresa tu correo. El enlace llega en menos de 5 minutos y vence en 1 hora.'],
    ['Cobros duplicados', 'cobro doble duplicado factura tarjeta cargo pago reembolso',
      'Los cobros duplicados se revierten en 3 a 5 días hábiles. Si pasó más tiempo, el equipo de soporte debe revisarlo.'],
    ['Cambiar plan', 'plan suscripción cambiar upgrade downgrade precio mensual anual',
      'El plan se cambia en Configuración > Suscripción. Los upgrades aplican de inmediato; los downgrades al siguiente ciclo.'],
    ['La plataforma no carga', 'caída carga error lento servicio plataforma página caído',
      'Recarga sin caché (Ctrl+Shift+R) o prueba otro navegador. Si persiste para varios usuarios, es un incidente.'],
    ['Exportar datos', 'exportar descargar csv datos reporte excel',
      'En Reportes > Exportar puedes descargar CSV de los últimos 12 meses.'],
  ]
  // Pagos de ejemplo para que Olivia tenga una lectura real (db_verified).
  const payments = [
    ['ana', 'Pro mensual', '2026-10-01', 49, 'cobrado'],
    ['ana', 'Pro mensual', '2026-10-01', 49, 'reembolsado'],
    ['carlos', 'Business anual', '2026-09-15', 990, 'cobrado'],
    ['carlos', 'Business anual', '2026-09-15', 990, 'cobrado'],
  ]
  await db.batch(
    [
      ...articles.map((args) => ({ sql: 'INSERT INTO app_kb_articles (title, keywords, body) VALUES (?, ?, ?)', args })),
      ...payments.map((args) => ({
        sql: 'INSERT INTO app_payments (persona, plan, fecha, monto, estado) VALUES (?, ?, ?, ?, ?)',
        args,
      })),
    ],
    'write',
  )
}

// --- hilos y mensajes ---

export async function listThreads() {
  const { rows } = await db.execute(`
    SELECT t.*, c.status AS case_status, c.derivado AS case_derivado
    FROM app_threads t
    LEFT JOIN app_cases c ON c.id = (SELECT MAX(id) FROM app_cases WHERE thread_id = t.id)
    ORDER BY t.created_at DESC, t.rowid DESC`)
  return rows
}

export async function createThread(id: string, persona: string) {
  await db.execute({ sql: 'INSERT INTO app_threads (id, persona) VALUES (?, ?)', args: [id, persona] })
}

export async function getThread(id: string) {
  const { rows } = await db.execute({ sql: 'SELECT * FROM app_threads WHERE id = ?', args: [id] })
  return rows[0] as unknown as Thread | undefined
}

export async function listMessages(threadId: string) {
  const { rows } = await db.execute({ sql: 'SELECT * FROM app_messages WHERE thread_id = ? ORDER BY id', args: [threadId] })
  return rows as unknown as Message[]
}

export async function addMessage(threadId: string, role: Role, content: string, author: string | null = null, meta?: unknown) {
  await db.execute({
    sql: 'INSERT INTO app_messages (thread_id, role, author, content, meta) VALUES (?, ?, ?, ?, ?)',
    args: [threadId, role, author, content, meta === undefined ? null : JSON.stringify(meta)],
  })
}

// --- casos ---

/** El caso activo del hilo: el último que no está resuelto. */
export async function getActiveCase(threadId: string) {
  const { rows } = await db.execute({
    sql: "SELECT * FROM app_cases WHERE thread_id = ? AND status != 'resolved' ORDER BY id DESC LIMIT 1",
    args: [threadId],
  })
  return rows[0] as unknown as SupportCase | undefined
}

export async function getCase(id: number) {
  const { rows } = await db.execute({ sql: 'SELECT * FROM app_cases WHERE id = ?', args: [id] })
  return rows[0] as unknown as SupportCase | undefined
}

export async function listCases(threadId: string) {
  const { rows } = await db.execute({ sql: 'SELECT * FROM app_cases WHERE thread_id = ? ORDER BY id DESC', args: [threadId] })
  return rows as unknown as SupportCase[]
}

export async function addCaseEvent(caseId: number, type: string, detail?: unknown) {
  await db.execute({
    sql: 'INSERT INTO app_case_events (case_id, type, detail) VALUES (?, ?, ?)',
    args: [caseId, type, detail === undefined ? null : JSON.stringify(detail)],
  })
}

export async function listCaseEvents(caseId: number) {
  const { rows } = await db.execute({ sql: 'SELECT * FROM app_case_events WHERE case_id = ? ORDER BY id', args: [caseId] })
  return rows.map((r) => ({ ...r, detail: r.detail ? JSON.parse(String(r.detail)) : null }))
}

export async function listSlackPosts() {
  const { rows } = await db.execute(`
    SELECT p.*, c.status, c.assignee, c.thread_id, c.titulo, t.persona
    FROM app_slack_posts p
    JOIN app_cases c ON c.id = p.case_id
    JOIN app_threads t ON t.id = c.thread_id
    ORDER BY p.id DESC`)
  return rows
}

// --- lecturas que usan las tools de Olivia ---

const plain = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export async function searchKb(query: string) {
  const words = plain(query).split(/\W+/).filter((w) => w.length > 3)
  if (words.length === 0) return []
  const { rows } = await db.execute('SELECT * FROM app_kb_articles')
  return rows
    .map((r) => ({
      title: String(r.title),
      body: String(r.body),
      score: words.filter((w) => plain(`${r.title} ${r.keywords}`).includes(w)).length,
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
}

export async function listPayments(persona: string) {
  const { rows } = await db.execute({
    sql: 'SELECT plan, fecha, monto, estado FROM app_payments WHERE persona = ? ORDER BY id',
    args: [plain(persona).trim()],
  })
  return rows.map((r) => ({ plan: String(r.plan), fecha: String(r.fecha), monto: Number(r.monto), estado: String(r.estado) }))
}
