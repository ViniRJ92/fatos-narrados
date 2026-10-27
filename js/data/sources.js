/**
 * Registro de fontes oficiais.
 *
 * status:
 *   'integrada'   → dados já baixados/consultados pelo portal
 *   'ao-vivo'     → consultada diretamente pelo navegador do visitante
 *   'requer-chave'→ API oficial gratuita, exige cadastro de chave (uso no script de atualização)
 *   'catalogada'  → fonte oficial verificada; integração planejada
 *
 * verified: data em que a URL foi conferida (HTTP 200, ou bloqueio anti-robô em site sabidamente oficial).
 * Nenhuma URL aqui foi presumida: todas foram acessadas antes de entrar no registro.
 */
export const VERIFIED_ON = '2026-10-27';

export const SOURCES = [
  {
    org: 'Banco Central do Brasil', name: 'SGS — Sistema Gerenciador de Séries Temporais', status: 'integrada',
    url: 'https://www3.bcb.gov.br/sgspub/', api: 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.{codigo}/dados?formato=json',
    formats: ['API JSON', 'CSV'], covers: ['Dívida pública', 'Resultado primário e nominal', 'Juros', 'Selic', 'Câmbio', 'Balança comercial', 'IBC-Br'],
    limits: 'Séries diárias limitadas a janelas de 10 anos por consulta. Estatísticas fiscais são revisadas periodicamente.',
    catalog: 'https://dadosabertos.bcb.gov.br/',
  },
  {
    org: 'IBGE', name: 'SIDRA — Sistema IBGE de Recuperação Automática', status: 'integrada',
    url: 'https://sidra.ibge.gov.br/', api: 'https://apisidra.ibge.gov.br/values/t/{tabela}/...',
    formats: ['API JSON', 'CSV', 'XLSX'], covers: ['IPCA (geral, grupos, subitens)', 'PNAD Contínua (desocupação, renda)', 'PIB (Contas Nacionais)'],
    limits: 'Até 100 mil valores por consulta. Tabelas mudam quando há troca de metodologia (ex.: IPCA por subitem em 2006, 2012 e 2020).',
    catalog: 'https://servicodados.ibge.gov.br/api/docs',
  },
  {
    org: 'Tesouro Nacional', name: 'SICONFI — Relatórios fiscais (RREO/RGF)', status: 'integrada',
    url: 'https://siconfi.tesouro.gov.br/', api: 'https://apidatalake.tesouro.gov.br/ords/siconfi/tt/rreo',
    formats: ['API JSON'], covers: ['Despesas por função (saúde, educação, segurança…)', 'Receitas e despesas de União, estados e municípios'],
    limits: 'Dados declarados pelos próprios entes; disponíveis desde 2015. A API não permite consulta direta pelo navegador (sem CORS) — usada no script de atualização.',
    catalog: 'https://apidatalake.tesouro.gov.br/docs/siconfi/',
  },
  {
    org: 'Ministério da Gestão (PNCP)', name: 'Portal Nacional de Contratações Públicas', status: 'ao-vivo',
    url: 'https://pncp.gov.br/', api: 'https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao',
    formats: ['API JSON'], covers: ['Licitações', 'Dispensas e inexigibilidades', 'Contratos (Lei 14.133/2021)'],
    limits: 'Consulta exige período e modalidade. Cobre principalmente contratações publicadas sob a Lei 14.133/2021.',
    catalog: 'https://pncp.gov.br/api/consulta/swagger-ui/index.html',
  },
  {
    org: 'Câmara dos Deputados', name: 'Dados Abertos da Câmara', status: 'ao-vivo',
    url: 'https://dadosabertos.camara.leg.br/', api: 'https://dadosabertos.camara.leg.br/api/v2/',
    formats: ['API JSON', 'XML', 'CSV'], covers: ['Deputados', 'Cota parlamentar (despesas)', 'Proposições e votações'],
    limits: 'Paginação de até 100 itens por requisição.',
  },
  {
    org: 'Senado Federal', name: 'Dados Abertos do Senado', status: 'catalogada',
    url: 'https://legis.senado.leg.br/dadosabertos/', api: 'https://legis.senado.leg.br/dadosabertos/senador/lista/atual.json',
    formats: ['API JSON', 'XML'], covers: ['Senadores', 'Matérias', 'Votações'],
    limits: 'Integração planejada.',
  },
  {
    org: 'Senado Federal', name: 'Siga Brasil (orçamento)', status: 'catalogada',
    url: 'https://www12.senado.leg.br/orcamento/sigabrasil', formats: ['Painéis', 'Exportação'],
    covers: ['Execução orçamentária detalhada', 'Emendas parlamentares'], limits: 'Ferramenta de consulta; sem API pública documentada.',
  },
  {
    org: 'Controladoria-Geral da União', name: 'Portal da Transparência', status: 'requer-chave',
    url: 'https://portaldatransparencia.gov.br/', api: 'https://api.portaldatransparencia.gov.br/api-de-dados/',
    formats: ['API JSON', 'CSV (downloads)'], covers: ['Emendas parlamentares', 'Transferências', 'Programas sociais', 'Servidores', 'Contratos federais'],
    limits: 'API gratuita, exige chave obtida por cadastro de e-mail no próprio portal. Limite de requisições por minuto.',
  },
  {
    org: 'Ministério do Desenvolvimento, Indústria, Comércio e Serviços', name: 'Comex Stat', status: 'catalogada',
    url: 'https://comexstat.mdic.gov.br/', formats: ['Consulta web', 'CSV', 'API'],
    covers: ['Exportações e importações por produto, país e estado'],
    limits: 'A API estava indisponível (HTTP 503) na verificação; os totais mensais do portal vêm do Balanço de Pagamentos (BCB).',
  },
  {
    org: 'ANP', name: 'Levantamento de Preços de Combustíveis', status: 'catalogada',
    url: 'https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia/precos', formats: ['XLSX', 'CSV'],
    covers: ['Preço médio de gasolina, diesel, etanol e GLP por município e estado'],
    limits: 'Publicado em planilhas, sem API. Enquanto não integrado, o portal mostra a variação de preços desses itens pelo IPCA.',
  },
  {
    org: 'Conab', name: 'Companhia Nacional de Abastecimento', status: 'catalogada',
    url: 'https://www.conab.gov.br/', formats: ['XLSX', 'Painéis'], covers: ['Preços agropecuários', 'Safras', 'Estoques'],
    limits: 'Integração planejada.',
  },
  { org: 'Tesouro Nacional', name: 'Tesouro Transparente', status: 'catalogada', url: 'https://www.tesourotransparente.gov.br/',
    formats: ['CSV', 'XLSX', 'API CKAN'], covers: ['Resultado do Tesouro Nacional (RTN)', 'Dívida pública federal', 'Transferências constitucionais'],
    limits: 'Integração planejada.', catalog: 'https://www.tesourotransparente.gov.br/temas/estatisticas-fiscais-e-planejamento/resultado-do-tesouro-nacional-rtn' },
  { org: 'Ministério da Gestão', name: 'Transferegov.br', status: 'catalogada', url: 'https://www.gov.br/transferegov/pt-br',
    formats: ['Painéis', 'Downloads'], covers: ['Convênios', 'Transferências especiais (emendas "Pix")'], limits: 'Integração planejada.' },
  { org: 'Tribunal de Contas da União', name: 'Portal do TCU', status: 'catalogada', url: 'https://portal.tcu.gov.br/',
    formats: ['Relatórios', 'Dados abertos'], covers: ['Auditorias', 'Contas do Presidente', 'Obras com indícios de irregularidade'], limits: 'Integração planejada.' },
  { org: 'Controladoria-Geral da União', name: 'CGU', status: 'catalogada', url: 'https://www.gov.br/cgu/pt-br',
    formats: ['Relatórios'], covers: ['Auditorias', 'Sanções', 'Corregedoria'], limits: 'Integração planejada.' },
  { org: 'Receita Federal', name: 'Receita Federal', status: 'catalogada', url: 'https://www.gov.br/receitafederal/pt-br',
    formats: ['Relatórios', 'CSV'], covers: ['Arrecadação federal', 'Gastos tributários (renúncias)', 'Cadastro de CNPJ'], limits: 'Integração planejada.' },
  { org: 'Ministério da Fazenda', name: 'Ministério da Fazenda', status: 'catalogada', url: 'https://www.gov.br/fazenda/pt-br',
    formats: ['Relatórios'], covers: ['Política fiscal', 'Boletins macroeconômicos'], limits: 'Integração planejada.' },
  { org: 'Ministério do Planejamento e Orçamento', name: 'MPO', status: 'catalogada', url: 'https://www.gov.br/planejamento/pt-br',
    formats: ['Relatórios'], covers: ['Orçamento federal', 'Relatórios bimestrais de receitas e despesas (bloqueios e cortes)'], limits: 'Integração planejada.' },
  { org: 'Inep', name: 'Inep', status: 'catalogada', url: 'https://www.gov.br/inep/pt-br',
    formats: ['Microdados', 'CSV'], covers: ['Censo Escolar', 'Ideb', 'Enem'], limits: 'Integração planejada.' },
  { org: 'Ministério da Saúde', name: 'DataSUS', status: 'catalogada', url: 'https://datasus.saude.gov.br/',
    formats: ['TabNet', 'Microdados'], covers: ['Internações', 'Mortalidade', 'Estrutura do SUS'], limits: 'Site instável na verificação (tempo esgotado); integração planejada.' },
  { org: 'Ministério da Previdência Social', name: 'Previdência Social', status: 'catalogada', url: 'https://www.gov.br/previdencia/pt-br',
    formats: ['Boletins', 'CSV'], covers: ['Benefícios', 'Resultado do RGPS'], limits: 'Integração planejada.' },
  { org: 'Ministério do Trabalho e Emprego', name: 'MTE (Novo Caged)', status: 'catalogada', url: 'https://www.gov.br/trabalho-e-emprego/pt-br',
    formats: ['Painéis', 'Microdados'], covers: ['Emprego formal (saldo de admissões e desligamentos)'], limits: 'Integração planejada.' },
  { org: 'Conselho Nacional de Justiça', name: 'DataJud', status: 'catalogada', url: 'https://datajud-wiki.cnj.jus.br/',
    formats: ['API (Elasticsearch)'], covers: ['Processos judiciais, inclusive recuperação judicial e falência'], limits: 'API pública com chave divulgada pelo CNJ; integração planejada.' },
  { org: 'Governo Federal', name: 'Portal de Dados Abertos', status: 'catalogada', url: 'https://dados.gov.br/',
    formats: ['Catálogo CKAN'], covers: ['Índice de bases de dados de órgãos federais'], limits: 'Catálogo de referência.' },
];

export const STATUS_LABEL = {
  'integrada': 'Integrada',
  'ao-vivo': 'Consulta ao vivo',
  'requer-chave': 'Requer chave gratuita',
  'catalogada': 'Catalogada — integração planejada',
};
