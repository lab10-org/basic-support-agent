import { Mastra } from '@mastra/core'
import { LibSQLStore } from '@mastra/libsql'
import { DB_URL } from '../db.ts'
import { oliviaAgent } from './agents/olivia.ts'
import { ticketizerAgent } from './agents/ticketizer.ts'
import { triageAgent } from './agents/triage.ts'

export const mastra = new Mastra({
  agents: { triageAgent, oliviaAgent, ticketizerAgent },
  storage: new LibSQLStore({ id: 'olivia-storage', url: DB_URL }),
})
