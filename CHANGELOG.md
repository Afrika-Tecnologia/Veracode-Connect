# Changelog

Todas as mudancas notaveis deste projeto serao documentadas neste arquivo.

O formato e baseado no [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/) e este projeto adota [Versionamento Semantico](https://semver.org/lang/pt-BR/spec/v2.0.0.html).

## [Unreleased]

- N/A.

## [1.0.18] - 2026-01-07

### Documentation
- README: reescrito para ficar mais direto e com a lista de exemplos organizada por cenário, com links clicáveis.

### Changed
- Exemplos: adiciona dezenas de combinações (SCA/IaC/Baseline/Upload & Scan) e padroniza os workflows de `scan_file` para consumir o artefato via `actions/upload-artifact` + `actions/download-artifact` (em vez de gerar o zip no mesmo job do scan).
- Metadata: ajusta descrições de inputs no `action.yml` para refletir o comportamento atual (SCA/IaC).

## [1.0.17] - 2026-01-07

### Changed
- Logs: adiciona grupos no console (`::group::/::endgroup::`) para SCA, Auto Packager e Bantuu baseline (check/upload).
- Auto Packager: fallback do `zip` fica em modo quiet para reduzir poluicao no log.

## [1.0.16] - 2026-01-07

### Fixed
- SCA: executa em foreground e adiciona `--allow-dirty`, imprimindo output no console.
- IaC: troca `veracode iac scan` (inexistente na CLI v2) pela action `veracode/container_iac_secrets_scanning` e imprime resultado no console.

## [1.0.15] - 2026-01-07

### Fixed
- SCA/IaC: move a impressao dos logs para o ultimo step da action (imprime no console mesmo quando Upload & Scan roda depois).

## [1.0.14] - 2026-01-07

### Changed
- Upload & Scan: define `deleteincompletescan=2` para deletar scans incompletos independentemente do estado.

## [1.0.13] - 2026-01-07

### Changed
- SCA/IaC: imprime no console (no fim do job) o tail de `veracode_sca.log` e `veracode_iac.log` para facilitar debug.

## [1.0.12] - 2026-01-07

### Fixed
- Pipeline Scan: quando `policy_fail!='true'`, nao falha o job mesmo que o Pipeline Scan encontre issues (mantem `results.json` e valida que o arquivo foi gerado).
- Auto Packager fallback zip: exclui binario `veracode` e arquivos de saida comuns (`results.json`, logs) do `app.zip`.

## [1.0.11] - 2026-01-07

### Fixed
- Auto Packager: quando `veracode package` nao gerar zip (ex.: stack nao suportado), faz fallback criando `app.zip` via `zip` (exclui `node_modules` e `.git`).

## [1.0.10] - 2026-01-07

### Fixed
- Auto Packager: ajusta comandos para a Veracode CLI atual (`veracode version` e `veracode package discover .`).

## [1.0.9] - 2026-01-07

### Fixed
- Auto Packager/IaC: corrige `veracode: command not found` apos instalar a Veracode CLI (detecta `veracode` no workspace e adiciona ao PATH).

## [1.0.8] - 2026-01-07

### Fixed
- Corrige uso em repos externos: remove dependencias de sub-actions locais via `uses: ./internal/*` (que causava erro de "Can't find action.yml" no workspace do usuario).

## [1.0.7] - 2026-01-07

### Changed
- Upload & Scan passa a usar sempre `repository_full_name` (org/repo) como `appname` (remove o input `veracode_appname`).
- Upload & Scan nao aguarda conclusao do scan (fixo em `scantimeout=0`) e deixa de configurar `scanpollinginterval`/`maxretrycount`.
- Nome do sandbox do Upload & Scan passa a ser `{branch}-{org-repo}` (sanitizado) quando `veracode_sandbox='true'`.

### Documentation
- README refeito com lista completa de inputs/outputs, regras de obrigatoriedade e detalhes do Upload & Scan.
- Adicionados exemplos cobrindo mais combinacoes (baseline, upload-scan, pipeline desativado, SCA, IaC, fail_on_severity).

## [1.0.6] - 2026-01-06

- Atualizar o endpoint do Veracode SCA para `https://sca-downloads.veracode.com/ci.sh` (em vez do endpoint legado).
- Adicionar input `scantimeout` ao Upload & Scan com default `0`, permitindo disparar o scan sem aguardar a conclusao para nao prolongar a pipeline.
- Alinhar o `veracode_appname` do Upload & Scan com o `repository_full_name` resolvido por `internal/resolve-repo` quando o input nao e informado explicitamente.

## [1.0.5] - 2026-01-06

- Adicionado input `enable_baseline` para ativar/desativar o uso do baseline do Bantuu.
- Modularizacao da Action em sub-actions internas (`internal/resolve-repo`, `internal/bantuu-baseline-flow`, `internal/pipeline-only`, `internal/auto-packager`).
- Suporte ao **Veracode Auto Packager** via `enable_auto_packager`, usando a CLI padrao (`veracode package discover` + `veracode package`) para gerar o artefato `.zip` do Pipeline Scan.
- Ajuste do `internal/auto-packager` para tornar `veracode package discover` best-effort (nao falha quando nao suportado) e **remover** o uso de inputs customizados (`auto_packager_command`, `auto_packager_output_dir`, `auto_packager_output`), simplificando o fluxo para sempre usar o comando padrao da Veracode CLI e o arquivo de saida fixo `app.zip`.
- Adicionado input `enable_sca` e `veracode_sca_token` e criada sub-action interna `internal/veracode-sca` para disparar o Veracode SCA em background, sem bloquear o fluxo do Pipeline Scan.
- Adicionado input `enable_iac` e criada sub-action interna `internal/veracode-iac` para disparar o Veracode IaC Scan em background, reutilizando o `veracode_api_id`/`veracode_api_key` ja configurados.
- Adicionado input `enable_pipelinescan` para permitir desativar totalmente o Veracode Pipeline Scan quando necessario.
- Adicionado input `enable_upload_scan`, `veracode_appname` e `veracode_sandbox`, alem da sub-action interna `internal/veracode-upload-scan`, para executar o Veracode Upload & Scan como ultimo passo usando o mesmo artefato do Pipeline Scan.
- Atualizacao do `README.md` e dos exemplos em `examples/` para refletir os novos fluxos (artefato vs. auto packager, com e sem baseline), os scanners SCA/IaC em background, o controle de Pipeline Scan e o Upload & Scan, e os valores fixos de URL (`https://www.bantuu.io`) e artefato (`app.zip`).

## [1.0.4] - 2025-12-18

- Remover saidas de debug desnecessarias nos scripts da Action.
- Padronizar a URL base do Bantuu para `https://www.bantuu.io`.
- Atualizar README com secao de creditos para o mantenedor.

## [1.0.2] - 2025-12-12

- Melhorias de documentacao no `README.md` (exemplo de uso dos outputs, notas e limitacoes).
- Ajustes de ortografia e acentuacao nos textos em portugues.

## [1.0.1] - 2025-12-12

- Adicionar workflow automatico de release (`.github/workflows/release.yml`).
- Mover o workflow de exemplo para `examples/veracode-bantuu-example.yml`.
- Adicionar arquivos `SECURITY.md` e `CHANGELOG.md`.

## [1.0.0] - 2025-12-12

- Versao inicial da Action **Bantuu Veracode Baseline**.
- Integracao com Veracode Pipeline Scan.
- Consulta e criacao de baseline no Bantuu a partir do `results.json`.
