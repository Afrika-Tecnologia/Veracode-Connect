# Veracode Connect

GitHub Action facilitadora para implementar o Veracode no seu repositorio, com suporte opcional ao baseline via Portal Afrika ou repositorio GitHub.

Uso (exemplo rapido):

```yml
- uses: Afrika-Tecnologia/Veracode-Connect@v1
```

## Fluxo (ordem dos steps)

1) (Opcional) Veracode SCA (`enable_sca: 'true'`)
2) (Opcional) Veracode IaC/Secrets (`enable_iac: 'true'`)
3) Define o artefato do scan:
   - `enable_auto_packager: 'true'` -> gera artefatos com o Auto Packager a partir do **tree do commit** (`git archive` do `github.sha` em `$RUNNER_TEMP`, fora do workspace). Falha se a CLI nao produzir pacotes validos; nao usa ZIP aleatorio do job. Cada zip com código analisável pelo Pipeline Scan vira um scan em série; o Upload & Scan recebe todos os zips originais. Artefatos gerados no job (`build/`, `target/`, `agent.zip`) **nao** entram; use `scan_file` para binários compilados.
   - `enable_auto_packager: 'false'` -> usa o `scan_file` que voce fornecer
4) (Opcional) Baseline (`baseline_mode: 'portal_afrika'` | `'repo'`) — Pipeline Scan com provedor de baseline
5) (Opcional) Pipeline Scan sem baseline (`baseline_mode: 'none'` + `enable_pipelinescan: 'true'`)
6) (Opcional) Upload & Scan (static) por ultimo (`enable_upload_scan: 'true'`)
7) **Trava de Build** — step final que verifica todos os resultados (`fail_build: 'true'`)

Os logs ficam agrupados no console (`::group::/::endgroup::`).

O Step Summary do job lista só os módulos que rodaram, nesta ordem (independente da execução): Pipeline Scan, SCA, IaC/Secrets, Upload & Scan, Auto Packager e Resumo Final.

## Inputs

Todos os booleanos devem ser passados como string: `'true'` / `'false'`.

Com `create_issues: 'true'`, o repositório precisa ter **Issues habilitadas** (Settings → General → Features → Issues) e o workflow **precisa** declarar `permissions: issues: write` no **job ou workflow** que chama esta action (composite actions **não** podem definir permissions). A validação inicial falha cedo com instruções se algum pré-requisito estiver ausente.

Com `comment_pr: 'true'`, o workflow **precisa** declarar `permissions: pull-requests: write` (além de `contents: read`). O comentário só é publicado em execuções de **Pull Request**; em push/workflow_dispatch o step registra skip e continua. A validação inicial verifica o token e a permissão antes dos scans.

