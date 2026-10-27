/**
 * Catálogo de indicadores — fonte única da verdade.
 *
 * Usado pelo site (para exibir) e por scripts/update-data.mjs (para buscar nas APIs oficiais).
 * Todo código de série/tabela abaixo foi conferido nos metadados oficiais
 * (dadosabertos.bcb.gov.br e servicodados.ibge.gov.br/api/v3/agregados/{id}/metadados).
 *
 * fetch.kind:
 *   'bcb'    → API SGS do Banco Central: api.bcb.gov.br/dados/serie/bcdata.sgs.{code}/dados
 *   'sidra'  → API SIDRA do IBGE: apisidra.ibge.gov.br/values{path}
 *   'sidra-chain' → mesma variável/categoria em tabelas sucessivas do IBGE (séries com troca de tabela)
 *   'derived' → calculado a partir de outro indicador do catálogo (op documentada)
 */

export const TOPICS = {
  'contas-publicas': { title: 'Contas públicas', desc: 'Dívida, resultado primário, juros e gastos por área.' },
  'custo-de-vida': { title: 'Inflação e custo de vida', desc: 'IPCA geral, alimentos, combustíveis, energia e serviços.' },
  'emprego-renda': { title: 'Emprego e renda', desc: 'Desocupação e rendimento real do trabalho (PNAD Contínua).' },
  'atividade': { title: 'Atividade econômica', desc: 'PIB e indicadores de atividade.' },
  'juros-cambio': { title: 'Juros e câmbio', desc: 'Selic e dólar.' },
  'comercio-exterior': { title: 'Comércio exterior', desc: 'Exportações, importações e saldo da balança.' },
};

export const SOURCE_ORGS = {
  ibge: { name: 'IBGE', full: 'Instituto Brasileiro de Geografia e Estatística', url: 'https://www.ibge.gov.br/' },
  bcb: { name: 'Banco Central do Brasil', full: 'Banco Central do Brasil — Sistema Gerenciador de Séries Temporais (SGS)', url: 'https://www3.bcb.gov.br/sgspub/' },
  tesouro: { name: 'Tesouro Nacional', full: 'Secretaria do Tesouro Nacional — SICONFI', url: 'https://siconfi.tesouro.gov.br/' },
};

const sgsUrl = code => `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados?formato=json`;
// Página pública do SGS: o usuário pesquisa pelo código. Não há URL estável por série, por isso o link é a própria API.
const sgsPage = code => sgsUrl(code);
const sidraTable = t => `https://sidra.ibge.gov.br/tabela/${t}`;

const ipcaItem = (id, title, cat, extra = {}) => ({
  id, title: `IPCA — ${title}`, short: title, topic: 'custo-de-vida', unit: '%', decimals: 2, freq: 'M',
  org: 'ibge', display: 'acc12',
  description: `Variação de preços de "${title}" medida pelo IPCA. Exibida como variação acumulada em 12 meses; a série mensal é armazenada para cálculos por período.`,
  notes: 'Encadeia as tabelas 2938 (jul/2006–dez/2011), 1419 (2012–2019) e 7060 (desde 2020) do IBGE, que mantêm o mesmo código de subitem (classificação 315). O IPCA mede variação de preço, não o preço em reais.',
  fetch: { kind: 'sidra-chain', variable: 63, classification: 315, category: cat, tables: [2938, 1419, 7060] },
  links: [sidraTable(7060), sidraTable(1419), sidraTable(2938)],
  ...extra,
});

