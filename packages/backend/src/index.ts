import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { authMiddleware } from './middleware/auth.js'
import { usersRouter } from './routes/users.js'
import { accountsRouter } from './routes/accounts.js'
import { plansRouter } from './routes/plans.js'
import { budgetsRouter } from './routes/budgets.js'
import { transactionsRouter } from './routes/transactions.js'
import { bankTicketsRouter } from './routes/bankTickets.js'
import { tagsRouter } from './routes/tags.js'

const app = express()
const PORT = Number(process.env.PORT ?? 3000)

// ─── Global middleware ─────────────────────────────────────────────────────────
app.use(helmet())
app.use(cors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173' }))
app.use(express.json())

// ─── Public endpoints ──────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ─── Protected API ─────────────────────────────────────────────────────────────
app.use('/api', authMiddleware)
app.use('/api/users', usersRouter)
app.use('/api/accounts', accountsRouter)
app.use('/api/plans', plansRouter)
app.use('/api/budgets', budgetsRouter)
app.use('/api/transactions', transactionsRouter)
app.use('/api/bank-tickets', bankTicketsRouter)
app.use('/api/tags', tagsRouter)

// ─── Global error handler ──────────────────────────────────────────────────────
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
})

// ─── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[backend] listening on http://0.0.0.0:${PORT}`)
})

export default app
