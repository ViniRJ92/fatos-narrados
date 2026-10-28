import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProposicao, claimedVote, checkMandato, CAMARA, SENADO, _resetCaches } from '../js/verify/politica.js';
import { verify, norm } from '../js/verify/engine.js';

// Respostas simuladas das APIs da Câmara e do Senado (mesmo formato das reais)
const FAKE = {
  [`${CAMARA}/proposicoes?siglaTipo=PEC&numero=45&ano=2019`]: { dados: [{ id: 1, siglaTipo: 'PEC', numero: 45, ano: 2019 }] },
  [`${CAMARA}/proposicoes/1`]: { dados: { ementa: 'Altera o Sistema Tributário Nacional.', statusProposicao: { descricaoSituacao: 'Transformado em Norma Jurídica', dataHora: '2023-12-15' } } },
  [`${CAMARA}/proposicoes/1/votacoes`]: { dados: [
    { id: '1-10', data: '2023-07-06', siglaOrgao: 'PLEN', aprovacao: 1, descricao: 'Aprovado, em primeiro turno, o Substitutivo. Sim: 382; não: 118.' },
    { id: '1-11', data: '2023-07-06', siglaOrgao: 'PLEN', aprovacao: 1, descricao: 'Aprovado o Requerimento de quebra de interstício.' },
    { id: '1-12', data: '2023-07-07', siglaOrgao: 'PLEN', aprovacao: 1, descricao: 'Aprovada, em segundo turno, a Proposta de Emenda à Constituição. Sim: 375.' },
  ] },
  [`${CAMARA}/votacoes/1-10/votos`]: { dados: [{ tipoVoto: 'Sim', deputado_: { nome: 'Fulana de Tal', siglaPartido: 'ABC' } }, { tipoVoto: 'Não', deputado_: { nome: 'Beltrano Silva', siglaPartido: 'XYZ' } }] },
  [`${CAMARA}/votacoes/1-12/votos`]: { dados: [{ tipoVoto: 'Sim', deputado_: { nome: 'Fulana de Tal', siglaPartido: 'ABC' } }, { tipoVoto: 'Sim', deputado_: { nome: 'Beltrano Silva', siglaPartido: 'XYZ' } }] },
  [`${CAMARA}/proposicoes/1/autores`]: { dados: [{ nome: 'Ciclano Souza' }] },
  [`${SENADO}/votacao?sigla=PEC&numero=45&ano=2019`]: [],
  [`${SENADO}/senador/lista/atual.json`]: { ListaParlamentarEmExercicio: { Parlamentares: { Parlamentar: [] } } },
};
const ctx = {
  getJSON: async url => {
    if (url.startsWith(`${CAMARA}/deputados?nome=`)) return url.includes("Fulana") ? { dados: [{ id: 9, nome: "Fulana de Tal", siglaPartido: "ABC", siglaUf: "SP", idLegislatura: 57 }] } : { dados: [] };
    if (url.startsWith(`${CAMARA}/deputados?idLegislatura=`)) return { dados: [{ id: 9, nome: 'Fulana de Tal', siglaPartido: 'ABC', siglaUf: 'SP' }], links: [] };
    if (!(url in FAKE)) throw new Error(`sem resposta simulada: ${url}`);
    return FAKE[url];
  },
  series: async () => { throw new Error(); }, spending: async () => { throw new Error(); },
  emendasMeta: async () => { throw new Error(); }, emendasYear: async () => [], today: new Date('2026-10-28'), camaraDelay: 0,
};

test('reconhece proposições em formatos comuns', () => {
  assert.deepEqual(parseProposicao('a PEC 45/2019'), { sigla: 'PEC', numero: 45, ano: 2019 });
  assert.deepEqual(parseProposicao('o PL nº 2.630 de 2020'), { sigla: 'PL', numero: 2630, ano: 2020 });
  assert.deepEqual(parseProposicao('a MP 1154/2023'), { sigla: 'MPV', numero: 1154, ano: 2023 });
  assert.equal(parseProposicao('inflação de 2020'), null);
});

test('reconhece o sentido do voto', () => {
  assert.equal(claimedVote(norm('votou a favor da PEC')), 'Sim');
  assert.equal(claimedVote(norm('votou contra o projeto')), 'Não');
  assert.equal(claimedVote(norm('se absteve')), 'Abstenção');
});

test('mandatos presidenciais', () => {
  assert.equal(checkMandato(norm('Temer assumiu em 2016')).status, 'verdadeiro');
  assert.equal(checkMandato(norm('Bolsonaro governou de 2017 a 2022')).status, 'falso');
  assert.equal(checkMandato(norm('Lula foi presidente de 2003 a 2010')).status, 'verdadeiro');
  assert.equal(checkMandato(norm('Lula foi presidente de 2003 a 2014')).status, 'falso');
  assert.equal(checkMandato(norm('Dilma sofreu impeachment em 2016')).status, 'verdadeiro');
  assert.equal(checkMandato(norm('Lula gosta de futebol')), null);
});

test('voto: usa só votações principais e compara com a alegação', async () => {
  _resetCaches();
  const a = await verify('A deputada Fulana de Tal votou a favor da PEC 45/2019.', ctx);
  assert.equal(a.results[0].status, 'verdadeiro');
  const b = await verify('O deputado Beltrano Silva votou contra a PEC 45/2019.', ctx);
  assert.equal(b.results[0].status, 'parcial'); // votou não no 1º turno e sim no 2º
  const c = await verify('O deputado Fulano Inexistente votou contra a PEC 45/2019.', ctx);
  assert.equal(c.results[0].status, 'nao-comprovado'); // nome não aparece nos votos: nunca vira "falso"
});

test('situação e autoria de proposição', async () => {
  _resetCaches();
  assert.equal((await verify('A PEC 45/2019 virou lei.', ctx)).results[0].status, 'verdadeiro');
  assert.equal((await verify('A PEC 45/2019 foi arquivada.', ctx)).results[0].status, 'falso');
  assert.equal((await verify('Ciclano Souza é autor da PEC 45/2019.', ctx)).results[0].status, 'verdadeiro');
  assert.equal((await verify('A deputada Fulana de Tal é autora da PEC 45/2019.', ctx)).results[0].status, 'falso');
});

test('partido conferido com a lista oficial', async () => {
  _resetCaches();
  assert.equal((await verify('A deputada Fulana de Tal é do ABC.', ctx)).results[0].status, 'verdadeiro');
  assert.equal((await verify('A deputada Fulana de Tal é do XYZ.', ctx)).results[0].status, 'falso');
});

test('API fora do ar não vira falso', async () => {
  _resetCaches();
  const r = await verify('A deputada Fulana de Tal votou a favor do PL 9999/2024.', { ...ctx, getJSON: async () => { throw new Error('fora do ar'); } });
  assert.equal(r.results[0].status, 'nao-comprovado');
});
