# Baselines

O Veracode Connect mantém baselines para SAST (Pipeline Scan), SCA e IaC/Secrets. Com um baseline registrado, só os findings novos podem bloquear a esteira; o backlog continua visível sem travar. Os modos e a autenticação do repositório de baseline estão em [Configuração](configuracao.md).

## Regras IaC centralizadas

Coloque `veracode.yml` na raiz do repositório de baseline. Este exemplo executa somente IaC e usa um PAT para buscar as regras; os inputs do GitHub App também podem ser usados no lugar do PAT.

```yaml
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
- uses: Afrika-Tecnologia/Veracode-Connect@v1.9.0
  with:
    veracode_api_id: ${{ secrets.VERACODE_API_ID }}
    veracode_api_key: ${{ secrets.VERACODE_API_KEY }}
    enable_iac: 'true'
    enable_iac_configs: 'true'
    enable_pipelinescan: 'false'
    baseline_mode: 'none'
    baseline_org: ${{ github.repository_owner }}
    baseline_repo_name: Afrika-Veracode-Connect-Baseline
    baseline_github_token: ${{ secrets.BASELINE_GITHUB_TOKEN }}
```

O arquivo é baixado da branch padrão do baseline; informe `baseline_repo_branch` para selecionar outra branch. O download substitui o `veracode.yml` da raiz do workspace e suas regras são aplicadas no `HOME` temporário usado pelo IaC. `@v1` e `@v1.9` também apontam para a versão `v1.9.0`.

## Baseline IaC/Secrets

A Veracode não oferece baseline para Container/IaC/Secrets; o Veracode Connect mantém um próprio. Com `enable_iac_baseline: 'true'`, `baseline_mode: 'repo'` e `enable_iac: 'true'`, a primeira execução elegível grava `<org>/<repo>/iac-baseline.json` no repositório de baseline, na mesma pasta do `baseline.json` do Pipeline Scan. É elegível a execução cujo destino é a branch padrão do repositório analisado: push nela ou PR destinado a ela. O arquivo é gravado uma única vez e nunca é regravado; para refazê-lo, apague `iac-baseline.json` no repositório de baseline.

Nas execuções seguintes, o scan IaC roda como antes e cada finding é comparado ao baseline:

| Grupo | Bloqueia |
| --- | --- |
| Novos que afetam a política: ausentes do baseline e reprovados pela política de `iac_policy` | Sim, com `policy_fail` e `fail_build` ligados e `bypass` desligado |
| Novos que não afetam a política | Não |
| Backlog: presentes no baseline e no scan atual | Não |

Os findings corrigidos não aparecem no card; a contagem fica no log do job e no diff. O summary e o comentário do PR mostram os três grupos por severidade num único card IaC. O detalhamento completo fica em `iac-results/iac-baseline-diff.json`, no artefato do IaC.

A identidade de cada finding não depende do número da linha: vulnerabilidades usam identificador, pacote e manifesto (sem a versão); secrets usam regra e arquivo; configurações usam regra, arquivo e recurso. Deslocar linhas, editar o recurso ou subir a versão de uma biblioteca sem corrigir a vulnerabilidade mantém o finding no backlog. O baseline guarda só identificadores e campos de exibição; o trecho e o valor dos secrets nunca são gravados.

Enquanto não houver baseline IaC, inclusive na execução que o grava, a política IaC é avaliada e exibida, mas não bloqueia (`iac_policy_status: deferred`). Sem `iac_policy`, os findings novos aparecem, mas nenhum bloqueia. Falha ao ler o baseline gera aviso e também não bloqueia por IaC. A autenticação é a mesma do modo `repo` (GitHub App ou PAT com Contents read/write).

O summary IaC e o comentário do PR somam as vulnerabilidades de dependências, os findings de secrets (incluindo regras customizadas) e os findings de configurações. O detalhamento usa identificador da regra, título e arquivo/linha; os campos `Code` e `Match` dos secrets não são publicados. As severidades exibidas são as reportadas nos findings pelo scanner.

## Baseline SCA

O baseline SCA segue o modelo do IaC. Com `enable_sca_baseline: 'true'`, `baseline_mode: 'repo'` e `enable_sca: 'true'`, a primeira execução elegível grava `<org>/<repo>/sca-baseline.json` no repositório de baseline, uma única vez (push na branch padrão ou PR destinado a ela). Para refazê-lo, apague `sca-baseline.json` no repositório de baseline.

Cada vulnerabilidade de cada biblioteca é um finding. Nas execuções seguintes:

| Grupo | Bloqueia |
| --- | --- |
| Novos que afetam a política: ausentes do baseline, com severidade em `sca_fail_on_severity` (vazio = qualquer severidade) ou CVE em `fail_on_cve` | Sim, com `policy_fail` e `fail_build` ligados e `bypass` desligado |
| Novos que não afetam a política | Não |
| Backlog: presentes no baseline e no scan atual | Não |

O resultado do agente SCA não informa, por vulnerabilidade, se ela viola a política do workspace; por isso o critério é explícito. Com baseline ativo, `breakBuildOnPolicyFindings` não é repassado à action oficial, porque ele avalia todas as vulnerabilidades e bloquearia pelo backlog. `fail_on_cve` continua valendo para qualquer finding, inclusive do backlog.

A identidade usa a vulnerabilidade (CVE ou identificador do banco SCA) e a biblioteca, sem a versão: subir a versão sem corrigir mantém o finding no backlog. Enquanto não houver baseline, a política SCA não bloqueia (só `fail_on_cve`). O summary e o comentário do PR mostram os três grupos por severidade; o detalhamento completo fica em `sca-results/sca-baseline-diff.json`, no artefato do SCA.
