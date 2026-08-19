# Veracode Connect

GitHub Action facilitadora para implementar o Veracode no seu repositorio, com suporte opcional ao baseline via Portal Afrika ou repositorio GitHub.

Uso (exemplo rapido):

```yml
- uses: Afrika-Tecnologia/Veracode-Connect@v1
```

## Fluxo (ordem dos steps)

1) (Opcional) Veracode SCA (`enable_sca: 'true'`)
2) (Opcional) Veracode IaC/Secrets (`enable_iac: 'true'`)
3) Define o `.zip` do scan:
   - `enable_auto_packager: 'true'` -> tenta Auto Packager (com fallback para `app.zip`)
   - `enable_auto_packager: 'false'` -> usa o `scan_file` que voce fornecer
4) (Opcional) Baseline (`baseline_mode: 'portal_afrika'` | `'repo'`) — Pipeline Scan com provedor de baseline
5) (Opcional) Pipeline Scan sem baseline (`baseline_mode: 'none'` + `enable_pipelinescan: 'true'`)
6) (Opcional) Upload & Scan (static) por ultimo (`enable_upload_scan: 'true'`)
7) **Trava de Build** — step final que verifica todos os resultados (`fail_build: 'true'`)

Os logs ficam agrupados no console (`::group::/::endgroup::`).

## Inputs

Todos os booleanos devem ser passados como string: `'true'` / `'false'`.

Com `create_issues: 'true'`, o repositório precisa ter **Issues habilitadas** (Settings → General → Features → Issues) e o workflow **precisa** declarar `permissions: issues: write` no **job ou workflow** que chama esta action (composite actions **não** podem definir permissions). A validação inicial falha cedo com instruções se algum pré-requisito estiver ausente.

| Input | Obrigatorio | Default | Notas |
|---|---:|---:|---|
| `veracode_api_id` | sim | - | VID do Veracode. |
| `veracode_api_key` | sim | - | VKEY do Veracode. |
| `enable_auto_packager` | nao | `'false'` | Se `'true'`, tenta gerar `app.zip` automaticamente; senao usa `scan_file`. |
| `scan_file` | nao* | - | Obrigatorio na pratica quando `enable_auto_packager: 'false'`. |
| `enable_pipelinescan` | nao | `'true'` | Usado quando `baseline_mode: 'none'`. Desative para rodar so Upload & Scan. |
| `baseline_mode` | nao | `'none'` | `none` \| `portal_afrika` \| `repo`. |
| `portal_afrika_api_key` | nao* | - | Obrigatorio quando `baseline_mode: 'portal_afrika'`. |
| `portal_afrika_base_url` | nao | `https://www.bantuu.io` | Sem barra final. |
| `baseline_org` | nao* | - | Obrigatorio quando `baseline_mode: 'repo'`. A org deve ter o repo fixo `Afrika-Veracode-Connect-Baseline`. |
| `baseline_github_app_id` | nao* | - | GitHub App ID (modo `repo`). |
| `baseline_github_app_private_key` | nao* | - | Private key PEM do App (modo `repo`). |
| `baseline_github_app_installation_id` | nao* | - | Installation ID do App (modo `repo`). |
| `baseline_github_token` | nao* | - | PAT fallback (modo `repo`). |
| `policy_fail` | nao | `'false'` | Controla `fail_build` do Pipeline Scan. |
| `fail_build` | nao | `'true'` | Se `'true'`, trava a esteira quando qualquer scan falhar. |
| `fail_on_severity` | nao | - | Aplicado apenas quando existir baseline (ex.: `Very High, High`). |
| `veracode_policy_name` | nao | `''` | Nome da policy a ser usada no scan do Veracode. |
| `create_issues` | nao | `'false'` | Cria issues no repositório: SCA (`veracode-sca` → `create-issues`) e Pipeline Scan (`veracode-flaws-to-issues`). Requer `issues: write` no workflow. |
| `enable_upload_scan` | nao | `'false'` | Upload & Scan (static) roda por ultimo. |
| `veracode_sandbox` | nao | *(vazio — auto)* | Omitido: branch default → app principal; outras branches → sandbox. `'true'`/`'false'` forçam o modo. |
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
| Com baseline existente | Pipeline Scan **com** baseline (qualquer branch) |

Assim o baseline reflete a linha principal, não a primeira feature branch que rodou o job.

## Repo Baseline (`baseline_mode: 'repo'`)

