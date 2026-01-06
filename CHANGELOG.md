# Changelog

Todas as mudanças notáveis deste projeto serão documentadas neste arquivo.

O formato é baseado no [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/) e este projeto adota [Versionamento Semântico](https://semver.org/lang/pt-BR/spec/v2.0.0.html).

## [Unreleased]

- Nenhuma mudança registrada ainda.

## [1.0.6] - 2026-01-06

- Atualizar o endpoint do Veracode SCA para `https://sca-downloads.veracode.com/ci.sh` (em vez do endpoint legado).
- Adicionar input `scantimeout` ao Upload & Scan com default `0`, permitindo disparar o scan sem aguardar a conclusão para não prolongar a pipeline.
- Alinhar o `veracode_appname` do Upload & Scan com o `repository_full_name` resolvido por `internal/resolve-repo` quando o input não é informado explicitamente.

## [1.0.5] - 2026-01-06

- Adicionado input `enable_baseline` para ativar/desativar o uso do baseline do Bantuu.
- Modularização da Action em sub-actions internas (`internal/resolve-repo`, `internal/bantuu-baseline-flow`, `internal/pipeline-only`, `internal/auto-packager`).
- Suporte ao **Veracode Auto Packager** via `enable_auto_packager`, usando a CLI padrão (`veracode package discover` + `veracode package`) para gerar o artefato `.zip` do Pipeline Scan.
- Ajuste do `internal/auto-packager` para tornar `veracode package discover` best-effort (não falha quando não suportado) e **remover** o uso de inputs customizados (`auto_packager_command`, `auto_packager_output_dir`, `auto_packager_output`), simplificando o fluxo para sempre usar o comando padrão da Veracode CLI e o arquivo de saída fixo `app.zip`.
- Adicionado input `enable_sca` e `veracode_sca_token` e criada sub-action interna `internal/veracode-sca` para disparar o Veracode SCA em background, sem bloquear o fluxo do Pipeline Scan.
- Adicionado input `enable_iac` e criada sub-action interna `internal/veracode-iac` para disparar o Veracode IaC Scan em background, reutilizando o `veracode_api_id`/`veracode_api_key` já configurados.
- Adicionado input `enable_pipelinescan` para permitir desativar totalmente o Veracode Pipeline Scan quando necessário.
- Adicionado input `enable_upload_scan`, `veracode_appname` e `veracode_sandbox`, além da sub-action interna `internal/veracode-upload-scan`, para executar o Veracode Upload & Scan como último passo usando o mesmo artefato do Pipeline Scan.
- Atualização do `README.md` e dos exemplos em `examples/` para refletir os novos fluxos (artefato vs. auto packager, com e sem baseline), os scanners SCA/IaC em background, o controle de Pipeline Scan e o Upload & Scan, e os valores fixos de URL (`https://www.bantuu.io`) e artefato (`app.zip`).

## [1.0.4] - 2025-12-18

- Remover saídas de debug desnecessárias nos scripts da Action.
- Padronizar a URL base do Bantuu para `https://www.bantuu.io`.
- Atualizar README com seção de créditos para o mantenedor.

## [1.0.2] - 2025-12-12

- Melhorias de documentação no `README.md` (exemplo de uso dos outputs, notas e limitações).
- Ajustes de ortografia e acentuação nos textos em português.

## [1.0.1] - 2025-12-12

- Adicionar workflow automático de release (`.github/workflows/release.yml`).
- Mover o workflow de exemplo para `examples/veracode-bantuu-example.yml`.
- Adicionar arquivos `SECURITY.md` e `CHANGELOG.md`.

## [1.0.0] - 2025-12-12

- Versão inicial da Action **Bantuu Veracode Baseline**.
- Integração com Veracode Pipeline Scan.
- Consulta e criação de baseline no Bantuu a partir do `results.json`.