| Input | Obrigatorio | Default | Notas |
|---|---:|---:|---|
| `veracode_api_id` | sim | - | VID do Veracode. |
| `veracode_api_key` | sim | - | VKEY do Veracode. |
| `enable_auto_packager` | nao | `'false'` | Se `'true'`, empacota o tree do SHA (não o workspace sujo do job) e classifica os artefatos por conteúdo; senao usa `scan_file`. |
| `scan_file` | nao* | - | Obrigatorio quando `enable_auto_packager: 'false'`. Use tambem para JAR/WAR/binarios gerados no job (o Auto Packager so ve o tree do commit). |
| `pipeline_scan_max_artifacts` | nao | `'6'` | Teto de artefatos no Pipeline Scan (1–6). Cada um é um scan em série. Limite da composite/pacing, não da Veracode (a conta tem 6 starts / 60 s). |
| `pipeline_scan_pace_seconds` | nao | `'12'` | Espera entre starts neste job (folga para o limite 6/60 s da conta). |
| `pipeline_scan_retry` | nao | `'true'` | Repete uma vez os slots sem `results.json` válido (429, timeout transitório, download do jar). |
| `upload_scan_artifacts` | nao | `'all'` | `all` = diretório com todos os zips do Auto Packager; `primary` = só o primeiro artefato scannable. |
| `enable_pipelinescan` | nao | `'true'` | Usado quando `baseline_mode: 'none'`. Desative para rodar so Upload & Scan. |
| `baseline_mode` | nao | `'none'` | `none` \| `portal_afrika` \| `repo`. |
| `portal_afrika_api_key` | nao* | - | Obrigatorio quando `baseline_mode: 'portal_afrika'`. |
| `portal_afrika_base_url` | nao | `https://www.bantuu.io` | Sem barra final. |
| `baseline_org` | nao* | - | Obrigatorio quando `baseline_mode: 'repo'`. A org deve ter o repo informado em `baseline_repo_name`. |
| `baseline_repo_name` | nao | `Afrika-Veracode-Connect-Baseline` | Nome do repositório de store de baseline (modo `repo`). Altere se a org usar outro repo. |
| `baseline_repo_branch` | nao | *(vazio — default_branch do store)* | Branch do store onde o baseline é lido e gravado. Vazio mantém o comportamento atual (`default_branch` do store, em geral `main`). |
| `baseline_github_app_id` | nao* | - | GitHub App ID (modo `repo`). |
| `baseline_github_app_private_key` | nao* | - | Private key PEM do App (modo `repo`). |
| `baseline_github_app_installation_id` | nao* | - | Installation ID do App (modo `repo`). |
| `baseline_github_token` | nao* | - | PAT fallback (modo `repo`). |
| `policy_fail` | nao | `'false'` | Controla `fail_build` do Pipeline Scan. |
| `fail_build` | nao | `'true'` | Se `'true'`, trava a esteira quando qualquer scan falhar. |
| `fail_on_severity` | nao | - | Aplicado apenas quando existir baseline (ex.: `Very High, High`). |
| `veracode_policy_name` | nao | `''` | Nome da policy no Veracode. Pipeline Scan sempre recebe o valor. Upload & Scan só envia `policy` à plataforma quando o input está preenchido (vazio = policy do perfil/org). |
| `create_issues` | nao | `'false'` | Cria issues no repositório: SCA (`veracode-sca` → `create-issues`) e Pipeline Scan (`veracode-flaws-to-issues`). Requer `issues: write` no workflow. |
| `comment_pr` | nao | `'false'` | Comentário sticky no PR com tabelas resumidas dos scans. Requer `pull-requests: write` e evento de Pull Request. |
| `enable_upload_scan` | nao | `'false'` | Upload & Scan (static) roda por ultimo. |
| `veracode_sandbox` | nao | *(vazio — auto)* | Omitido: branch default → app principal; outras branches → sandbox. `'true'`/`'false'` forçam o modo. |
| `veracode_sandbox_name` | nao* | - | Obrigatório quando `veracode_sandbox: 'true'`. Mapeado para `sandboxname` do Upload & Scan (até 80 chars). Em modo auto, se omitido usa `{branch} - {appname}`. |
| `enable_sca` | nao | `'false'` | Ativa SCA (via `veracode/veracode-sca`). |
| `veracode_sca_token` | nao* | - | Obrigatorio na pratica quando `enable_sca: 'true'`. |
| `enable_iac` | nao | `'false'` | Ativa IaC/Secrets (directory scan). |
| `veracode_appname` | nao | `${{ github.repository }}` | Nome do app no Veracode. |

## Seed do baseline (`portal_afrika` e `repo`)

O baseline é criado **somente na `default_branch`** do repositório (ex.: `main`):

| Situação | Comportamento |
|---|---|
| Sem baseline + execução na `default_branch` | Pipeline Scan sem baseline e **grava/envia** o seed |
| Sem baseline + execução em outra branch/PR | Pipeline Scan sem baseline; seed **não** é gravado (warning no log) |
| Com baseline existente + `default_branch` | Pipeline Scan **com** baseline; depois o `results.json` **regrava** o store (Portal e repo) |
| Com baseline existente + outra branch/PR | Pipeline Scan **com** baseline; o store **não** é alterado (modo repo). Portal Afrika reenvia o resultado. |

