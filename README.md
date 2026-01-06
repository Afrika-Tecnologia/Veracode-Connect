# Bantuu Veracode Baseline

GitHub Action para rodar o **Veracode Pipeline Scan** com suporte opcional a **baseline do Bantuu** e ao **Veracode Auto Packager**.

Este repositório é orientado por exemplos. Use o guia abaixo para escolher o workflow conforme o cenário desejado.

---

## Guia de cenários e exemplos

- **Artefato + Baseline (scan_file + Bantuu)**  
  - Usa artefato `.zip` gerado pelo seu próprio build (`scan_file`).  
  - Integra com baseline do Bantuu (consulta/usa baseline e faz upload quando necessário).  
  - Exemplo: `examples/artifact-with-baseline.yml`

- **Artefato + apenas Pipeline Scan (sem Bantuu)**  
  - Usa artefato `.zip` gerado pelo seu próprio build (`scan_file`).  
  - Roda somente o Veracode Pipeline Scan, sem chamadas ao Bantuu.  
  - Exemplo: `examples/artifact-without-baseline.yml`

- **Auto packager + Baseline**  
  - Usa o Veracode Auto Packager (CLI padrão `veracode package`) para gerar o `.zip`.  
  - Integra com baseline do Bantuu.  
  - Exemplo: `examples/autopackager-with-baseline.yml`

- **Auto packager + apenas Pipeline Scan (sem Bantuu)**  
  - Usa o Veracode Auto Packager para gerar o `.zip`.  
  - Roda somente o Veracode Pipeline Scan, sem Bantuu.  
  - Exemplo: `examples/autopackager-without-baseline.yml`

---

## Parâmetros (inputs principais)

- `bantuu_api_key` – API Key do Bantuu (obrigatória quando `enable_baseline` = `true`).
- `enable_sca` – Ativa/desativa o Veracode SCA em background (`'true'` ou `'false'`).
- `veracode_sca_token` – Token de API do Veracode SCA (usado quando `enable_sca` = `true`).
- `enable_iac` – Ativa/desativa o Veracode IaC Scan em background (`'true'` ou `'false'`).
- `enable_pipelinescan` – Ativa/desativa o Veracode Pipeline Scan (`'true'` ou `'false'`).
- `enable_upload_scan` – Ativa/desativa o Veracode Upload & Scan (`'true'` ou `'false'`).
- `enable_baseline` – Ativa/desativa o uso de baseline do Bantuu (`'true'` ou `'false'`).
- `enable_auto_packager` – Ativa/desativa o uso do Veracode Auto Packager (comando padrão `veracode package`).
- `veracode_api_id` – ID da API do Veracode.
- `veracode_api_key` – Key da API do Veracode.
- `veracode_appname` – Nome do aplicativo no Veracode (default: org/repo do GitHub resolvido em `repository_full_name` pelo step de resolve-repo).
- `veracode_sandbox` – Define se o Upload & Scan usa sandbox (`'true'`) ou o app principal (`'false'`).
- `scan_file` – Caminho do artefato `.zip` já empacotado (usado quando o auto packager está desativado).
- `policy_fail` – Define se o scan deve quebrar o build por policy (`'true'`/`'false'`).
- `fail_on_severity` – Severidades que fazem o scan falhar quando há baseline (ex.: `Very High, High`).

- URL base do Bantuu (fixa): `https://www.bantuu.io`.
- Arquivo de saída do Auto Packager (fixo): `app.zip`.

---

Os parâmetros e comportamentos completos da Action estão documentados em:

- `action.yml` (raiz da Action)  
- Actions compostas internas em `internal/`

---

## Créditos

Esta Action foi criada e é mantida por [@JuanCunhaa](https://github.com/JuanCunhaa).
