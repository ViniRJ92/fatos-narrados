/**
 * Metadados das emendas parlamentares: modalidades, fontes e regras de cálculo.
 * Compartilhado entre o site e scripts/update-emendas.mjs.
 */

export const EMENDAS_SOURCES = {
  cgu: {
    org: 'Controladoria-Geral da União',
    name: 'Portal da Transparência — download de dados de emendas parlamentares',
    page: 'https://portaldatransparencia.gov.br/download-de-dados/emendas-parlamentares',
    file: 'https://portaldatransparencia.gov.br/download-de-dados/emendas-parlamentares/UNICO',
    covers: 'Emendas com execução orçamentária (empenho, liquidação, pagamento e restos a pagar), recebimentos por favorecido e convênios vinculados.',
  },
  transferegov: {
    org: 'Ministério da Gestão e da Inovação em Serviços Públicos',
    name: 'Transferegov.br — API de Transferências Especiais',
    page: 'https://www.gov.br/transferegov/pt-br',
    api: 'https://api.transferegov.gestao.gov.br/transferenciasespeciais/',
    covers: 'Somente transferências especiais ("emendas Pix"): plano de ação, empenho, documento hábil, ordem bancária, executor, metas, plano de trabalho e relatório de gestão.',
  },
  camara: { org: 'Câmara dos Deputados', name: 'Dados Abertos — deputados por legislatura', api: 'https://dadosabertos.camara.leg.br/api/v2/deputados' },
  senado: { org: 'Senado Federal', name: 'Dados Abertos — senadores por legislatura', api: 'https://legis.senado.leg.br/dadosabertos/senador/lista/legislatura/55/57.json' },
  ibge: { org: 'IBGE', name: 'API de malhas territoriais', api: 'https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application/vnd.geo%2Bjson&qualidade=minima&intrarregiao=UF' },
};

/** Modalidades conforme a classificação usada pela CGU, com o contexto jurídico de cada uma. */
export const TIPOS = {
  'Emenda Individual - Transferências com Finalidade Definida': {
    short: 'Individual (finalidade definida)', group: 'individual',
    note: 'Emenda de um parlamentar com destino e finalidade definidos na programação orçamentária. Execução obrigatória (impositiva) desde a Emenda Constitucional 86/2015.',
  },
  'Emenda Individual - Transferências Especiais': {
    short: 'Individual, transferência especial ("Pix")', group: 'pix',
    note: 'Criada pela Emenda Constitucional 105/2019 e usada desde 2020: o recurso é repassado diretamente ao estado ou município, sem convênio. A Lei Complementar 210/2024 e decisões do STF passaram a exigir plano de trabalho e mais transparência. A execução é acompanhada no Transferegov.br.',
  },
  'Emenda de Bancada': {
    short: 'Bancada estadual', group: 'bancada',
    note: 'Apresentada em conjunto pelos parlamentares de um estado. Execução obrigatória desde a Emenda Constitucional 100/2019. A autoria é da bancada, não de um parlamentar individual.',
  },
  'Emenda de Comissão': {
    short: 'Comissão', group: 'comissao',
    note: 'Apresentada por comissão permanente da Câmara, do Senado ou do Congresso. Execução não obrigatória.',
  },
  'Emenda de Relator': {
    short: 'Relator-geral', group: 'relator',
    note: 'Emenda do relator-geral do orçamento. O identificador de resultado primário RP 9 foi criado na LDO de 2020; em dezembro de 2022 o STF julgou inconstitucional o uso dessas emendas para despesas sem identificação do parlamentar solicitante (ADPFs 850, 851, 854 e 1014). Registros anteriores a 2020 com esse tipo correspondem a emendas do relator sem o identificador RP 9. A base da CGU registra o relator, não necessariamente quem indicou o recurso.',
  },
};

/** Índices dos valores nos registros compactos. */
export const V = { EMP: 0, LIQ: 1, PAGO: 2, RAP_INSC: 3, RAP_CANC: 4, RAP_PAGO: 5 };
export const VALUE_LABELS = ['Empenhado', 'Liquidado', 'Pago no exercício', 'Restos a pagar inscritos', 'Restos a pagar cancelados', 'Restos a pagar pagos'];

/** Total efetivamente pago = pago no exercício + restos a pagar pagos nos anos seguintes. */
export const pagoTotal = v => v[V.PAGO] + v[V.RAP_PAGO];

/**
 * Saldo empenhado ainda não pago nem cancelado (estimativa).
 * Não usa "restos a pagar inscritos", que pode ser reinscrito a cada ano e gerar dupla contagem.
 */
export const naoPago = v => Math.max(0, v[V.EMP] - v[V.PAGO] - v[V.RAP_PAGO] - v[V.RAP_CANC]);

/** Situação da execução derivada dos valores (apenas descritiva; não indica regularidade). */
export function situacao(v) {
  const emp = v[V.EMP], pago = pagoTotal(v);
  if (emp <= 0 && pago <= 0) return 'sem-empenho';
  if (pago <= 0) return v[V.RAP_CANC] >= emp * 0.99 && emp > 0 ? 'cancelada' : 'empenhada-sem-pagamento';
  if (pago >= emp * 0.99) return 'paga';
  return 'paga-parcialmente';
}
export const SITUACAO_LABEL = {
  'sem-empenho': 'Sem empenho registrado',
  'empenhada-sem-pagamento': 'Empenhada, sem pagamento',
  'cancelada': 'Empenho cancelado',
  'paga-parcialmente': 'Paga parcialmente',
  'paga': 'Paga integralmente',
};

/** Estados de acesso/sigilo — nunca inferidos da simples ausência de documento. */
export const ACESSO = {
  'publica': 'Documentação pública localizada',
  'parcial': 'Acesso parcialmente restrito',
  'restrita': 'Restrição de acesso formalmente identificada',
  'nao-localizado': 'Documento não localizado',
  'nao-disponivel': 'Informação não disponibilizada na base consultada',
  'nao-verificada': 'Situação de acesso não verificada',
};