Assim o baseline reflete a linha principal, não a primeira feature branch que rodou o job.

### Re-seed após a 1.4.0 (bundle → zips originais)

A 1.4.0 parou de remisturar os zips do Auto Packager. O baseline gravado sobre o bundle antigo (caminhos com prefixo `<nome-do-zip>/…`) **não casa** com os artefatos originais. O primeiro run mostra findings antigos como novos.

Rode na `default_branch` (Portal Afrika e modo repo). O próximo envio de `results.json` regrava o baseline. Não é preciso apagar `{org}/{repo}/baseline.json` no store.

Seed com resultado parcial (`scan_error_count != 0`) é bloqueado: união incompleta envenenaria as comparações seguintes.

## Repo Baseline (`baseline_mode: 'repo'`)

Quando `baseline_mode: 'repo'`, o Veracode Connect usa um repositório GitHub como store de baseline (alternativa ao Portal Afrika).

O nome do repositório de store é `Afrika-Veracode-Connect-Baseline` por default (`baseline_repo_name`). Crie-o (preferencialmente privado) na organização informada em `baseline_org` **antes** de ativar o modo, ou passe outro nome se a org já tiver um store diferente.

A branch do store é a `default_branch` do repositório (em geral `main`). Passe `baseline_repo_branch` se quiser ler e gravar o baseline em outra branch.

O store **não** deve estar vazio: a API do GitHub exige pelo menos um commit inicial. Um `README.md` na raiz é o jeito certo de inicializar. O seed adiciona `{org-do-app}/{repo-do-app}/baseline.json` (ex.: `Afrika-Tecnologia/exemplo-app/baseline.json`) sem substituir o README. Nas execuções seguintes na `default_branch`, o mesmo arquivo é **atualizado** com o `results.json` do scan (como o Portal Afrika). Pull requests só leem o baseline.

Auth (escolha uma):

| Preferência | Inputs |
|---|---|
| **GitHub App** (recomendado) | `baseline_github_app_id` + `baseline_github_app_private_key` + `baseline_github_app_installation_id` |
| **PAT** (fallback) | `baseline_github_token` |

Se o App estiver incompleto e o PAT estiver preenchido, a action usa o PAT com warning. A validação falha cedo se o repo de baseline não existir ou se o token não tiver acesso.

### Permissões do GitHub App (recomendado)

Crie um GitHub App na org (ou conta) que possui o repositório de store (`baseline_repo_name`, default `Afrika-Veracode-Connect-Baseline`). Na criação, configure:

**Repository permissions** (somente estas são necessárias):

| Permissão | Nível | Motivo |
|---|---|---|
| **Contents** | **Read and write** | Ler `baseline.json` e gravar o seed (Contents + Git Data API: blob/tree/commit/ref) |
| **Metadata** | Read-only | Exigida automaticamente pelo GitHub ao conceder Contents |

O commit de seed usa autor/committer `[BOT] Afrika-Veracode-Connect-Baseline` (`veracode.connect@afrikatech.com.br`).

Demais permissões (Issues, Pull requests, Actions, etc.) podem ficar em **No access**.

Depois:

1. Gere e baixe a **private key** (PEM) → secret `BASELINE_GITHUB_APP_PRIVATE_KEY`.
2. Anote o **App ID** → secret `BASELINE_GITHUB_APP_ID`.
3. Instale o App na org do baseline, restringindo a instalação ao repositório de store (`baseline_repo_name`, default `Afrika-Veracode-Connect-Baseline`) ou à org, se preferir.
4. Anote o **Installation ID** (URL da instalação ou API) → secret `BASELINE_GITHUB_APP_INSTALLATION_ID`.
5. Defina `baseline_org` (variável/input) com a org dona do repo de baseline. Se o store não usar o nome default, passe também `baseline_repo_name`. Se o store não usar a `default_branch`, passe `baseline_repo_branch`.

