# Changelog

Todas as mudancas notaveis deste projeto serao documentadas neste arquivo.

O formato e baseado no [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/) e este projeto adota [Versionamento Semantico](https://semver.org/lang/pt-BR/spec/v2.0.0.html).

## [Unreleased]

- N/A.

## [1.1.7] - 2026-02-23

### Added

- Novo input `fail_build` (default `'true'`): trava de build final que verifica se algum step falhou.
- Novo input `enable_business_unit` (lowercase, substitui `enable_Business_unit`; alias legado mantido).
- Novos outputs: `sca_status`, `iac_status`, `upload_scan_status`.
- Step final obrigatorio "Trava de Build" com resumo visual de todos os resultados.
- Workflow CI de linting (`actionlint`) para validar sintaxe dos YAMLs e verificar exemplos vazios.

### Changed

- **Logica baseline/pipescan**: `enable_baseline=true` roda o baseline flow independentemente de `enable_pipelinescan`; `enable_pipelinescan=true` + `enable_baseline=false` roda pipeline only.
- Auto-packager so e executado quando pipeline, upload ou baseline estao ativos (antes rodava sempre).
- `scan_file` so e obrigatorio quando pipeline/upload/baseline estao ativos (permite usar apenas SCA + IaC).
- Todas as dependencias externas pinadas por SHA de commit (supply-chain security).
- Refs internas de sub-actions alteradas de `@v1.1` para `@v1` (consistencia com major version tag).
- Veracode CLI (Auto Packager) pinada na versao `3.4.0`.
- `::group::` adicionado em todas as sub-actions para logs organizados.
- `curl` para Bantuu agora usa `--connect-timeout 30 --max-time 120`.
- `set-business-unit.js`: HMAC auth regenerado dentro do loop de retry; paginacao de BUs reduzida de 200 para 20 paginas; validacao de virgula removida (duplicada, feita no validate-inputs).
- `continue-on-error` adicionado no Upload & Scan e Baseline Flow (resultados verificados na trava de build final).
- Condicoes `always()` substituidas por verificacoes de outcome (evita steps desnecessarios).
- Warning exibido quando auto-packager ativo mas `scan_file` fornecido.

### Fixed

- 26 exemplos vazios (0 bytes) preenchidos com workflows completos e funcionais.
- Auto Packager: adicionado flag `--trust` no `veracode package` para evitar prompt interativo ("Do you trust the authors?") que causava falha `EOF` no CI.


## [1.1.6] - 2026-02-19

### Added

- Adicionado input ` ` no pipeline scan para permitir o uso de uma politica do veracode para quebra de pipeline.

## [1.1.5] - 2026-02-19

### Added

- Adicionado input `veracode_appname` no Upload & Scan par permitir o uso de um nome de aplicação diferente do nome do repositório.

## [1.1.2] - 2026-02-10

### Fixed

- Atualizada a action `veracode-uploadandscan-action` para `@v1` (era `0.2.4`) para corrigir erro de build do Docker (`openjdk:latest` not found).
- Renomeado input `deleteincompletescan` para `deleteincomplete` (v1).


## [1.1.1] - 2026-02-10

### Fixed

- Corrigido erro de "File not found" ao utilizar a action em outros repositórios: referências locais (`./internal/...`) foram substituídas por caminhos absolutos do repositório (`Afrika-Tecnologia/Veracode-Connect/internal/...@v1.1`).

## [1.0.28] - 2026-02-10

### Fixed

- Corrigido a propagação do input `bantuu_base_url` que estava sendo sobrescrito pelo valor default na sub-action.

## [1.0.27] - 2026-02-10

### Changed

- Refatoração completa da estruturada action: `action.yml` agora é uma orquestradora que chama sub-actions em `internal/`.
- Padronização de todas as mensagens de log e erro para Português (PT-BR).
- Melhoria na robustez: validação inicial de inputs obrigatórios condicionais.
- Melhoria na segurança: uso de variáveis de ambiente para secrets em vez de interpolação no shell.
- Melhoria no tratamento de erros: `policy_fail` agora é verificado corretamente mesmo com `continue-on-error`.
- Pinned version: `veracode-uploadandscan-action` fixado na versão `0.2.4` para estabilidade.
- Novo passo no fluxo de baseline: envio de resultados de scan com baseline para o endpoint de histórico do Bantuu.

## [1.0.26] - 2026-01-07

### Changed

- Remove comentarios nos exemplos e simplifica o modulo de Business Unit para suportar apenas BU unica (remove inputs/outputs legados de lista).

## [1.0.25] - 2026-01-07

### Changed

- Atualiza `README.md`, `SECURITY.md` e `LICENSE` para o novo nome do projeto e informacoes do mantenedor.
- Workflow de release: atualiza o nome do release para **Veracode Connect**.

## [1.0.24] - 2026-01-07

### Changed

- Renomeia a action para **Veracode Connect** e atualiza a documentacao/exemplos para usar `Afrika-Tecnologia/Veracode-Connect@v1`.
- Atualiza a string de `version` usada no Upload & Scan.

## [1.0.23] - 2026-01-07

### Changed

- Auto Packager: corrige chamada da Veracode CLI adicionando `--source .` (e `--type directory`) no `veracode package`, evitando falha imediata por flag obrigatoria ausente.

## [1.0.22] - 2026-01-07

### Changed

- Input de BU renomeado para `enable_Business_unit` (mantem compatibilidade com `enable_set_business_unit`).

## [1.0.20] - 2026-01-07

### Added

- Link opcional do application profile a uma Business Unit (BU) via REST (HMAC), executado apos o Upload & Scan.
- Nota: a Veracode suporta apenas 1 BU por aplicacao (se for informado mais de um valor, a action falha).

## [1.0.19] - 2026-01-07

### Added

- Publica artefatos com resultados no job: `sca-results`, `iac-results`, `pipescan-results`.

## [1.0.18] - 2026-01-07

### Added

- README com lista de exemplos por cenario e links clicaveis.
- Exemplos de workflows cobrindo combinacoes de SCA, IaC, Baseline Bantuu, Upload & Scan e uso de `scan_file` (artefato) ou Auto Packager.

## [1.0.17] - 2026-01-07

### Changed

- Logs: adiciona grupos no console (`::group::/::endgroup::`) para SCA, Auto Packager e Bantuu baseline (check/upload).
- Auto Packager: fallback do `zip` fica em modo quiet para reduzir poluicao no log.

## [1.0.14] - 2026-01-07

### Changed

- Upload & Scan: define `deleteincompletescan=2` para deletar scans incompletos independentemente do estado.

## [1.0.13] - 2026-01-07

### Changed

- SCA/IaC: imprime no console (no fim do job) o tail de `veracode_sca.log` e `veracode_iac.log` para facilitar debug.

## [1.0.7] - 2026-01-07

### Changed

- Upload & Scan passa a usar sempre `repository_full_name` (org/repo) como `appname` (remove o input `veracode_appname`).
- Upload & Scan nao aguarda conclusao do scan (fixo em `scantimeout=0`) e deixa de configurar `scanpollinginterval`/`maxretrycount`.
- Nome do sandbox do Upload & Scan passa a ser `{branch}-{org-repo}` (sanitizado) quando `veracode_sandbox='true'`.

### Documentation

- README refeito com lista completa de inputs/outputs, regras de obrigatoriedade e detalhes do Upload & Scan.
- Adicionados exemplos cobrindo mais combinacoes (baseline, upload-scan, pipeline desativado, SCA, IaC, fail_on_severity).

## [1.0.6] - 2026-01-06

### Added

- Atualizar o endpoint do Veracode SCA para `https://sca-downloads.veracode.com/ci.sh` (em vez do endpoint legado).
- Adicionar input `scantimeout` ao Upload & Scan com default `0`, permitindo disparar o scan sem aguardar a conclusao para nao prolongar a pipeline.
- Alinhar o `veracode_appname` do Upload & Scan com o `repository_full_name` resolvido por `internal/resolve-repo` quando o input nao e informado explicitamente.

## [1.0.5] - 2026-01-06

### Added

- Adicionado input `enable_baseline` para ativar/desativar o uso do baseline do Bantuu.
- Modularizacao da Action em sub-actions internas (`internal/resolve-repo`, `internal/bantuu-baseline-flow`, `internal/pipeline-only`, `internal/auto-packager`).
- Suporte ao Veracode Auto Packager via `enable_auto_packager`.
- Adicionado suporte opcional a SCA (`enable_sca`, `veracode_sca_token`) e IaC (`enable_iac`).
- Adicionado suporte opcional a Upload & Scan (`enable_upload_scan`, `veracode_sandbox`).
- Atualizacao do README e exemplos para refletir os novos fluxos.

## [1.0.4] - 2025-12-18

### Added

- Padronizar a URL base do Bantuu para `https://www.bantuu.io`.
- Atualizar README com secao de creditos para o mantenedor.

## [1.0.2] - 2025-12-12

### Documentation

- Melhorias de documentacao no `README.md` (exemplo de uso dos outputs, notas e limitacoes).
- Ajustes de ortografia e acentuacao nos textos em portugues.

## [1.0.1] - 2025-12-12

### Added

- Adicionar workflow automatico de release (`.github/workflows/release.yml`).
- Mover o workflow de exemplo para `examples/veracode-bantuu-example.yml`.
- Adicionar arquivos `SECURITY.md` e `CHANGELOG.md`.

## [1.0.0] - 2025-12-12

### Added

- Versao inicial da Action Veracode Connect.
- Integracao com Veracode Pipeline Scan.
- Consulta e criacao de baseline no Bantuu a partir do `results.json`.

