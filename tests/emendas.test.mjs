import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandYear, applyFilters, summarize, groupBy, anoDoId, FLAG } from '../js/data/emendas-model.js';
import { pagoTotal, naoPago, situacao } from '../js/data/emendas-catalog.js';

// Arquivo de ano sintético no mesmo formato de data/emendas/ano-AAAA.json
const doc = {
  ano: '2025',
  tipos: ['Emenda Individual - Transferências com Finalidade Definida', 'Emenda Individual - Transferências Especiais', 'Emenda de Bancada', 'Emenda de Comissão', 'Emenda de Relator'],
  loc: ['FERREIRA GOMES - AP', 'SÃO PAULO (UF)', 'MÚLTIPLO', 'CAMPINAS - SP'],
  func: { 10: 'Saúde', 12: 'Educação' }, subf: { 301: 'Atenção básica', 361: 'Ensino fundamental' },
  prog: { 5018: 'Atenção Primária' }, acao: { '2E89': 'Incremento' }, po: {},
  favs: [['11111111000111', 'MUNICIPIO DE FERREIRA GOMES', 'Pessoa Jurídica', 'AP', 'FERREIRA GOMES'], [null, 'Pessoas físicas (identificação omitida)', 'Pessoa Física', 'SP', 'CAMPINAS']],
  rows: [
    // [id, tipoIdx, autorIdx, numero, v, flags, parts, favIdx, recebido, primeiro, ultimo, nConv]
    ['202511110001', 0, 1, '0001', [1000, 800, 700, 300, 0, 200], 0, [[0, '1600303', 'AP', '10', '301', '5018', '2E89', '0000', [1000, 800, 700, 300, 0, 200]]], [0], 900, '202503', '202602', 1],
    ['202511110002', 1, 1, '0002', [500, 500, 500, 0, 0, 0], 0, [[1, null, 'SP', '12', '361', '5018', '2E89', '0000', [500, 500, 500, 0, 0, 0]]], [], 0, null, null, 0],
    ['SI-2025-abc', 2, 0, null, [400, 0, 0, 400, 400, 0], FLAG.SEM_CODIGO | FLAG.SEM_AUTOR, [[3, '3509502', 'SP', '12', '361', '5018', '2E89', '0000', [400, 0, 0, 400, 400, 0]]], [1], 50, '202505', '202505', 0],
  ],
};
const autores = [['S/I', 'Sem informação', null, [], [], 'sem-autor'], ['1111', 'FULANA DE TAL', 'Câmara', ['ABC'], ['AP'], 'nome']];
const list = expandYear(doc, autores);

test('pago total soma restos a pagar pagos; não pago não usa restos inscritos', () => {
  assert.equal(pagoTotal([1000, 800, 700, 300, 0, 200]), 900);
  assert.equal(naoPago([1000, 800, 700, 300, 0, 200]), 100);
  assert.equal(naoPago([400, 0, 0, 400, 400, 0]), 0);
  assert.equal(situacao([400, 0, 0, 400, 400, 0]), 'cancelada');
  assert.equal(situacao([1000, 800, 700, 300, 0, 200]), 'paga-parcialmente');
});

test('ano é deduzido do identificador', () => {
  assert.equal(anoDoId('202538970001'), '2025');
  assert.equal(anoDoId('SI-2014-abcdef'), '2014');
  assert.equal(anoDoId('xyz'), null);
});

test('filtros combinados', () => {
  assert.equal(applyFilters(list, { autor: 'fulana' }).length, 2);
  assert.equal(applyFilters(list, { uf: 'SP' }).length, 2);
  assert.equal(applyFilters(list, { uf: 'SP', autor: 'fulana' }).length, 1);
  assert.equal(applyFilters(list, { municipio: 'campinas' }).length, 1);
  assert.equal(applyFilters(list, { numero: '202511110002' })[0].id, '202511110002');
  assert.equal(applyFilters(list, { numero: '1' })[0].id, '202511110001');
  assert.equal(applyFilters(list, { tipo: 'Emenda de Bancada' }).length, 1);
  assert.equal(applyFilters(list, { funcao: 'Saúde' }).length, 1);
  assert.equal(applyFilters(list, { cnpj: '11.111.111/0001-11' }).length, 1);
  assert.equal(applyFilters(list, { beneficiario: 'ferreira' }).length, 1);
  assert.equal(applyFilters(list, { situacao: 'paga' }).length, 1);
  assert.equal(applyFilters(list, { min: '600' }).length, 1);
  assert.equal(applyFilters(list, { max: '450' }).length, 1);
  assert.equal(applyFilters(list, { pagDe: '2026-01' }).length, 1);
  assert.equal(applyFilters(list, { doc: 'convenio' }).length, 1);
  assert.equal(applyFilters(list, { doc: 'pix' }).length, 1);
  assert.equal(applyFilters(list, { transp: 'incompleta' }).length, 1);
  assert.equal(applyFilters(list, { casa: 'nao-identificada' }).length, 1);
  assert.equal(applyFilters(list, { partido: 'ABC' }).length, 2);
  assert.equal(applyFilters(list, { q: 'atencao primaria saude' }).length, 1);
  assert.equal(applyFilters(list, { instrumento: '123', instrumentoIds: new Set(['202511110002']) }).length, 1);
});

test('totais sem dupla contagem: recebimentos não somam e a mesma emenda não entra duas vezes', () => {
  const t = summarize([...list, list[0]]);
  assert.equal(t.n, 3);
  assert.equal(t.emp, 1900);
  assert.equal(t.pago, 900 + 500);
  assert.equal(t.recebido, 950); // informativo, fora dos totais de execução
  assert.equal(t.nMunicipios, 2);
  assert.equal(t.nFavs, 2);
  assert.equal(t.incompletas, 1);
});

test('agrupamento por UF reparte pelas partes e separa destinos sem UF', () => {
  const g = Object.fromEntries(groupBy(list, 'uf').map(x => [x.key, x]));
  assert.equal(g.AP.emp, 1000);
  assert.equal(g.SP.emp, 900);
  assert.equal(g.SP.n, 2);
});