### GitHub Enterprise (Cloud ou Server)

O seed já usa `github.api_url` (github.com → `https://api.github.com`; GHES → `https://<host>/api/v3`). **O mesmo fluxo** grava o baseline em Cloud, GHEC e GHES — não há caminho separado. Permissões do App/PAT são as mesmas. O que costuma bloquear em Enterprise **não é o README**:

| Ponto | O que observar |
|---|---|
| **Ruleset / branch protection** na branch do store (`baseline_repo_branch` ou `default_branch`, em geral `main`) | Exigir PR, impedir push do App ou exigir commit assinado. O seed faz commit direto; se a regra não tiver bypass para o GitHub App, a API devolve 409/403/422 e o arquivo **não** é criado. Inclua o App na lista de bypass (ou não proteja essa branch). |
| **SSO (SAML)** | PAT precisa estar autorizado no SSO da enterprise. GitHub App instalado na org já passa pelo SSO. |
| **EMU (Enterprise Managed Users)** | Alguns tenants rejeitam committer com e-mail externo (`veracode.connect@afrikatech.com.br`). Se o commit for recusado, use PAT de uma conta da enterprise ou ajuste a política de identidade. |
| **GHES (Server)** | O App tem que ser **criado e instalado na instância** (App ID/key de github.com não servem). Git Data API existe; versões antigas usam `/git/refs` em vez de `/git/ref` — a action tenta os dois. |
| **IP allow list** | Runners hospedados precisam estar na allow list da org, senão a API falha com 403. |

### Permissões do PAT (fallback)

Use só se não puder usar GitHub App. O token precisa acessar **apenas** o repositório de store (`baseline_repo_name`, default `Afrika-Veracode-Connect-Baseline`) com leitura e escrita de conteúdo.

**Fine-grained PAT** (preferível ao classic):

| Configuração | Valor |
|---|---|
| Resource owner | Org (ou user) dona do repositório de store |
| Repository access | Only select repositories → o repo informado em `baseline_repo_name` |
| Permissions → Contents | **Read and write** |
| Permissions → Metadata | Read-only (automático) |

**Classic PAT** (legado):

| Scope | Motivo |
|---|---|
| `repo` | Acesso completo a repositórios privados (necessário para Contents API no repo privado de baseline) |

Armazene em `BASELINE_GITHUB_TOKEN` e passe em `baseline_github_token`. Evite PAT de usuário humano de longo prazo; prefira App ou fine-grained com escopo mínimo.

### Permissões do workflow (`GITHUB_TOKEN`)

Independente do App/PAT de baseline, o **job** que chama a action precisa declarar permissions do `GITHUB_TOKEN` (composite actions não podem definir isso):

```yml
permissions:
  contents: read   # mínimo (checkout / ações internas)
```

Com `create_issues: 'true'` (issues no **repositório sendo scaneado**, não no store de baseline):

```yml
permissions:
  contents: read
  issues: write
```

O App/PAT de baseline **não** substitui `issues: write` — a criação de issues usa o `GITHUB_TOKEN` do workflow no repo da aplicação.

Com `comment_pr: 'true'` (comentário sticky no PR do **repositório sendo scaneado**):

```yml
permissions:
  contents: read
  pull-requests: write
```

O comentário segue o mesmo formato do Step Summary (títulos, tabelas de severidade e Resumo Final). O rodapé aponta para o Step Summary da execução.

## Outputs

