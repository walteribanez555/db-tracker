// Ejecución de un script SQL (migración) con tiempos por sentencia.
// PostgreSQL: todo en una transacción (DDL transaccional) → COMMIT o ROLLBACK.
// MySQL: el DDL hace COMMIT implícito, así que se ejecuta en orden y se detiene en el primer error.
import { splitStatements } from '../../../src/lib/importers/split.ts'
import type { ApplyResponse, ApplyStatementResult } from '../../../src/features/io/api-types.ts'
import { DbError, elapsed, now, toDbError, type DbClient } from './client.ts'
import { LIMITS } from './validation.ts'

const preview = (s: string) => (s.length > 400 ? `${s.slice(0, 400)}…` : s)

export async function applySQL(client: DbClient, sql: string, opts: { dryRun?: boolean } = {}): Promise<ApplyResponse> {
  const statements = splitStatements(sql).filter((s) => !/^(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION)\b/i.test(s))
  if (!statements.length) throw new DbError('El script no contiene sentencias ejecutables.', 400)
  if (statements.length > LIMITS.maxApplyStatements) throw new DbError(`Demasiadas sentencias (máx. ${LIMITS.maxApplyStatements}).`, 400)

  const pg = client.dialect === 'postgresql'
  const dryRun = !!opts.dryRun && pg
  const notes: string[] = []
  if (opts.dryRun && !pg) notes.push('MySQL no admite DDL transaccional: la validación en seco no está disponible; no se ejecutó nada.')
  if (opts.dryRun && !pg) {
    return { ok: false, transactional: false, committed: false, dryRun: true, totalMs: 0, executed: [], notes }
  }
  if (!pg) notes.push('MySQL confirma implícitamente cada sentencia DDL: si una falla, las anteriores quedan aplicadas.')

  const executed: ApplyStatementResult[] = []
  const t0 = now()
  if (pg) {
    await client.query('BEGIN')
    await client.query(`SET LOCAL statement_timeout = ${LIMITS.applyStatementTimeoutMs}`)
  }
  for (let i = 0; i < statements.length; i++) {
    const st = statements[i]
    const ts = now()
    try {
      const r = await client.query(st, undefined, pg ? undefined : { timeoutMs: LIMITS.applyStatementTimeoutMs })
      executed.push({ index: i, statement: preview(st), ms: elapsed(ts), rowCount: r.rowCount })
    } catch (err) {
      const e = toDbError(err)
      if (pg) await client.query('ROLLBACK').catch(() => {})
      return {
        ok: false,
        transactional: pg,
        committed: false,
        dryRun,
        totalMs: elapsed(t0),
        executed,
        failed: { index: i, statement: preview(st), error: e.message, code: e.code },
        notes: pg ? ['Se hizo ROLLBACK: la base de datos queda como estaba.', ...notes] : notes,
      }
    }
  }
  if (pg) {
    if (dryRun) {
      await client.query('ROLLBACK')
      notes.push('Validación en seco: todas las sentencias se ejecutaron y se hizo ROLLBACK.')
    } else {
      await client.query('COMMIT')
    }
  }
  return { ok: true, transactional: pg, committed: !dryRun, dryRun, totalMs: elapsed(t0), executed, notes }
}
