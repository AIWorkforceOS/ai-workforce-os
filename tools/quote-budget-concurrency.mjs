#!/usr/bin/env node
/**
 * TESTE DE CONCORRÊNCIA DO ORÇAMENTO — roda DEPOIS de aplicar as migrations 093–096. NÃO chama a OpenAI (custo US$ 0).
 * Cria 1 job de teste (status running) numa unidade/ordem existente, dispara 20 reservas de US$ 0,10 em PARALELO (conexões reais
 * do PostgREST) e confere: no máximo 6 passam (teto US$ 0,60), ids distintos, soma exata, e liquidação em paralelo da MESMA reserva
 * cobra uma vez só. Depois apaga o job de teste (cascata remove as reservas).
 *
 * Uso (de dentro de apps/web; escolha uma ordem de teste do Vinicius):
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node ../../tools/quote-budget-concurrency.mjs --confirm --appointment <uuid>
 * Sem --confirm só mostra o plano. Nunca imprime chaves.
 */
import { createRequire } from 'node:module'
// resolve o pacote a partir da pasta atual (rode de dentro de apps/web, onde @supabase/supabase-js está instalado)
const { createClient } = createRequire(process.cwd() + '/package.json')('@supabase/supabase-js')

const args = process.argv.slice(2)
const confirm = args.includes('--confirm')
const appointmentId = args[args.indexOf('--appointment') + 1]
if (!confirm || !appointmentId) {
  console.log('Plano: criar 1 job de teste, 20 reservas paralelas de 0,10 (esperado: 6 aceitas), 10 liquidações paralelas da mesma reserva (esperado: 1 cobrança), apagar o job. Rode com --confirm --appointment <uuid>.')
  process.exit(0)
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.')
const db = createClient(url, key, { auth: { persistSession: false } })

const fail = (msg) => { console.error('FALHOU:', msg); process.exitCode = 1 }
const { data: appt, error: apptErr } = await db.from('appointments').select('id, unit_id, units(org_id)').eq('id', appointmentId).single()
if (apptErr || !appt) throw new Error('Ordem não encontrada: ' + (apptErr?.message ?? ''))
const orgId = appt.units?.org_id
const key0 = 'concurrency-test-' + Date.now()
const { data: job, error: jobErr } = await db.from('quote_analysis_jobs').insert({
  org_id: orgId, unit_id: appt.unit_id, appointment_id: appt.id, status: 'running', stage: 'diagnosis', mode: 'shadow', idempotency_key: key0,
  locked_by: 'concurrency-test', locked_until: new Date(Date.now() + 10 * 60_000).toISOString(), budget_usd: 0.6,
}).select('*').single()
if (jobErr) throw new Error('Não criou job de teste: ' + jobErr.message)

try {
  const results = await Promise.all(Array.from({ length: 20 }, () => db.rpc('reserve_quote_budget', { p_job_id: job.id, p_amount: 0.1 })))
  const ids = results.map((r) => r.data).filter((v) => typeof v === 'string')
  console.log(`reservas aceitas: ${ids.length} de 20 (esperado 6)`)
  if (ids.length !== 6) fail(`aceitas = ${ids.length}`)
  if (new Set(ids).size !== ids.length) fail('ids de reserva repetidos')
  const { data: after } = await db.from('quote_analysis_jobs').select('reserved_usd, spent_usd, unconfirmed_usd').eq('id', job.id).single()
  console.log('baldes após reservas:', after)
  if (Math.abs(Number(after.reserved_usd) - 0.6) > 1e-6) fail('soma reservada != 0,60')

  const target = ids[0]
  const settles = await Promise.all(Array.from({ length: 10 }, () => db.rpc('settle_quote_budget', { p_reservation_id: target, p_actual: 0.03, p_tokens_in: 1, p_tokens_out: 1 })))
  const charged = settles.filter((r) => r.data === true).length
  console.log(`liquidações da MESMA reserva que cobraram: ${charged} de 10 (esperado 1)`)
  if (charged !== 1) fail(`cobranças = ${charged}`)
  const { data: end } = await db.from('quote_analysis_jobs').select('reserved_usd, spent_usd, unconfirmed_usd, ai_calls').eq('id', job.id).single()
  console.log('baldes finais:', end)
  if (Math.abs(Number(end.spent_usd) - 0.03) > 1e-6 || Number(end.ai_calls) !== 1) fail('cobrança duplicada ou contagem errada')
} finally {
  const { error } = await db.from('quote_analysis_jobs').delete().eq('id', job.id)
  console.log(error ? 'ATENÇÃO: apague manualmente o job de teste ' + job.id : 'job de teste apagado')
}
console.log(process.exitCode ? 'RESULTADO: FALHOU' : 'RESULTADO: OK')