| Output | Descricao |
|---|---|
| `baseline_mode` | Modo resolvido: `none` \| `portal_afrika` \| `repo`. |
| `has_baseline` | `'true'/'false'` indicando se existe baseline para o repo. |
| `pipeline_status` | Um de: `scan_completed_with_baseline`, `scan_completed_without_baseline_and_uploaded`, `scan_completed_without_baseline`, `scan_completed_without_portal_afrika`, `scan_failed_with_baseline`, `scan_failed_without_baseline_and_uploaded`, `scan_failed_without_baseline`, `scan_failed_without_portal_afrika`, `pipeline_scan_disabled`. |
| `repository_full_name` | `org/repo` (a partir de `github.repository`). |
| `sca_status` | Resultado do SCA: `success` \| `warning` \| `skipped`. |
| `iac_status` | Resultado do IaC: `success` \| `failure` \| `skipped`. |
| `upload_scan_status` | Resultado do Upload & Scan: `success` \| `failure` \| `skipped`. |

## Artefatos (sempre publicados quando o modulo roda)

- `sca-results`: `veracode_sca.log`, `scaResults.txt` ou `scaResults.json` (conforme `create_issues`)
- `iac-results`: pasta `iac-results/` com `results.json`, `results.txt` e SBOMs (se gerados)
- `pipescan-results`: `results.json`, `filtered_results.json`, `results-*.json` e `filtered-*.json` (um par por slot)

## Pipeline Scan — vários artefatos

Com Auto Packager, a CLI gera zips a partir do **commit do job** (`git archive` em `$RUNNER_TEMP`), não do diretório de trabalho. Build, `node_modules`, `target/` e `agent.zip` criados no mesmo job ficam de fora. Quem precisa desses binários usa `enable_auto_packager: 'false'` e `scan_file`. Submodules não entram no archive.