Quando `baseline_mode: 'repo'`, o Veracode Connect usa um repositório GitHub como store de baseline (alternativa ao Portal Afrika).

O nome do repositório de store é **fixo**: `Afrika-Veracode-Connect-Baseline`. Crie-o (preferencialmente privado) na organização informada em `baseline_org` **antes** de ativar o modo.

O store **não** deve estar vazio: a API do GitHub exige pelo menos um commit inicial. Um `README.md` na raiz é o jeito certo de inicializar. O seed adiciona `{org-do-app}/{repo-do-app}/baseline.json` (ex.: `Afrika-Tecnologia/exemplo-app/baseline.json`) sem substituir o README.

Auth (escolha uma):

| Preferência | Inputs |
|---|---|
| **GitHub App** (recomendado) | `baseline_github_app_id` + `baseline_github_app_private_key` + `baseline_github_app_installation_id` |
| **PAT** (fallback) | `baseline_github_token` |

Se o App estiver incompleto e o PAT estiver preenchido, a action usa o PAT com warning. A validação falha cedo se o repo de baseline não existir ou se o token não tiver acesso.

### Permissões do GitHub App (recomendado)

Crie um GitHub App na org (ou conta) que possui `Afrika-Veracode-Connect-Baseline`. Na criação, configure:

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
3. Instale o App na org do baseline, restringindo a instalação ao repositório `Afrika-Veracode-Connect-Baseline` (ou à org, se preferir).
4. Anote o **Installation ID** (URL da instalação ou API) → secret `BASELINE_GITHUB_APP_INSTALLATION_ID`.
5. Defina `baseline_org` (variável/input) com a org dona do repo de baseline.

### GitHub Enterprise (Cloud ou Server)

O seed já usa `github.api_url` (github.com → `https://api.github.com`; GHES → `https://<host>/api/v3`). **O mesmo fluxo** grava o baseline em Cloud, GHEC e GHES — não há caminho separado. Permissões do App/PAT são as mesmas. O que costuma bloquear em Enterprise **não é o README**:

| Ponto | O que observar |
|---|---|
| **Ruleset / branch protection** na `main` do store | Exigir PR, impedir push do App ou exigir commit assinado. O seed faz commit direto; se a regra não tiver bypass para o GitHub App, a API devolve 409/403/422 e o arquivo **não** é criado. Inclua o App na lista de bypass (ou não proteja a `main` desse repo). |
| **SSO (SAML)** | PAT precisa estar autorizado no SSO da enterprise. GitHub App instalado na org já passa pelo SSO. |
| **EMU (Enterprise Managed Users)** | Alguns tenants rejeitam committer com e-mail externo (`veracode.connect@afrikatech.com.br`). Se o commit for recusado, use PAT de uma conta da enterprise ou ajuste a política de identidade. |
| **GHES (Server)** | O App tem que ser **criado e instalado na instância** (App ID/key de github.com não servem). Git Data API existe; versões antigas usam `/git/refs` em vez de `/git/ref` — a action tenta os dois. |
| **IP allow list** | Runners hospedados precisam estar na allow list da org, senão a API falha com 403. |

### Permissões do PAT (fallback)

Use só se não puder usar GitHub App. O token precisa acessar **apenas** `Afrika-Veracode-Connect-Baseline` com leitura e escrita de conteúdo.

**Fine-grained PAT** (preferível ao classic):

| Configuração | Valor |
|---|---|
| Resource owner | Org (ou user) dona de `Afrika-Veracode-Connect-Baseline` |
| Repository access | Only select repositories → `Afrika-Veracode-Connect-Baseline` |
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
- `pipescan-results`: `results.json` e `filtered_results.json` (se existir)

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
- `createprofile: true` + `gitRepositoryUrl` = `{server_url}/{org/repo}` (sem `.git`)
- nao espera o scan finalizar (submit assincrono; `failbuild: false` — trava final via `build-gate`)
- `deleteincompletescan: true`
- sandbox (quando ativo): auto por branch (default branch → app principal; demais → sandbox) ou `'true'`/`'false'` explicito
- `sandboxname` (com sandbox): `{branch} - {appname}` (ate 80 chars)
- `version`: `Scan via Veracode Connect: <repo_url> - <run_id>-<run_number>-<run_attempt>`
- `platformType`: auto (`CLOUD` em github.com, `ENTERPRISE` em GHES)

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
