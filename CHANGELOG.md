# Changelog

Todas as mudanças notáveis deste projeto serão documentadas neste arquivo.

O formato é baseado no [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/) e este projeto adota [Versionamento Semântico](https://semver.org/lang/pt-BR/spec/v2.0.0.html).

## [Unreleased]

## [1.0.4] - 2025-12-18

- Remover saídas de debug desnecessárias nos scripts da Action.
- Padronizar a URL base do Bantuu para `https://www.bantuu.io`.

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

