import express from 'express'
import cors from 'cors'
import helmet from 'helmet'

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

// ─── Protected API (Phase 2) ───────────────────────────────────────────────────
// import { authMiddleware } from './middleware/auth'
// import { accountsRouter } from './routes/accounts'
// import { plansRouter } from './routes/plans'
// import { budgetsRouter } from './routes/budgets'
// import { transactionsRouter } from './routes/transactions'
// import { bankTicketsRouter } from './routes/bankTickets'
// import { tagsRouter } from './routes/tags'
//
// app.use('/api', authMiddleware)
// app.use('/api/accounts', accountsRouter)
// app.use('/api/plans', plansRouter)
// app.use('/api/budgets', budgetsRouter)
// app.use('/api/transactions', transactionsRouter)
// app.use('/api/bank-tickets', bankTicketsRouter)
// app.use('/api/tags', tagsRouter)

// ─── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[backend] listening on http://0.0.0.0:${PORT}`)
})

export default app
