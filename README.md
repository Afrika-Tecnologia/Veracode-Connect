# Veracode Integration Helper

Uma GitHub Action **facilitadora para implementar o Veracode no seu repositório**, com suporte opcional ao **baseline via Bantuu**.

Ela combina (no mesmo fluxo) Pipeline Scan, Upload & Scan (static), e opcionalmente SCA e IaC/Secrets.

## Fluxo (ordem dos steps)

1) (Opcional) Veracode SCA (`enable_sca: 'true'`)
2) (Opcional) Veracode IaC/Secrets (`enable_iac: 'true'`)
3) Define o `.zip` do scan:
   - `enable_auto_packager: 'true'` → tenta Auto Packager (com fallback para `app.zip`)
   - `enable_auto_packager: 'false'` → usa o `scan_file` que você fornecer
4) (Opcional) Pipeline Scan (`enable_pipelinescan: 'true'`) com ou sem baseline Bantuu (`enable_baseline`)
5) (Opcional) Upload & Scan (static) por último (`enable_upload_scan: 'true'`)

## Inputs

Todos os booleanos devem ser passados como string: `'true'` / `'false'`.

| Input | Obrigatório | Default | Notas |
|---|---:|---:|---|
| `veracode_api_id` | sim | - | VID do Veracode. |
| `veracode_api_key` | sim | - | VKEY do Veracode. |
| `enable_auto_packager` | não | `'false'` | Se `'true'`, tenta gerar `app.zip` automaticamente; senão usa `scan_file`. |
| `scan_file` | não* | - | Obrigatório na prática quando `enable_auto_packager: 'false'`. |
| `enable_pipelinescan` | não | `'true'` | Desative para rodar só Upload & Scan. |
| `enable_baseline` | não | `'true'` | Usa baseline Bantuu (somente com Pipeline Scan ativo). |
| `bantuu_api_key` | não* | - | Obrigatório na prática quando `enable_baseline: 'true'`. |
| `policy_fail` | não | `'false'` | Controla `fail_build` do Pipeline Scan. |
| `fail_on_severity` | não | - | Aplicado apenas quando existir baseline (ex.: `Very High, High`). |
| `enable_upload_scan` | não | `'false'` | Upload & Scan (static) roda por último. |
| `veracode_sandbox` | não | `'true'` | Se `'true'`, cria/usa sandbox; senão usa o app principal. |
| `enable_sca` | não | `'false'` | Ativa SCA. |
| `veracode_sca_token` | não* | - | Obrigatório na prática quando `enable_sca: 'true'`. |
| `enable_iac` | não | `'false'` | Ativa IaC/Secrets (directory scan). |
| `enable_Business_unit` | não | `'false'` | Se `'true'`, vincula o app a UMA Business Unit via REST (após Upload & Scan). |
| `veracode_business_unit` | não | `''` | Nome da BU (ex.: `BU TI`). Se contiver vírgula, a action falha. |

## Outputs

| Output | Descrição |
|---|---|
| `has_baseline` | `'true'/'false'` indicando se existe baseline para o repo. |
| `pipeline_status` | Um de: `scan_completed_with_baseline`, `scan_completed_without_baseline_and_uploaded`, `scan_completed_without_bantuu`, `pipeline_scan_disabled`. |
| `repository_full_name` | `org/repo` (a partir de `github.repository`). |
| `business_unit_name` | Nome da BU aplicada. |
| `business_unit_guid` | GUID da BU aplicada. |
| `set_business_unit_status` | `skipped` \| `success` \| `failed`. |

## Artefatos (sempre publicados quando o módulo roda)

- `sca-results`: `veracode_sca.log`
- `iac-results`: pasta `iac-results/` com `results.json`, `results.txt` e SBOMs (se gerados)
- `pipescan-results`: `results.json` e `filtered_results.json` (se existir)

## Business Unit (opcional)

Para vincular o app (nome `org/repo`) a uma BU após o Upload & Scan:

- Inputs: `enable_Business_unit`, `veracode_business_unit`
- Nota: a Veracode permite apenas 1 BU por aplicação. Se for informado mais de um valor (ex.: com vírgula), a action falha.

## Upload & Scan (static) - comportamento fixo

- `appname = org/repo`
- `createprofile: true`
- não espera o scan finalizar (`scantimeout: 0`)
- sempre ativa: `scanallnonfataltoplevelmodules`, `includenewmodules`, `deleteincompletescan: 2`
- `sandboxname` (quando `veracode_sandbox: 'true'`): `{branch}-{org-repo}`
- `version`: `Scan from Bantuu Actions: <repo_url> - <run_id>-<run_number>-<run_attempt>`

## Exemplos

Escolha um exemplo e copie para `.github/workflows/`.

### Mais completo (para testar tudo)

- SCA + IaC + Auto Packager + Baseline + Upload & Scan → [abrir](examples/autopackager-with-baseline-sca-iac-upload.yml)
- SCA + IaC + Auto Packager + Baseline + Upload & Scan + Business Unit → [abrir](examples/autopackager-with-baseline-sca-iac-upload-bu.yml)

### Autopackager (gera o `.zip` automaticamente)

