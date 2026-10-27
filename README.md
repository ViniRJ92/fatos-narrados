# Fatos Narrados

Portal independente de transparência pública, economia e fiscalização governamental.

> Não exigir que o cidadão acredite em uma narrativa. Permitir que ele verifique os fatos.

Todos os números vêm **exclusivamente de fontes oficiais e primárias** (IBGE, Banco Central, Tesouro Nacional, PNCP, Câmara dos Deputados). Cada número exibido tem um link para a consulta original, e a página de cada indicador tem um botão que consulta a API oficial na hora e compara com o valor mostrado.

## O que já funciona

| Página | O que faz | Fonte |
|---|---|---|
| `index.html` | Painel com 11 indicadores-chave, busca e temas | IBGE, BCB |
| `indicador.html` | Explorador de 29 séries: período, mandatos no gráfico, comparação (mesma unidade), estatísticas, tabela, CSV/JSON e **verificação ao vivo na fonte** | IBGE, BCB |
| `governos.html` | 16 métricas por mandato (FHC 1 → Lula 3) com o mesmo método para todos; clique em um valor para ver o cálculo | IBGE, BCB |
| `tema.html?t=…` | Pequenos múltiplos por tema; ranking de preços e calculadora da inflação | IBGE, BCB |
| `gastos.html` | Despesa da União nas 28 funções de governo, 2015 em diante, nominal ou corrigida pelo IPCA | Tesouro (SICONFI) |
| `fiscalizacao.html` | Consulta **ao vivo** de licitações/contratações e da cota parlamentar de cada deputado | PNCP, Câmara |
| `fontes.html` | Catálogo de 24 fontes oficiais verificadas, com status, formato e limitações | — |
| `metodologia.html` | Princípios editoriais, regras de atribuição a governos, tratamento das séries | — |

### Indicadores integrados

- **Inflação e custo de vida:** IPCA (12 meses e mensal); subitens do IPCA — alimentação no domicílio, arroz, carnes, café, gasolina, diesel, etanol, gás de botijão, energia elétrica, aluguel, plano de saúde, ônibus urbano.
- **Emprego e renda:** taxa de desocupação e rendimento médio real (PNAD Contínua).
- **Atividade:** PIB (4 trimestres e anual), IBC-Br.
- **Contas públicas:** dívida bruta e líquida, resultado primário e nominal, juros nominais; despesas da União por função.
- **Juros e câmbio:** meta Selic, dólar.
- **Comércio exterior:** exportações, importações e saldo da balança.

Os códigos de cada série (SGS do Banco Central, tabelas/variáveis do SIDRA) foram conferidos nos metadados oficiais e estão em [`js/data/catalog.js`](js/data/catalog.js).

## Como rodar

Requer Node.js 18 ou superior. Não há dependências para instalar.

```bash
npm start            # servidor local em http://localhost:8080
npm run update       # baixa todos os dados das APIs oficiais (~5 min; Selic e dólar são lentos)
npm test             # testes das transformações e das regras de atribuição
```

Para atualizar só alguns indicadores: `node scripts/update-data.mjs ipca-12m desocupacao`.

O site é estático (HTML, CSS e JavaScript em módulos ES) e pode ser publicado como está em GitHub Pages, Netlify, Vercel ou qualquer servidor de arquivos. Ele precisa ser servido por HTTP (não abre por `file://`, por causa dos módulos).

## Arquitetura

```
index.html, indicador.html, governos.html, …   páginas (HTML semântico, conteúdo básico sem JS)
css/styles.css                                 tema claro/escuro, responsivo, sem framework
js/
  data/catalog.js       catálogo de indicadores: FONTE ÚNICA da verdade (site + script de atualização)
  data/governments.js   mandatos e regras de atribuição de períodos
  data/metrics.js       métricas por mandato (um único código para todos os governos)
  data/transforms.js    funções puras: acumulado 12m, diário→mensal, índices, CSV
  data/sources.js       catálogo de fontes oficiais verificadas
  api/official.js       conectores BCB, SIDRA e SICONFI (funcionam no navegador e no Node)
  components/           gráfico SVG próprio, cartões, layout
  pages/                um módulo por página
data/
  series/*.json         dados baixados (com data/hora e URL da consulta)
  manifest.json         situação de cada série na última atualização
scripts/
  update-data.mjs       atualização a partir das APIs oficiais
  serve.mjs             servidor local sem dependências
tests/                  node:test
.github/workflows/      atualização diária automática, com cada mudança versionada no Git
```

Decisões principais:

- **Dados versionados no Git.** A atualização diária grava os JSON e faz commit. O histórico do repositório mostra quando cada número mudou, inclusive revisões dos próprios órgãos.
- **Nada é inventado.** Se uma API falha, o arquivo anterior é mantido e a falha fica registrada no manifesto e na página inicial.
- **Neutralidade visual.** Nenhuma cor partidária; mandatos em faixas cinza alternadas; nenhum número pintado de "bom" ou "ruim".
- **Um eixo por gráfico.** Só é possível comparar indicadores da mesma unidade.
- **Sem dependências** de front-end: o gráfico é SVG próprio, acessível por teclado (setas, Home/End) e com tabela de dados.

## Como evoluir

Veja [`docs/ROADMAP.md`](docs/ROADMAP.md): próximas fontes (ANP, Comex Stat, Portal da Transparência, Novo Caged, DataJud), indicadores estaduais e municipais, banco de dados e API própria.

## Licença

Código sob licença MIT. Os dados pertencem aos órgãos públicos que os produzem e seguem as condições de uso de cada um.
