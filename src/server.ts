import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import {
  createThread,
  getThread,
  initDb,
  listCaseEvents,
  listCases,
  listMessages,
  listSlackPosts,
  listThreads,
} from './db.ts'
import { runTurn } from './pipeline.ts'
import { replyAsSupport, takeCase, teamResolve } from './ticketGate.ts'

await initDb()

const app = new Hono()

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: err.message }, 500)
})

app.get('/', (c) => c.html(readFileSync('public/index.html', 'utf8')))

app.get('/api/threads', async (c) => c.json(await listThreads()))

app.post('/api/threads', async (c) => {
  const { persona } = await c.req.json<{ persona: string }>()
  const id = randomUUID()
  await createThread(id, persona?.trim() || 'anónimo')
  return c.json({ id })
})

app.get('/api/threads/:id', async (c) => {
  const id = c.req.param('id')
  const thread = await getThread(id)
  if (!thread) return c.json({ error: 'Hilo no encontrado' }, 404)
  const cases = await listCases(id)
  return c.json({
    thread,
    messages: (await listMessages(id)).map((m) => ({ ...m, meta: m.meta ? JSON.parse(m.meta) : null })),
    cases: await Promise.all(cases.map(async (k) => ({ ...k, events: await listCaseEvents(k.id) }))),
  })
})

app.post('/api/threads/:id/messages', async (c) => {
  const id = c.req.param('id')
  const thread = await getThread(id)
  if (!thread) return c.json({ error: 'Hilo no encontrado' }, 404)
  const { text } = await c.req.json<{ text: string }>()
  return c.json(await runTurn(id, thread.persona, text))
})

// Equipo de soporte (Slack simulado)
app.get('/api/slack', async (c) => c.json(await listSlackPosts()))

app.post('/api/cases/:id/take', async (c) => {
  const { agente } = await c.req.json<{ agente: string }>()
  await takeCase(Number(c.req.param('id')), agente)
  return c.json({ ok: true })
})

app.post('/api/cases/:id/reply', async (c) => {
  const { agente, texto } = await c.req.json<{ agente: string; texto: string }>()
  await replyAsSupport(Number(c.req.param('id')), agente, texto)
  return c.json({ ok: true })
})

app.post('/api/cases/:id/resolve', async (c) => {
  const { agente } = await c.req.json<{ agente: string }>()
  await teamResolve(Number(c.req.param('id')), agente)
  return c.json({ ok: true })
})

const port = Number(process.env.PORT ?? 3000)
serve({ fetch: app.fetch, port }, () => console.log(`Olivia en http://localhost:${port}`))
