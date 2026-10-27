/**
 * Mandatos presidenciais desde a redemocratização.
 *
 * Datas de posse/afastamento conforme registros oficiais da Presidência da República
 * e do Congresso Nacional. "end" é o último dia no cargo (inclusive).
 * Mandatos interinos são registrados junto ao mandato que se seguiu, com nota.
 *
 * Regra de atribuição (ver metodologia.html):
 *  - Mês: pertence ao governo que estava no cargo no ÚLTIMO dia do mês.
 *  - Trimestre: pertence ao governo no cargo no último dia do trimestre.
 *  - Ano: pertence ao governo no cargo em 31 de dezembro.
 */
export const GOVERNMENTS = [
  { id: 'sarney', name: 'José Sarney', short: 'Sarney', start: '1985-03-15', end: '1990-03-14',
    note: 'Assumiu como vice após a morte de Tancredo Neves (eleito indiretamente).' },
  { id: 'collor', name: 'Fernando Collor', short: 'Collor', start: '1990-03-15', end: '1992-10-01',
    note: 'Afastado em 02/10/1992 pela abertura do processo de impeachment; renunciou em 29/12/1992.' },
  { id: 'itamar', name: 'Itamar Franco', short: 'Itamar', start: '1992-10-02', end: '1994-12-31',
    note: 'Interino de 02/10 a 29/12/1992; efetivado após a renúncia de Collor. Plano Real em 07/1994.' },
  { id: 'fhc1', name: 'Fernando Henrique Cardoso (1º mandato)', short: 'FHC 1', start: '1995-01-01', end: '1998-12-31' },
  { id: 'fhc2', name: 'Fernando Henrique Cardoso (2º mandato)', short: 'FHC 2', start: '1999-01-01', end: '2002-12-31' },
  { id: 'lula1', name: 'Luiz Inácio Lula da Silva (1º mandato)', short: 'Lula 1', start: '2003-01-01', end: '2006-12-31' },
  { id: 'lula2', name: 'Luiz Inácio Lula da Silva (2º mandato)', short: 'Lula 2', start: '2007-01-01', end: '2010-12-31' },
  { id: 'dilma1', name: 'Dilma Rousseff (1º mandato)', short: 'Dilma 1', start: '2011-01-01', end: '2014-12-31' },
  { id: 'dilma2', name: 'Dilma Rousseff (2º mandato)', short: 'Dilma 2', start: '2015-01-01', end: '2016-05-11',
    note: 'Afastada em 12/05/2016 pela instauração do processo de impeachment no Senado; cassada em 31/08/2016.' },
  { id: 'temer', name: 'Michel Temer', short: 'Temer', start: '2016-05-12', end: '2018-12-31',
    note: 'Interino de 12/05 a 31/08/2016; efetivado após o impeachment.' },
  { id: 'bolsonaro', name: 'Jair Bolsonaro', short: 'Bolsonaro', start: '2019-01-01', end: '2022-12-31' },
  { id: 'lula3', name: 'Luiz Inácio Lula da Silva (3º mandato)', short: 'Lula 3', start: '2023-01-01', end: null,
    note: 'Mandato em curso. Pela EC 111/2021, o próximo mandato presidencial começa em 05/01/2027.' },
];

const lastDayOfMonth = (y, m) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

/** Data de referência (YYYY-MM-DD) usada para atribuir uma observação a um governo. */
export function referenceDate(period) {
  if (/^\d{4}$/.test(period)) return `${period}-12-31`;
  const [y, m] = period.split('-').map(Number);
  return lastDayOfMonth(y, m);
}

export function governmentAt(isoDate) {
  return GOVERNMENTS.find(g => isoDate >= g.start && (g.end === null || isoDate <= g.end)) || null;
}

export function governmentForPeriod(period) {
  return governmentAt(referenceDate(period));
}

export const governmentById = id => GOVERNMENTS.find(g => g.id === id);

/** Primeiro e último período mensal ("YYYY-MM") atribuídos ao governo. */
export function monthRange(gov, today = new Date().toISOString().slice(0, 10)) {
  const end = gov.end || today;
  const months = [];
  let [y, m] = gov.start.slice(0, 7).split('-').map(Number);
  // retrocede um mês para garantir que o mês de posse seja avaliado
  for (;;) {
    const p = `${y}-${String(m).padStart(2, '0')}`;
    const ref = referenceDate(p);
    if (ref > lastDayOfMonth(+end.slice(0, 4), +end.slice(5, 7))) break;
    if (governmentAt(ref)?.id === gov.id) months.push(p);
    m++; if (m > 12) { m = 1; y++; }
  }
  return { first: months[0], last: months[months.length - 1], months };
}
