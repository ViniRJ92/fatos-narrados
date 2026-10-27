# Roteiro de evolução

O portal foi construído para crescer sem reescrita: o catálogo (`js/data/catalog.js`) descreve cada série, os conectores (`js/api/official.js`) sabem buscá-la, e as páginas apenas leem `data/series/*.json`. Nova fonte = novo conector + entradas no catálogo.

## Fase 1 — concluída

- 29 séries oficiais (IBGE e Banco Central) + despesas da União por função (SICONFI).
- Comparação entre mandatos com método único e documentado.
- Consultas ao vivo: PNCP (contratações) e Câmara (cota parlamentar).
- Atualização automática diária via GitHub Actions, com histórico versionado.

## Fase 1.5: concluída

- Desmontando Boatos: verificador por regras na página inicial.
- Emendas parlamentares (arquivo da CGU, 2014 em diante) com filtros, mapa, comparação e página de cada emenda.
- Transferências especiais ("Pix") consultadas ao vivo no Transferegov.br.

## Próximos passos para emendas

| O que falta | Fonte | Como integrar |
|---|---|---|
| Valor autorizado (dotação) de cada emenda | Siga Brasil (Senado) | Sem API pública. Avaliar exportações periódicas do próprio Siga Brasil |
| Órgão executor e notas de empenho por emenda | API do Portal da Transparência (CGU) | Exige chave gratuita. Guardar como *secret* do GitHub Actions e consultar só no script de atualização |
| Convênios comuns (plano de trabalho, prestação de contas) | Transferegov.br | Bases de convênios do Transferegov; ligar pelo número do convênio que já está no arquivo da CGU |
| Auditorias e decisões | TCU e CGU | Consulta por número de convênio ou CNPJ, sem tratar investigação como condenação |
| Verificador com mais assuntos | Séries novas do catálogo | Cada série nova do catálogo pode ganhar palavras-chave em `js/verify/engine.js` |

## Fase 2 — novas fontes (todas já verificadas no catálogo)

| Tema pedido | Fonte oficial | Como integrar |
|---|---|---|
| Preço da gasolina, diesel, etanol e GLP em R$ | ANP — Levantamento de Preços | Planilhas XLSX semanais/mensais: script de importação (precisa de leitor de XLSX, ex. `exceljs`) |
| Exportações por produto e destino | Comex Stat (MDIC) | API própria; estava fora do ar (HTTP 503) na verificação — tentar novamente |
| Emendas parlamentares, transferências, programas sociais | Portal da Transparência (CGU) | API gratuita com chave por e-mail. Guardar a chave como *secret* do GitHub Actions (`PORTAL_TRANSPARENCIA_KEY`) e consultar só no script de atualização, nunca no navegador |
| Emprego formal | Novo Caged (MTE) | Microdados mensais / painéis |
| Recuperação judicial e falências | DataJud (CNJ) | API pública (Elasticsearch) por classe processual |
| Arrecadação e renúncias fiscais | Receita Federal | Relatórios de arrecadação e Demonstrativo de Gastos Tributários |
| Resultado do Tesouro (RTN) | Tesouro Transparente | CSV/XLSX via CKAN |
| Saúde, educação | DataSUS, Inep | Microdados; exigem pré-processamento pesado → Fase 3 |
| Estatais | Tesouro / SEST | Boletins das empresas estatais |
| Senado (votações, matérias) | Dados Abertos do Senado | API JSON aberta |

## Fase 3 — estados e municípios, banco de dados e API

1. **Estados e municípios:** o SICONFI (já integrado para a União) tem os mesmos relatórios de todos os entes (`id_ente` = código IBGE). O SIDRA tem PNAD e IPCA por região metropolitana. Começar por despesas por função de cada estado e capital.
2. **Banco de dados:** quando o volume passar de dezenas de MB, migrar `data/series` para PostgreSQL (tabelas `series`, `observations(series_id, period, value, fetched_at)` e `fetch_log`). Manter o histórico de revisões: nunca sobrescrever, gravar nova versão com `fetched_at`.
3. **API própria:** expor `/api/series/{id}` e `/api/governos/{metrica}` lendo do banco, com cache. As páginas atuais só precisam trocar a URL em `js/core/data.js`.
4. **Alertas de revisão:** quando um órgão revisar um dado passado, registrar e mostrar no portal ("o IBGE revisou o PIB de 2024 de X para Y em dd/mm").

## Qualidade contínua

- Testes de regressão para cada nova métrica (`tests/`).
- Verificação automática semanal das URLs do catálogo de fontes.
- Auditoria de acessibilidade (WCAG 2.1 AA) a cada nova página.