- Auto Packager + Baseline → [abrir](examples/autopackager-with-baseline.yml)
- Auto Packager + Pipeline Scan → [abrir](examples/autopackager-without-baseline.yml)
- Auto Packager + Baseline + Upload & Scan → [abrir](examples/autopackager-with-baseline-and-upload-scan.yml)
- Auto Packager + Pipeline Scan + Upload & Scan → [abrir](examples/autopackager-without-baseline-and-upload-scan.yml)
- Auto Packager + Baseline + SCA → [abrir](examples/autopackager-with-baseline-sca.yml)
- Auto Packager + Baseline + IaC → [abrir](examples/autopackager-with-baseline-iac.yml)
- Auto Packager + Baseline + SCA + IaC → [abrir](examples/autopackager-with-baseline-sca-iac.yml)
- Auto Packager + Baseline + SCA + Upload & Scan → [abrir](examples/autopackager-with-baseline-sca-upload.yml)
- Auto Packager + Baseline + IaC + Upload & Scan → [abrir](examples/autopackager-with-baseline-iac-upload.yml)
- Auto Packager + Pipeline Scan + SCA → [abrir](examples/autopackager-without-baseline-sca.yml)
- Auto Packager + Pipeline Scan + SCA + Upload & Scan → [abrir](examples/autopackager-without-baseline-sca-upload.yml)
- Auto Packager + Pipeline Scan + IaC + Upload & Scan → [abrir](examples/autopackager-without-baseline-iac-upload.yml)
- Auto Packager + Pipeline Scan + SCA + IaC + Upload & Scan → [abrir](examples/autopackager-without-baseline-sca-iac-upload.yml)

### scan_file (consome o artefato do seu build)

- scan_file + Baseline → [abrir](examples/artifact-with-baseline.yml)
- scan_file + Pipeline Scan → [abrir](examples/artifact-without-baseline.yml)
- scan_file + Baseline + Upload & Scan → [abrir](examples/artifact-with-baseline-and-upload-scan.yml)
- scan_file + Baseline + Upload & Scan (app principal) → [abrir](examples/artifact-with-baseline-and-upload-scan-no-sandbox.yml)
- scan_file + Baseline + fail_on_severity → [abrir](examples/artifact-with-baseline-fail-on-severity.yml)
- scan_file + Pipeline Scan + Upload & Scan → [abrir](examples/artifact-without-baseline-and-upload-scan.yml)
- scan_file + Baseline + SCA → [abrir](examples/artifact-with-baseline-sca.yml)
- scan_file + Baseline + IaC → [abrir](examples/artifact-with-baseline-iac.yml)
- scan_file + Baseline + SCA + IaC → [abrir](examples/artifact-with-baseline-sca-iac.yml)
- scan_file + Baseline + SCA + Upload & Scan → [abrir](examples/artifact-with-baseline-sca-upload.yml)
- scan_file + Baseline + IaC + Upload & Scan → [abrir](examples/artifact-with-baseline-iac-upload.yml)
- scan_file + Baseline + SCA + IaC + Upload & Scan → [abrir](examples/artifact-with-baseline-sca-iac-upload.yml)
- scan_file + Pipeline Scan + SCA → [abrir](examples/artifact-without-baseline-sca.yml)
- scan_file + Pipeline Scan + IaC → [abrir](examples/artifact-without-baseline-iac.yml)
- scan_file + Pipeline Scan + SCA + IaC → [abrir](examples/artifact-without-baseline-sca-iac.yml)
- scan_file + Pipeline Scan + SCA + Upload & Scan → [abrir](examples/artifact-without-baseline-sca-upload.yml)
- scan_file + Pipeline Scan + IaC + Upload & Scan → [abrir](examples/artifact-without-baseline-iac-upload.yml)
- scan_file + Pipeline Scan + SCA + IaC + Upload & Scan → [abrir](examples/artifact-without-baseline-sca-iac-upload.yml)

### Pipeline Scan desativado (só Upload & Scan)

- Upload & Scan only (scan_file) → [abrir](examples/pipeline-disabled-upload-scan-only-artifact.yml)
- Upload & Scan only (auto packager) → [abrir](examples/pipeline-disabled-upload-scan-only-autopackager.yml)
- Upload & Scan only + SCA (scan_file) → [abrir](examples/pipeline-disabled-upload-scan-only-artifact-sca.yml)
- Upload & Scan only + IaC (scan_file) → [abrir](examples/pipeline-disabled-upload-scan-only-artifact-iac.yml)
- Upload & Scan only + SCA (auto packager) → [abrir](examples/pipeline-disabled-upload-scan-only-autopackager-sca.yml)
- Upload & Scan only + IaC (auto packager) → [abrir](examples/pipeline-disabled-upload-scan-only-autopackager-iac.yml)

### Pipeline Scan (sem baseline) - enxuto

- Pipeline Scan + SCA (auto packager) → [abrir](examples/pipeline-only-with-sca.yml)
- Pipeline Scan + IaC (auto packager) → [abrir](examples/pipeline-only-with-iac.yml)
- Pipeline Scan + SCA + IaC (auto packager) → [abrir](examples/pipeline-only-with-sca-iac.yml)