Cada zip com código analisável pelo [Pipeline Scan](https://docs.veracode.com/r/Pipeline_Scan_Supported_Languages) vira um scan em série (`internal/pipeline-scan-set`). Artefatos só com HTML, lockfile, teste ou dependência ficam de fora do Pipeline Scan, mas seguem íntegros no Upload & Scan.

O teto de 6 slots é da composite (pacing). A Veracode limita **6 starts / 60 s por conta**; o default `pipeline_scan_pace_seconds: '12'` deixa folga para outros jobs.

## SCA — comportamento fixo

- Action upstream: `veracode/veracode-sca@v2.1.19`
- `allow-dirty: true`, `recursive: true`, `update_advisor: true`
- `breakBuildOnPolicyFindings: false` (falha vira `sca_status=warning`; trava final via `build-gate`)
- `create_issues: 'false'` (default) → artefato textual (`scaResults.txt`)
- `create_issues: 'true'` → a action SCA cria **issues direto no repositório** para vulnerabilidades encontradas (`create-issues: true`, saída JSON)
- `platformType`: auto (`CLOUD` em github.com, `ENTERPRISE` em GHES)

## Pipeline Scan — create issues

A action `veracode/Veracode-pipeline-scan-action` **não** possui `create-issues`. Com `create_issues: 'true'`, após o scan o Veracode Connect roda `veracode/veracode-flaws-to-issues` usando `filtered_results.json` (se existir), importando flaws como **issues no repositório**.

## Upload & Scan (static) - comportamento fixo

- `appname` = input `veracode_appname` (default `${{ github.repository }}`)
- `filepath` = diretório plano `.veracode-connect/upload/` (todos os zips, barra final obrigatória) quando `upload_scan_artifacts: 'all'` e o Auto Packager rodou **sem sandbox**. Em sandbox a action oficial da Veracode não concatena `diretório+arquivo`; a Connect envia o zip único ou um ZIP STORE dos artefatos. Sem Auto Packager, usa o `scan_file`.
- `createprofile: true` + `gitRepositoryUrl` = `{server_url}/{org/repo}` (sem `.git`)
- `policy` = `veracode_policy_name` quando preenchido; omitido/vazio deixa a policy do app na plataforma
- nao espera o scan finalizar (submit assincrono). `failbuild: true` (fixo): falha de upload/prescan falha o step. Policy do scan estático não entra nesta trava (sem `scantimeout`); a trava de esteira continua no `build-gate` / `fail_build`
- `deleteincompletescan: true`
- sandbox (quando ativo): auto por branch (default branch → app principal; demais → sandbox) ou `'true'`/`'false'` explicito
- `sandboxname` (com sandbox): `veracode_sandbox_name` se informado; senão `{branch} - {appname}` (até 80 chars). Com `veracode_sandbox: 'true'`, `veracode_sandbox_name` é obrigatório.
- `version`: `Scan via Veracode Connect: <repo_url> - <run_id>-<run_number>-<run_attempt>`
- `platformType`: auto (`CLOUD` em github.com, `ENTERPRISE` em GHES)
- **Java wrapper local**: o Connect embute `vosp-api-wrappers-java` em `internal/veracode-upload-scan/vendor/` e intercepta o download Maven da `uploadandscan-action` (evita 429 no Central). Atualização do jar é **manual** — ver `vendor/README.md`.

## Dependencias upstream (pinadas por SHA)

Todas as actions externas usadas pelo Veracode Connect sao pinadas por **commit SHA** (nao por tag flutuante):

| Capability | Action | Versao |
|---|---|---|
| Pipeline Scan | `veracode/Veracode-pipeline-scan-action` | v1.0.23 |
| SCA | `veracode/veracode-sca` | v2.1.19 |
| IaC/Secrets | `veracode/container_iac_secrets_scanning` | v1.0.8 |
| Upload & Scan (SAST) | `veracode/uploadandscan-action` | v0.2.2 |
| Flaws → Issues | `veracode/veracode-flaws-to-issues` | v2.2.26 |
| Auto Packager CLI | Veracode CLI | 2.51.2 |

## Exemplos

Escolha um exemplo e copie para `.github/workflows/`.

### Mais completo (para testar tudo)

- SCA + IaC + Auto Packager + Baseline + Upload & Scan -> [abrir](examples/autopackager-with-baseline-sca-iac-upload.yml)
- SCA + IaC + Auto Packager + Repo Baseline + Upload & Scan -> [abrir](examples/autopackager-with-repo-baseline-sca-iac-upload.yml)

### Autopackager (gera o `.zip` automaticamente)

A CLI grava os pacotes em `.veracode-connect/packaged/` (isolado do workspace). A action classifica cada artefato pelo conteúdo do ZIP (sem extrair nem recompactar): código de linguagens do Pipeline Scan entra no scan; ruído, teste (segmento exato `test`/`tests`/`spec`/`__tests__`/`e2e` ou glob `*.test.*`) e dependências (`node_modules`, `vendor`, `.venv`) não. Cópia byte-idêntica de **todos** os artefatos vai para `.veracode-connect/upload/` (Upload & Scan, um build / N módulos). Se a CLI não gerar nenhum artefato válido, o job **falha** — ZIP já existente no repositório não é usado.

- Auto Packager + Pipeline Scan (multi-linguagem) -> [abrir](examples/autopackager-without-baseline-multi-language.yml)
- Auto Packager + Baseline -> [abrir](examples/autopackager-with-baseline.yml)
- Auto Packager + Repo Baseline -> [abrir](examples/autopackager-with-repo-baseline.yml)
- Auto Packager + Pipeline Scan -> [abrir](examples/autopackager-without-baseline.yml)
- Auto Packager + Baseline + Upload & Scan -> [abrir](examples/autopackager-with-baseline-and-upload-scan.yml)
- Auto Packager + Repo Baseline + Upload & Scan -> [abrir](examples/autopackager-with-repo-baseline-and-upload-scan.yml)
- Auto Packager + Pipeline Scan + Upload & Scan -> [abrir](examples/autopackager-without-baseline-and-upload-scan.yml)
- Auto Packager + Baseline + SCA -> [abrir](examples/autopackager-with-baseline-sca.yml)
- Auto Packager + Repo Baseline + SCA -> [abrir](examples/autopackager-with-repo-baseline-sca.yml)
- Auto Packager + Baseline + IaC -> [abrir](examples/autopackager-with-baseline-iac.yml)
- Auto Packager + Repo Baseline + IaC -> [abrir](examples/autopackager-with-repo-baseline-iac.yml)
- Auto Packager + Baseline + SCA + IaC -> [abrir](examples/autopackager-with-baseline-sca-iac.yml)
- Auto Packager + Repo Baseline + SCA + IaC -> [abrir](examples/autopackager-with-repo-baseline-sca-iac.yml)
- Auto Packager + Baseline + SCA + Upload & Scan -> [abrir](examples/autopackager-with-baseline-sca-upload.yml)
- Auto Packager + Repo Baseline + SCA + Upload & Scan -> [abrir](examples/autopackager-with-repo-baseline-sca-upload.yml)
- Auto Packager + Baseline + IaC + Upload & Scan -> [abrir](examples/autopackager-with-baseline-iac-upload.yml)
- Auto Packager + Repo Baseline + IaC + Upload & Scan -> [abrir](examples/autopackager-with-repo-baseline-iac-upload.yml)
- Auto Packager + Pipeline Scan + SCA -> [abrir](examples/autopackager-without-baseline-sca.yml)
- Auto Packager + Pipeline Scan + SCA + Upload & Scan -> [abrir](examples/autopackager-without-baseline-sca-upload.yml)
- Auto Packager + Pipeline Scan + IaC + Upload & Scan -> [abrir](examples/autopackager-without-baseline-iac-upload.yml)
- Auto Packager + Pipeline Scan + SCA + IaC + Upload & Scan -> [abrir](examples/autopackager-without-baseline-sca-iac-upload.yml)

### scan_file (consome o artefato do seu build)

- scan_file + Baseline -> [abrir](examples/artifact-with-baseline.yml)
- scan_file + Repo Baseline -> [abrir](examples/artifact-with-repo-baseline.yml)
- scan_file + Pipeline Scan -> [abrir](examples/artifact-without-baseline.yml)
- scan_file + Baseline + Upload & Scan -> [abrir](examples/artifact-with-baseline-and-upload-scan.yml)
- scan_file + Repo Baseline + Upload & Scan -> [abrir](examples/artifact-with-repo-baseline-and-upload-scan.yml)
- scan_file + Baseline + Upload & Scan (app principal) -> [abrir](examples/artifact-with-baseline-and-upload-scan-no-sandbox.yml)
- scan_file + Repo Baseline + Upload & Scan (app principal) -> [abrir](examples/artifact-with-repo-baseline-and-upload-scan-no-sandbox.yml)
- scan_file + Baseline + fail_on_severity -> [abrir](examples/artifact-with-baseline-fail-on-severity.yml)
- scan_file + Repo Baseline + fail_on_severity -> [abrir](examples/artifact-with-repo-baseline-fail-on-severity.yml)
- scan_file + Pipeline Scan + Upload & Scan -> [abrir](examples/artifact-without-baseline-and-upload-scan.yml)
- scan_file + Baseline + SCA -> [abrir](examples/artifact-with-baseline-sca.yml)
- scan_file + Repo Baseline + SCA -> [abrir](examples/artifact-with-repo-baseline-sca.yml)
- scan_file + Baseline + IaC -> [abrir](examples/artifact-with-baseline-iac.yml)
- scan_file + Repo Baseline + IaC -> [abrir](examples/artifact-with-repo-baseline-iac.yml)
- scan_file + Baseline + SCA + IaC -> [abrir](examples/artifact-with-baseline-sca-iac.yml)
- scan_file + Repo Baseline + SCA + IaC -> [abrir](examples/artifact-with-repo-baseline-sca-iac.yml)
- scan_file + Baseline + SCA + Upload & Scan -> [abrir](examples/artifact-with-baseline-sca-upload.yml)
- scan_file + Repo Baseline + SCA + Upload & Scan -> [abrir](examples/artifact-with-repo-baseline-sca-upload.yml)
- scan_file + Baseline + IaC + Upload & Scan -> [abrir](examples/artifact-with-baseline-iac-upload.yml)
- scan_file + Repo Baseline + IaC + Upload & Scan -> [abrir](examples/artifact-with-repo-baseline-iac-upload.yml)
- scan_file + Baseline + SCA + IaC + Upload & Scan -> [abrir](examples/artifact-with-baseline-sca-iac-upload.yml)
- scan_file + Repo Baseline + SCA + IaC + Upload & Scan -> [abrir](examples/artifact-with-repo-baseline-sca-iac-upload.yml)
- scan_file + Pipeline Scan + SCA -> [abrir](examples/artifact-without-baseline-sca.yml)
- scan_file + Pipeline Scan + IaC -> [abrir](examples/artifact-without-baseline-iac.yml)
- scan_file + Pipeline Scan + SCA + IaC -> [abrir](examples/artifact-without-baseline-sca-iac.yml)
- scan_file + Pipeline Scan + SCA + Upload & Scan -> [abrir](examples/artifact-without-baseline-sca-upload.yml)
- scan_file + Pipeline Scan + IaC + Upload & Scan -> [abrir](examples/artifact-without-baseline-iac-upload.yml)
- scan_file + Pipeline Scan + SCA + IaC + Upload & Scan -> [abrir](examples/artifact-without-baseline-sca-iac-upload.yml)

### Pipeline Scan desativado (so Upload & Scan)

- Upload & Scan only (scan_file) -> [abrir](examples/pipeline-disabled-upload-scan-only-artifact.yml)
- Upload & Scan only (auto packager) -> [abrir](examples/pipeline-disabled-upload-scan-only-autopackager.yml)
- Upload & Scan only + SCA (scan_file) -> [abrir](examples/pipeline-disabled-upload-scan-only-artifact-sca.yml)
- Upload & Scan only + IaC (scan_file) -> [abrir](examples/pipeline-disabled-upload-scan-only-artifact-iac.yml)
- Upload & Scan only + SCA (auto packager) -> [abrir](examples/pipeline-disabled-upload-scan-only-autopackager-sca.yml)
- Upload & Scan only + IaC (auto packager) -> [abrir](examples/pipeline-disabled-upload-scan-only-autopackager-iac.yml)

### Pipeline Scan (sem baseline) - enxuto

- Pipeline Scan + SCA (auto packager) -> [abrir](examples/pipeline-only-with-sca.yml)
- Pipeline Scan + IaC (auto packager) -> [abrir](examples/pipeline-only-with-iac.yml)
- Pipeline Scan + SCA + IaC (auto packager) -> [abrir](examples/pipeline-only-with-sca-iac.yml)

## Ordem de release (sub-actions `@v1`)

As sub-actions internas (`internal/pipeline-scan-set`, `internal/auto-packager`, fluxos de scan, etc.) são referenciadas como `Afrika-Tecnologia/Veracode-Connect/internal/<nome>@v1`. `uses: ./internal/...` **não** funciona dentro de uma composite consumida de outro repositório.

Por isso a tag `v1` precisa apontar para o commit da release **antes** de anunciar. Validação na tag, antes de mover/anunciar:

1. Repositório multi-linguagem com 3+ artefatos do Auto Packager — N Pipeline Scans, `results.json` unificado, manifesto em `.veracode-connect/scans/manifest.json`.
2. Sandbox real — N módulos no mesmo build. Confirma o default `upload_scan_artifacts: all`. Se o wrapper Java reenviar o diretório a cada iteração, o mesmo release sai com default `primary`.
3. Primeiro run com baseline legado (bundle antigo) — findings antigos aparecem como novos; depois o re-seed (apagar `baseline.json` no store no modo repo, ou próximo run na `default_branch` no Portal Afrika).
