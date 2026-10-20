import { Mastra } from '@mastra/core'
import { LibSQLStore } from '@mastra/libsql'
import { DB_URL } from '../db.ts'
import { oliviaAgent } from './agents/olivia.ts'
import { caseWriterAgent } from './agents/ticketizer.ts'

export const mastra = new Mastra({
  agents: { oliviaAgent, caseWriterAgent },
  storage: new LibSQLStore({ id: 'olivia-storage', url: DB_URL }),
})
