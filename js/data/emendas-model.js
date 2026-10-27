/**
 * Modelo das emendas parlamentares: transforma os arquivos compactos de data/emendas
 * em registros, aplica filtros e calcula totais. Funções puras (sem DOM), testadas em tests/.
 */
import { TIPOS, V, pagoTotal, naoPago, situacao } from './emendas-catalog.js';

export const FLAG = { SEM_CODIGO: 1, SEM_AUTOR: 2, PARTE_DUPLICADA: 4, VALORES_INCONSISTENTES: 8, LOCAL_SEM_INFO: 16, SO_RECEBIMENTOS: 32 };
export const FLAG_LABEL = {
  1: 'Sem código de emenda na base',
  2: 'Autor não identificado na base',
  4: 'Linha repetida na base de origem',
  8: 'Liquidado ou pago maior que o empenhado',
  16: 'Localidade sem informação',
  32: 'Conhecida só pelo arquivo de recebimentos (sem execução orçamentária registrada)',
};
export const INCOMPLETA = FLAG.SEM_CODIGO | FLAG.SEM_AUTOR | FLAG.VALORES_INCONSISTENTES | FLAG.SO_RECEBIMENTOS;

export const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Ano de uma emenda a partir do identificador (código CGU de 12 dígitos ou SI-AAAA-hash). */
export function anoDoId(id) {
  const s = String(id || '');
  if (/^\d{12}$/.test(s)) return s.slice(0, 4);
  const m = s.match(/^SI-(\d{4})-/);
  return m ? m[1] : null;
}

/** Converte um arquivo ano-AAAA.json em registros. `autores` vem de meta.json. */
export function expandYear(doc, autores) {
  return doc.rows.map(r => {
    const [id, tipoIdx, autorIdx, numero, v, flags, parts, favIdx, recebido, primeiro, ultimo, nConv] = r;
    const tipo = doc.tipos[tipoIdx] || 'Tipo não informado';
    const a = autores[autorIdx] || [];
    const ps = parts.map(p => ({
      loc: doc.loc[p[0]], ibge: p[1], uf: p[2], func: p[3], funcName: doc.func[p[3]], subf: p[4], subfName: doc.subf[p[4]],
      prog: p[5], progName: doc.prog[p[5]], acao: p[6], acaoName: doc.acao[p[6]], po: p[7], poName: doc.po[`${p[6]}.${p[7]}`], v: p[8],
    }));
    const e = {
      id, ano: doc.ano, tipo, tipoShort: TIPOS[tipo]?.short || tipo, grupo: TIPOS[tipo]?.group || 'outro',
      autorIdx, autor: { code: a[0], nome: a[1], casa: a[2], partidos: a[3] || [], ufs: a[4] || [], match: a[5] },
      numero, v, flags, parts: ps, favIdx, recebido, primeiro, ultimo, nConv,
      pago: pagoTotal(v), naoPago: naoPago(v), situacao: situacao(v),
      ufs: [...new Set(ps.map(p => p.uf).filter(Boolean))],
      municipios: [...new Set(ps.filter(p => p.ibge).map(p => p.loc))],
      ibges: [...new Set(ps.map(p => p.ibge).filter(Boolean))],
      funcs: [...new Set(ps.map(p => p.funcName).filter(Boolean))],
      progs: [...new Set(ps.map(p => p.prog))],
      favs: doc.favs,
    };
    e.text = norm([id, numero, a[1], tipo, ...ps.map(p => `${p.loc} ${p.funcName} ${p.subfName} ${p.progName} ${p.acaoName} ${p.poName}`)].join(' '));
    return e;
  });
}