export const INDICATORS = [
  // ---------- Inflação ----------
  {
    id: 'ipca-12m', title: 'IPCA — inflação acumulada em 12 meses', short: 'Inflação (IPCA 12 meses)',
    topic: 'custo-de-vida', unit: '%', decimals: 2, freq: 'M', org: 'ibge', featured: true, startFrom: '1995-01',
    description: 'Índice oficial de inflação do país, usado como referência para o regime de metas de inflação.',
    notes: 'Tabela 1737 do SIDRA, variável 2265. Antes do Plano Real (jul/1994) os valores refletem hiperinflação.',
    fetch: { kind: 'sidra', path: '/t/1737/n1/all/v/2265/p/all' },
    links: [sidraTable(1737)],
  },
  {
    id: 'ipca-mensal', title: 'IPCA — variação mensal', short: 'IPCA mensal',
    topic: 'custo-de-vida', unit: '%', decimals: 2, freq: 'M', org: 'ibge', startFrom: '1995-01',
    description: 'Variação mensal do IPCA. Base para calcular a inflação acumulada em qualquer período.',
    notes: 'Tabela 1737 do SIDRA, variável 63.',
    fetch: { kind: 'sidra', path: '/t/1737/n1/all/v/63/p/all' },
    links: [sidraTable(1737)],
  },
  ipcaItem('ipca-alimentacao-domicilio', 'Alimentação no domicílio', 7171, { featured: true }),
  ipcaItem('ipca-arroz', 'Arroz', 7173),
  ipcaItem('ipca-carnes', 'Carnes', 7283),
  ipcaItem('ipca-cafe', 'Café moído', 7392),
  ipcaItem('ipca-gasolina', 'Gasolina', 7657, { featured: true }),
  ipcaItem('ipca-diesel', 'Óleo diesel', 7659),
  ipcaItem('ipca-etanol', 'Etanol', 7658),
  ipcaItem('ipca-gas-botijao', 'Gás de botijão', 7482),
  ipcaItem('ipca-energia', 'Energia elétrica residencial', 7485),
  ipcaItem('ipca-aluguel', 'Aluguel residencial', 7448),
  ipcaItem('ipca-plano-saude', 'Plano de saúde', 7696),
  ipcaItem('ipca-onibus', 'Ônibus urbano', 7628),

  // ---------- Emprego e renda ----------
  {
    id: 'desocupacao', title: 'Taxa de desocupação', short: 'Desemprego',
    topic: 'emprego-renda', unit: '%', decimals: 1, freq: 'M', org: 'ibge', featured: true,
    description: 'Percentual da força de trabalho que procurou emprego e não encontrou (PNAD Contínua, trimestre móvel).',
    notes: 'Tabela 6381 do SIDRA, variável 4099. Cada ponto é um trimestre móvel; o mês indicado é o último do trimestre. Série começa em 2012 — não há dado comparável da PNAD Contínua para períodos anteriores.',
    fetch: { kind: 'sidra', path: '/t/6381/n1/all/v/4099/p/all' },
    links: [sidraTable(6381)],
  },
  {
    id: 'rendimento-real', title: 'Rendimento médio real habitual do trabalho', short: 'Renda média real',
    topic: 'emprego-renda', unit: 'R$', decimals: 0, freq: 'M', org: 'ibge', featured: true,
    description: 'Rendimento médio mensal real, habitualmente recebido em todos os trabalhos, pessoas de 14 anos ou mais ocupadas.',
    notes: 'Tabela 6390 do SIDRA, variável 5933. Valores a preços do último trimestre divulgado (deflacionados pelo IBGE). Trimestre móvel.',
    fetch: { kind: 'sidra', path: '/t/6390/n1/all/v/5933/p/all' },
    links: [sidraTable(6390)],
  },

  // ---------- Atividade ----------
  {
    id: 'pib-4t', title: 'PIB — crescimento acumulado em 4 trimestres', short: 'PIB (4 trimestres)',
    topic: 'atividade', unit: '%', decimals: 1, freq: 'Q', org: 'ibge', featured: true,
    description: 'Variação real do PIB nos últimos quatro trimestres contra os quatro trimestres anteriores.',
    notes: 'Tabela 5932 do SIDRA (Contas Nacionais Trimestrais), variável 6562, PIB a preços de mercado (c11255/90707). O mês indicado é o fim do trimestre. Dados sujeitos a revisão pelo IBGE.',
    fetch: { kind: 'sidra', path: '/t/5932/n1/all/v/6562/p/all/c11255/90707' },
    links: [sidraTable(5932)],
  },
  {
    id: 'pib-anual', title: 'PIB — crescimento real anual', short: 'PIB anual',
    topic: 'atividade', unit: '%', decimals: 1, freq: 'A', org: 'ibge',
    description: 'Crescimento real do PIB no ano (valor do 4º trimestre da taxa acumulada em quatro trimestres).',
    notes: 'Derivado da tabela 5932 (variável 6562, 4º trimestre de cada ano), que equivale à variação anual do PIB das Contas Trimestrais.',
    fetch: { kind: 'derived', from: 'pib-4t', op: 'q4-to-annual' },
    links: [sidraTable(5932)],
  },
  {
    id: 'ibc-br', title: 'IBC-Br — atividade econômica (com ajuste sazonal)', short: 'IBC-Br',
    topic: 'atividade', unit: 'índice', decimals: 1, freq: 'M', org: 'bcb',
    description: 'Indicador mensal do Banco Central que antecipa a tendência do PIB. Índice (2002 = 100).',
    notes: 'SGS 24364.',
    fetch: { kind: 'bcb', code: 24364 }, links: [sgsPage(24364)], api: sgsUrl(24364),
  },

  // ---------- Contas públicas ----------
  {
    id: 'divida-bruta', title: 'Dívida bruta do governo geral (% do PIB)', short: 'Dívida bruta',
    topic: 'contas-publicas', unit: '% PIB', decimals: 1, freq: 'M', org: 'bcb', featured: true,
    description: 'Dívida bruta do governo federal, INSS, estados e municípios, em proporção do PIB (metodologia a partir de 2008).',
    notes: 'SGS 13762. Série começa em dez/2006.',
    fetch: { kind: 'bcb', code: 13762 }, links: [sgsPage(13762)], api: sgsUrl(13762),
  },
  {
    id: 'divida-liquida', title: 'Dívida líquida do setor público (% do PIB)', short: 'Dívida líquida',
    topic: 'contas-publicas', unit: '% PIB', decimals: 1, freq: 'M', org: 'bcb',
    description: 'Dívida do setor público consolidado descontados seus ativos financeiros (inclui reservas internacionais).',
    notes: 'SGS 4513.',
    fetch: { kind: 'bcb', code: 4513 }, links: [sgsPage(4513)], api: sgsUrl(4513),
  },
  {
    id: 'resultado-primario', title: 'Resultado primário do setor público (% do PIB, 12 meses)', short: 'Resultado primário',
    topic: 'contas-publicas', unit: '% PIB', decimals: 2, freq: 'M', org: 'bcb', featured: true,
    description: 'Receitas menos despesas, excluindo juros, acumulado em 12 meses. Positivo = superávit; negativo = déficit.',
    notes: 'SGS 5793 (NFSP sem desvalorização cambial, resultado primário, setor público consolidado). O BCB publica a necessidade de financiamento (positivo = déficit); aqui o sinal foi INVERTIDO para que superávit apareça como positivo.',
    fetch: { kind: 'bcb', code: 5793, invert: true }, links: [sgsPage(5793)], api: sgsUrl(5793),
  },
  {
    id: 'resultado-nominal', title: 'Resultado nominal do setor público (% do PIB, 12 meses)', short: 'Resultado nominal',
    topic: 'contas-publicas', unit: '% PIB', decimals: 2, freq: 'M', org: 'bcb',
    description: 'Resultado primário menos os juros da dívida. Positivo = superávit; negativo = déficit.',
    notes: 'SGS 5727, sinal invertido (ver resultado primário).',
    fetch: { kind: 'bcb', code: 5727, invert: true }, links: [sgsPage(5727)], api: sgsUrl(5727),
  },
  {
    id: 'juros-nominais', title: 'Juros nominais pagos pelo setor público (% do PIB, 12 meses)', short: 'Juros da dívida',
    topic: 'contas-publicas', unit: '% PIB', decimals: 2, freq: 'M', org: 'bcb',
    description: 'Custo dos juros apropriados sobre a dívida do setor público consolidado.',
    notes: 'SGS 5760.',
    fetch: { kind: 'bcb', code: 5760 }, links: [sgsPage(5760)], api: sgsUrl(5760),
  },

  // ---------- Juros e câmbio ----------
  {
    id: 'selic', title: 'Taxa Selic — meta definida pelo Copom', short: 'Selic',
    topic: 'juros-cambio', unit: '% a.a.', decimals: 2, freq: 'M', org: 'bcb', featured: true,
    description: 'Taxa básica de juros da economia. Valor vigente no último dia de cada mês.',
    notes: 'SGS 432 (diária), convertida para mensal pelo último valor do mês. Meta Selic existe desde mar/1999.',
    fetch: { kind: 'bcb', code: 432, daily: 'last', from: '1999-03-01' }, links: [sgsPage(432)], api: sgsUrl(432),
  },
  {
    id: 'dolar', title: 'Dólar comercial (venda) — média mensal', short: 'Dólar',
    topic: 'juros-cambio', unit: 'R$', decimals: 2, freq: 'M', org: 'bcb', featured: true,
    description: 'Taxa de câmbio livre, dólar americano, venda. Média dos dias úteis do mês.',
    notes: 'SGS 1 (diária), convertida em média mensal. Valores nominais, sem correção pela inflação. Série usada a partir de jul/1994 (Plano Real).',
    fetch: { kind: 'bcb', code: 1, daily: 'mean', from: '1994-07-01' }, links: [sgsPage(1)], api: sgsUrl(1),
  },

  // ---------- Comércio exterior ----------
  {
    id: 'exportacoes', title: 'Exportações de bens (US$ milhões, mensal)', short: 'Exportações',
    topic: 'comercio-exterior', unit: 'US$ mi', decimals: 0, freq: 'M', org: 'bcb',
    description: 'Exportações de bens pelo critério do Balanço de Pagamentos.',
    notes: 'SGS 22708. Para detalhamento por produto e destino, consulte o Comex Stat (MDIC).',
    fetch: { kind: 'bcb', code: 22708 }, links: [sgsPage(22708), 'https://comexstat.mdic.gov.br/'], api: sgsUrl(22708),
  },
  {
    id: 'importacoes', title: 'Importações de bens (US$ milhões, mensal)', short: 'Importações',
    topic: 'comercio-exterior', unit: 'US$ mi', decimals: 0, freq: 'M', org: 'bcb',
    description: 'Importações de bens pelo critério do Balanço de Pagamentos.',
    notes: 'SGS 22709.',
    fetch: { kind: 'bcb', code: 22709 }, links: [sgsPage(22709), 'https://comexstat.mdic.gov.br/'], api: sgsUrl(22709),
  },
  {
    id: 'saldo-comercial', title: 'Saldo da balança comercial (US$ milhões, mensal)', short: 'Saldo comercial',
    topic: 'comercio-exterior', unit: 'US$ mi', decimals: 0, freq: 'M', org: 'bcb', featured: true,
    description: 'Exportações menos importações de bens no mês (Balanço de Pagamentos).',
    notes: 'SGS 22707.',
    fetch: { kind: 'bcb', code: 22707 }, links: [sgsPage(22707)], api: sgsUrl(22707),
  },
];

