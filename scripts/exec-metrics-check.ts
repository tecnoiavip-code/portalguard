import { computeExecutiveMetrics, previousRangeOf, resolveRange, categorizeIncident, formatHoursToBR, formatMinutesToBR, formatPercent } from '../src/lib/executive-metrics';

const NOW = new Date('2026-09-28T15:00:00');
const day = (offset: number, hour: number, minute = 0) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - offset);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

const entries = [
  // pico 11h
  { id: '1', visitor_name: 'A', visitor_type: 'visitor', apartment: '101', entry_time: day(0, 11), exit_time: day(0, 12) },
  { id: '2', visitor_name: 'B', visitor_type: 'visitor', apartment: '101', entry_time: day(0, 11, 30), exit_time: day(0, 11, 45) },
  // entregador 60min (viola 45min)
  { id: '3', visitor_name: 'C', visitor_type: 'delivery', apartment: '202', entry_time: day(0, 12), exit_time: day(0, 13) },
  // prestador 300min (viola 4h)
  { id: '4', visitor_name: 'D', visitor_type: 'service_provider', apartment: '202', entry_time: day(1, 9), exit_time: day(1, 14) },
  // prestador ok
  { id: '5', visitor_name: 'E', visitor_type: 'service_provider', apartment: '303', entry_time: day(1, 10), exit_time: day(1, 11) },
  // período anterior
  { id: '6', visitor_name: 'F', visitor_type: 'visitor', apartment: '101', entry_time: day(40, 11), exit_time: day(40, 12) },
  // sem apartment/resident
  { id: '7', visitor_name: 'G', visitor_type: 'delivery', entry_time: day(2, 18), exit_time: day(2, 19) },
];

const mails = [
  { id: 'm1', resident_id: 'r1', sender: 'Mercado Livre', received_at: day(0, 10), delivered_at: day(0, 14), status: 'delivered' },
  { id: 'm2', resident_id: 'r1', sender: 'Amazon Envios', received_at: day(1, 9), delivered_at: day(1, 12), status: 'delivered' },
  { id: 'm3', resident_id: 'r2', sender: 'Correios - SEDEX', received_at: day(3, 8), status: 'pending' },
  { id: 'm4', resident_id: 'r2', sender: 'Shopee', received_at: day(5, 8), status: 'pending' },
];

const incidents = [
  { id: 'i1', title: 'Barulho após as 22h', severity: 'medium', status: 'resolved', created_at: day(1, 23), resolved_at: day(1, 23), apartment: '101' },
  { id: 'i2', title: 'Vaga de garagem obstruida', severity: 'critical', status: 'open', created_at: day(0, 10), apartment: '202' },
  { id: 'i3', title: 'Lampada queimada no hall', severity: 'low', status: 'closed', created_at: day(4, 15), apartment: '303' },
  { id: 'i4', title: 'Briga entre vizinhos', severity: 'high', status: 'open', created_at: day(2, 20), apartment: '101' },
];

const residents = [
  { id: 'r1', name: 'Ana Silva', apartment: '101' },
  { id: 'r2', name: 'Bruno Costa', apartment: '202' },
];

const period = { from: new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - 29), to: NOW };
const m = computeExecutiveMetrics({ entries: entries as any, mails: mails as any, incidents: incidents as any, residents, period, previousPeriod: previousRangeOf(period), now: NOW });

const assert = (label: string, cond: boolean, actual?: unknown) => {
  console.log(`${cond ? 'OK  ' : 'FALHA'} ${label}${cond ? '' : ` -> ${JSON.stringify(actual)}`}`);
  if (!cond) process.exitCode = 1;
};