/** Aplica os filtros combinados. Campos vazios são ignorados. */
export function applyFilters(list, f) {
  const q = f.q ? norm(f.q).split(/\s+/).filter(Boolean) : [];
  const autor = f.autor ? norm(f.autor) : '';
  const mun = f.municipio ? norm(f.municipio) : '';
  const num = f.numero ? f.numero.replace(/\D/g, '') : '';
  const benef = f.beneficiario ? norm(f.beneficiario) : '';
  const cnpj = f.cnpj ? f.cnpj.replace(/\D/g, '') : '';
  const min = f.min !== '' && f.min != null ? Number(f.min) : null;
  const max = f.max !== '' && f.max != null ? Number(f.max) : null;
  const pagDe = f.pagDe ? f.pagDe.replace('-', '') : '';
  const pagAte = f.pagAte ? f.pagAte.replace('-', '') : '';
  return list.filter(e => {
    if (q.length && !q.every(t => e.text.includes(t))) return false;
    if (autor && !norm(e.autor.nome).includes(autor)) return false;
    if (f.casa && (f.casa === 'nao-identificada' ? e.autor.casa : !String(e.autor.casa || '').split('/').includes(f.casa))) return false;
    if (f.partido && !e.autor.partidos.includes(f.partido)) return false;
    if (f.uf && !e.ufs.includes(f.uf)) return false;
    if (mun && !e.municipios.some(m => norm(m).includes(mun))) return false;
    if (f.tipo && e.tipo !== f.tipo) return false;
    if (num && !(e.id.includes(num) || (num.length <= 4 && e.numero === num.padStart(4, '0')))) return false;
    if (f.instrumento && !(f.instrumentoIds && f.instrumentoIds.has(e.id))) return false;
    if (f.programa && !e.progs.includes(f.programa)) return false;
    if (f.funcao && !e.funcs.includes(f.funcao)) return false;
    if (benef && !e.favIdx.some(i => norm(e.favs[i]?.[1]).includes(benef))) return false;
    if (cnpj && !e.favIdx.some(i => String(e.favs[i]?.[0] || '').includes(cnpj))) return false;
    if (f.situacao && e.situacao !== f.situacao) return false;
    if (min != null && e.v[V.EMP] < min) return false;
    if (max != null && e.v[V.EMP] > max) return false;
    if (pagDe && (!e.ultimo || e.ultimo < pagDe)) return false;
    if (pagAte && (!e.primeiro || e.primeiro > pagAte)) return false;
    if (f.doc === 'convenio' && !e.nConv) return false;
    if (f.doc === 'pix' && e.grupo !== 'pix') return false;
    if (f.doc === 'nenhum' && (e.nConv || e.grupo === 'pix')) return false;
    if (f.transp === 'incompleta' && !(e.flags & INCOMPLETA)) return false;
    if (f.transp && f.transp.startsWith('flag-') && !(e.flags & Number(f.transp.slice(5)))) return false;
    return true;
  });
}

/**
 * Totais de um conjunto de emendas. Somam-se apenas valores de execução orçamentária
 * da base de emendas; recebimentos por favorecido e convênios ficam de fora (mesmo dinheiro).
 */
export function summarize(list) {
  const t = { n: 0, emp: 0, liq: 0, pago: 0, naoPago: 0, rapCanc: 0, recebido: 0, favs: new Set(), municipios: new Set(), incompletas: 0, soRecebimentos: 0, anos: new Set() };
  const seen = new Set();
  for (const e of list) {
    const key = `${e.ano}|${e.id}`;
    if (seen.has(key)) continue; // a mesma emenda nunca entra duas vezes
    seen.add(key);
    t.n++;
    t.anos.add(e.ano);
    t.emp += e.v[V.EMP]; t.liq += e.v[V.LIQ]; t.pago += e.pago; t.naoPago += e.naoPago; t.rapCanc += e.v[V.RAP_CANC];
    t.recebido += e.recebido || 0;
    for (const i of e.favIdx) t.favs.add(`${e.ano}|${e.favs[i]?.[0] ?? `pf:${i}`}`);
    for (const c of e.ibges) t.municipios.add(c);
    if (e.flags & INCOMPLETA) t.incompletas++;
    if (e.flags & FLAG.SO_RECEBIMENTOS) t.soRecebimentos++;
  }
  // beneficiários: CNPJ/código distinto (pessoas físicas contam por município, pois a identificação é omitida)
  t.nFavs = new Set([...t.favs].map(k => k.split('|')[1])).size;
  t.nMunicipios = t.municipios.size;
  return t;
}

/** Agrupa por dimensão, repartindo valores pelas partes quando a dimensão é geográfica ou de área. */
export function groupBy(list, dim) {
  const g = new Map();
  const add = (k, label, emp, pago, e) => {
    if (k == null) return;
    let x = g.get(k);
    if (!x) { x = { key: k, label, emp: 0, pago: 0, ids: new Set(), favs: new Set() }; g.set(k, x); }
    x.emp += emp; x.pago += pago; x.ids.add(`${e.ano}|${e.id}`);
    for (const i of e.favIdx) x.favs.add(`${e.ano}|${e.favs[i]?.[0] ?? i}`);
  };
  for (const e of list) {
    if (dim === 'autor') add(e.autorIdx, e.autor.nome, e.v[V.EMP], e.pago, e);
    else if (dim === 'ano') add(e.ano, e.ano, e.v[V.EMP], e.pago, e);
    else if (dim === 'tipo') add(e.tipo, e.tipoShort, e.v[V.EMP], e.pago, e);
    else for (const p of e.parts) {
      const pago = p.v[V.PAGO] + p.v[V.RAP_PAGO];
      if (dim === 'uf') add(p.uf || 'sem-uf', p.uf || 'Sem UF (nacional ou múltiplo)', p.v[V.EMP], pago, e);
      else if (dim === 'municipio') add(p.ibge, p.loc, p.v[V.EMP], pago, e);
      else if (dim === 'funcao') add(p.funcName || p.func, p.funcName || p.func, p.v[V.EMP], pago, e);
    }
  }
  return [...g.values()].map(x => ({ ...x, n: x.ids.size, nFavs: x.favs.size, pctPago: x.emp > 0 ? (x.pago / x.emp) * 100 : null }));
}