export const indicatorById = id => INDICATORS.find(i => i.id === id);

/**
 * Gastos federais por função (SICONFI / RREO Anexo 02, despesas liquidadas no ano).
 * Armazenado em data/series/despesas-funcao.json, com estrutura própria (anual × função).
 */
export const SPENDING = {
  id: 'despesas-funcao',
  title: 'Despesas do Governo Federal por função',
  org: 'tesouro',
  description: 'Despesas liquidadas até o 6º bimestre (ano completo), por função de governo, conforme o Relatório Resumido de Execução Orçamentária (RREO, Anexo 2) declarado pela União ao SICONFI.',
  notes: 'Exclui despesas intra-orçamentárias. "Encargos Especiais" concentra juros, amortização e refinanciamento da dívida e transferências constitucionais. Valores nominais; a opção "corrigido pelo IPCA" usa a média anual do IPCA. O ano corrente só entra quando o 6º bimestre é publicado.',
  api: 'https://apidatalake.tesouro.gov.br/ords/siconfi/tt/rreo',
  links: ['https://siconfi.tesouro.gov.br/', 'https://apidatalake.tesouro.gov.br/docs/siconfi/'],
  firstYear: 2015,
};

/** As 28 funções de governo (Portaria MOG nº 42/1999). */
export const FUNCOES = [
  'Legislativa', 'Judiciária', 'Essencial à Justiça', 'Administração', 'Defesa Nacional', 'Segurança Pública',
  'Relações Exteriores', 'Assistência Social', 'Previdência Social', 'Saúde', 'Trabalho', 'Educação', 'Cultura',
  'Direitos da Cidadania', 'Urbanismo', 'Habitação', 'Saneamento', 'Gestão Ambiental', 'Ciência e Tecnologia',
  'Agricultura', 'Organização Agrária', 'Indústria', 'Comércio e Serviços', 'Comunicações', 'Energia',
  'Transporte', 'Desporto e Lazer', 'Encargos Especiais',
];
