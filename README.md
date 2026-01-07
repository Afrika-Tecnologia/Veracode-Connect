# Bantuu Veracode Baseline

GitHub Action para rodar o Veracode Pipeline Scan com suporte opcional a baseline do Bantuu, alem de opcoes de Auto Packager, SCA e IaC.

## Como funciona (resumo)

Ordem (sempre):
1) (Opcional) Veracode SCA em background (`enable_sca='true'`)
2) (Opcional) Veracode IaC em background (`enable_iac='true'`)
3) Prepara o artefato `.zip` (Auto Packager ou `scan_file`)
4) Resolve `repository_full_name` (org/repo)
5) (Opcional) Pipeline Scan (`enable_pipelinescan='true'`) com ou sem Bantuu (`enable_baseline`)
6) (Opcional) Upload & Scan (static) como ultimo step (`enable_upload_scan='true'`)

Observacao: hoje o step de preparar o artefato sempre roda. Entao, se `enable_auto_packager!='true'`, voce precisa fornecer `scan_file` mesmo que o Pipeline Scan esteja desativado.

## Inputs (todos os parametros)

Todos os booleans devem ser passados como string: `'true'` / `'false'`.

| Input | Required | Default | Quando usar | Observacoes |
|---|---:|---:|---|---|
| `bantuu_api_key` | nao* | - | Baseline Bantuu | Obrigatorio na pratica quando `enable_pipelinescan='true'` e `enable_baseline='true'`. |
| `enable_sca` | nao | `'false'` | SCA | Dispara SCA em background. |
| `veracode_sca_token` | nao* | - | SCA | Obrigatorio na pratica quando `enable_sca='true'`. |
| `enable_iac` | nao | `'false'` | IaC | Dispara IaC em background. |
| `enable_pipelinescan` | nao | `'true'` | Pipeline Scan | Se `'false'`, nao roda pipeline scan e seta `pipeline_status=pipeline_scan_disabled`. |
| `enable_upload_scan` | nao | `'false'` | Upload & Scan | Se `'true'`, roda Upload & Scan por ultimo usando o mesmo `.zip` preparado. |
| `enable_baseline` | nao | `'true'` | Baseline Bantuu | Se `'true'` e pipeline scan ativo, consulta/usa baseline do Bantuu (e faz upload quando necessario). |
| `enable_auto_packager` | nao | `'false'` | Empacotamento | Se `'true'`, tenta gerar zip via Veracode CLI (`veracode package`). Se a CLI nao suportar o stack (ex.: Node), faz fallback criando `app.zip` com `zip` (exclui `node_modules` e `.git`). |
| `veracode_api_id` | sim | - | Sempre | VID do Veracode. |
| `veracode_api_key` | sim | - | Sempre | VKEY do Veracode. |
| `veracode_sandbox` | nao | `'true'` | Upload & Scan | Se `'true'`, cria/usa sandbox. Se `'false'`, usa o app principal. |
| `scan_file` | nao* | - | Empacotamento | Obrigatorio na pratica quando `enable_auto_packager!='true'` (o arquivo precisa existir). |
| `policy_fail` | nao | `'false'` | Pipeline Scan | Mapeia para `fail_build` do pipeline scan. |
| `fail_on_severity` | nao | - | Pipeline Scan com baseline | Aplicado apenas quando existe baseline (no scan com `baseline_file`). Ex.: `Very High, High`. |

## Outputs

| Output | Descricao |
|---|---|
| `has_baseline` | `'true'/'false'` indicando se o Bantuu retornou baseline para o repo. |
| `pipeline_status` | Um de: `scan_completed_with_baseline`, `scan_completed_without_baseline_and_uploaded`, `scan_completed_without_bantuu`, `pipeline_scan_disabled`. |
| `repository_full_name` | `org/repo` resolvido de `github.repository`. |

## Arquivos gerados (para debug)

- Auto Packager: `app.zip` (quando ativo) e `veracode_package.log`
- Pipeline Scan: `results.json`
- Baseline Bantuu: `baseline-response.json` e (se existir baseline) `baseline.json`
- Background: `veracode_sca.log` e `veracode_iac.log` (os tails desses logs tambem aparecem no console no fim do job)

## Upload & Scan (static) - comportamento fixo

O Upload & Scan sempre:
- usa `appname = repository_full_name` (org/repo)
- `createprofile: true`
- nao espera a conclusao do scan na plataforma (`scantimeout: 0`)
- flags fixas: `scanallnonfataltoplevelmodules: true`, `includenewmodules: true`, `deleteincompletescan: true`
- `version`: `Scan from Bantuu Actions: <repo_url> - <run_id>-<run_number>-<run_attempt>`
- `sandboxname` (quando `veracode_sandbox='true'`): `{branch}-{org-repo}` (sanitizado e truncado)

## Runner / dependencias

- Recomendado: `ubuntu-latest` (usa `bash`).
- O fluxo com baseline instala `jq` via `sudo apt-get` se necessario.
- Quando o Auto Packager precisar fazer fallback para zip, instala `zip` via `sudo apt-get` se necessario.

## Exemplos (workflows)

- [`examples/artifact-with-baseline.yml`](examples/artifact-with-baseline.yml)
- [`examples/artifact-without-baseline.yml`](examples/artifact-without-baseline.yml)
- [`examples/autopackager-with-baseline.yml`](examples/autopackager-with-baseline.yml)
- [`examples/autopackager-without-baseline.yml`](examples/autopackager-without-baseline.yml)
- [`examples/artifact-with-baseline-and-upload-scan.yml`](examples/artifact-with-baseline-and-upload-scan.yml)
- [`examples/artifact-with-baseline-and-upload-scan-no-sandbox.yml`](examples/artifact-with-baseline-and-upload-scan-no-sandbox.yml)
- [`examples/artifact-with-baseline-fail-on-severity.yml`](examples/artifact-with-baseline-fail-on-severity.yml)
- [`examples/artifact-without-baseline-and-upload-scan.yml`](examples/artifact-without-baseline-and-upload-scan.yml)
- [`examples/autopackager-with-baseline-and-upload-scan.yml`](examples/autopackager-with-baseline-and-upload-scan.yml)
- [`examples/autopackager-without-baseline-and-upload-scan.yml`](examples/autopackager-without-baseline-and-upload-scan.yml)
- [`examples/autopackager-with-baseline-sca-iac-upload.yml`](examples/autopackager-with-baseline-sca-iac-upload.yml)
- [`examples/pipeline-disabled-upload-scan-only-artifact.yml`](examples/pipeline-disabled-upload-scan-only-artifact.yml)
- [`examples/pipeline-disabled-upload-scan-only-autopackager.yml`](examples/pipeline-disabled-upload-scan-only-autopackager.yml)
- [`examples/pipeline-only-with-sca.yml`](examples/pipeline-only-with-sca.yml)
- [`examples/pipeline-only-with-iac.yml`](examples/pipeline-only-with-iac.yml)
- [`examples/pipeline-only-with-sca-iac.yml`](examples/pipeline-only-with-sca-iac.yml)