assert('total de acessos no periodo = 6', m.totalAccess === 6, m.totalAccess);
assert('composicao visitante=2', m.composition.visitor === 2, m.composition.visitor);
assert('composicao entregador=2', m.composition.delivery === 2, m.composition.delivery);
assert('composicao prestador=2', m.composition.service_provider === 2, m.composition.service_provider);
assert('acesso sem apartment nao quebra', m.composition.total === 6, m.composition.total);
assert('media diaria de externos = 6/30', Math.abs(m.externalDailyAvg - 0.2) < 0.001, m.externalDailyAvg);
assert('media entregadores = 60min', m.stay.avgDeliveryMinutes === 60, m.stay.avgDeliveryMinutes);
assert('media prestadores = 180min', m.stay.avgServiceProviderMinutes === 180, m.stay.avgServiceProviderMinutes);
assert('entregador acima de 45min = 2', m.stay.deliveryOver45 === 2, m.stay.deliveryOver45);
assert('prestador acima de 4h = 1', m.stay.serviceProviderOver4h === 1, m.stay.serviceProviderOver4h);
assert('violacoes >= 3', m.stay.violations >= 3, m.stay.violations);
assert('encomendas recebidas no periodo = 4', m.mails.received === 4, m.mails.received);
assert('encomendas entregues = 2', m.mails.delivered === 2, m.mails.delivered);
assert('pendentes = 2', m.mails.pending === 2, m.mails.pending);
assert('pendentes >48h = 2', m.mails.pendingOver48h === 2, m.mails.pendingOver48h);
assert('retencao media = 3.5h', Math.abs(m.mails.avgRetentionHours - 3.5) < 0.1, m.mails.avgRetentionHours);
assert('transportadoras agregadas', m.mails.topCarriers.length >= 3, m.mails.topCarriers.map((c) => c.name));
assert('Mercado Livre agrupado', m.mails.topCarriers.find((c) => c.name === 'Mercado Livre')?.count === 1);
assert('Correios agrupado', m.mails.topCarriers.some((c) => c.name === 'Correios'), m.mails.topCarriers.map((c) => c.name));
assert('ocorrencias = 4', m.incidents.total === 4, m.incidents.total);
assert('resolvidas = 2', m.incidents.resolved === 2, m.incidents.resolved);
assert('taxa de resolucao = 50%', Math.abs(m.incidents.resolutionRate - 50) < 0.1, m.incidents.resolutionRate);
assert('em aberto = 2', m.incidents.open === 2, m.incidents.open);
assert('criticas em aberto listadas = 2', m.incidents.criticalList.length === 2, m.incidents.criticalList.length);
assert('severidade soma = 4', m.incidents.bySeverity.reduce((s, i) => s + i.value, 0) === 4, m.incidents.bySeverity);
assert('categorias: garagem detectada', m.incidents.byCategory.some((c) => c.name === 'Vagas de Garagem'), m.incidents.byCategory);
assert('categorias: convivencia detectada', m.incidents.byCategory.some((c) => c.name === 'Barulho / Convivência'), m.incidents.byCategory);
assert('series horarias = 24 buckets', m.hourly.length === 24);
assert('pico as 11h', m.hourly[11].Visitantes === 2, m.hourly[11]);
assert('dia da semana = 7 buckets', m.weekday.length === 7);
assert('top unidades limitado a 10', m.topUnits.length <= 10, m.topUnits.length);
assert('unidade 101 no ranking', m.topUnits.some((u) => u.apartment === '101'), m.topUnits);
assert('encomendas entram no total da unidade', (m.topUnits.find((u) => u.apartment === '101')?.total ?? 0) >= 4, m.topUnits);
assert('serie diaria de encomendas preenchida', m.daily.length >= 4, m.daily.length);
assert('dias no periodo = 30', m.daysInPeriod === 30, m.daysInPeriod);
const prev = computeExecutiveMetrics({ entries: entries as any, mails: [] as any, incidents: [] as any, residents, period, previousPeriod: previousRangeOf(period), now: NOW });
assert('periodo anterior抓到 1 acesso', prev.compositionPrevious.total === 1, prev.compositionPrevious.total);
assert('delta positivo', m.totalAccessDelta !== null && m.totalAccessDelta > 0, m.totalAccessDelta);
assert('delta nulo quando base zero', (() => {
  const empty = computeExecutiveMetrics({ entries: [] as any, mails: [] as any, incidents: [] as any, residents, period, previousPeriod: previousRangeOf(period), now: NOW });
  return empty.totalAccessDelta === 0 && empty.incidents.total === 0 && empty.hourly.every((h) => h.Visitantes === 0);
})());

assert('formatHoursToBR 0.5h = 30min', formatHoursToBR(0.5) === '30min', formatHoursToBR(0.5));
assert('formatHoursToBR 4.5h', formatHoursToBR(4.5) === '4,5h', formatHoursToBR(4.5));
assert('formatMinutesToBR 150', formatMinutesToBR(150) === '2h 30min', formatMinutesToBR(150));
assert('formatMinutesToBR 0', formatMinutesToBR(0) === '—', formatMinutesToBR(0));
assert('formatPercent +8.3', formatPercent(8.25) === '+8,3%', formatPercent(8.25));
assert('formatPercent null', formatPercent(null) === '—');
assert('categorizeIncident fallback', categorizeIncident({ id: 'x', title: 'Assunto sem palavra-chave', severity: 'low' } as any) === 'Outros', categorizeIncident({ id: 'x', title: 'Assunto sem palavra-chave', severity: 'low' } as any));
assert('categorizeIncident nao casa "palavra-chave" com portaria', categorizeIncident({ id: 'x', title: 'Problema na palavra-chave do cadastro', severity: 'low' } as any) === 'Outros', categorizeIncident({ id: 'x', title: 'Problema na palavra-chave do cadastro', severity: 'low' } as any));
assert('resolveRange 7d cobre 7 dias', (() => { const r = resolveRange('7d'); return Math.round((r.to.getTime() - r.from.getTime()) / 86400000) === 7; })());
assert('resolveRange custom invalido cai em 30d', (() => { const r = resolveRange('custom', { from: '2026-10-10', to: '2026-10-01' }); return r.from <= r.to && Math.round((r.to.getTime() - r.from.getTime()) / 86400000) === 30; })());
assert('previousRangeOf anterior ao periodo', previousRangeOf(period).to.getTime() < period.from.getTime());

console.log('\nConcluido.');
