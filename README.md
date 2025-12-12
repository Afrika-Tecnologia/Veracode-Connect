# Bantuu Veracode Baseline

Action para rodar o **Veracode Pipeline Scan** integrado com baseline vindo do **Bantuu**.

- Se **não houver baseline** no Bantuu para o repositório (`org/repo`):
  - Roda o Pipeline Scan sem baseline;
  - Gera `results.json`;
  - Envia o `results.json` para o Bantuu para ser usado como baseline futuro.
- Se **já existir baseline**:
  - Baixa o baseline do Bantuu;
  - Cria `baseline.json` local;
  - Roda o Pipeline Scan usando `baseline.json` como baseline.

---

## Requisitos

- Repositório usando GitHub Actions;
- Secrets configurados no repositório:
  - `BANTUU_API_KEY`
  - `VERACODE_API_ID`
  - `VERACODE_API_KEY`
- Artefato compactado para envio ao Veracode (ex.: `app.zip`).

---

## Exemplo de workflow (`.github/workflows/veracode-bantuu.yml`)

```yaml
name: Security Scan (Veracode + Bantuu)

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  veracode-baseline:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Build and package application
        run: |
          # Exemplo: gere o artefato para o Veracode, por exemplo app.zip
          zip -r app.zip .

      - name: Bantuu Veracode Baseline
        uses: Afrikatec-JuanCunhaa/bantuu-baseline@v1
        with:
          bantuu_api_key: ${{ secrets.BANTUU_API_KEY }}
          veracode_api_id: ${{ secrets.VERACODE_API_ID }}
          veracode_api_key: ${{ secrets.VERACODE_API_KEY }}
          scan_file: app.zip
          policy_fail: 'false'
          # Opcional: só será aplicado quando houver baseline
          # fail_on_severity: 'Very High, High'
```

---

## Inputs

- `bantuu_api_key` (obrigatório)  
  API Key usada no header `X-API-Key` do Bantuu (GET baseline e POST upload).

- `veracode_api_id` (obrigatório)  
  ID da API do Veracode.

- `veracode_api_key` (obrigatório)  
  Key da API do Veracode.

- `scan_file` (obrigatório)  
  Arquivo compactado enviado ao Pipeline Scan (ex.: `app.zip`).

- `policy_fail` (opcional, default: `"false"`)  
  Define se o scan deve quebrar o build por policy (`true`/`false`).

- `fail_on_severity` (opcional)  
  Severidades que fazem o scan falhar **quando já existe baseline** (ex.: `"Very High, High"`).

---

## Outputs

- `has_baseline`  
  Indica se já existia baseline no Bantuu (`true`/`false`).

- `pipeline_status`  
  Indica se o scan rodou com baseline ou sem baseline e fez upload:
  - `scan_completed_with_baseline`
  - `scan_completed_without_baseline_and_uploaded`

- `repository_full_name`  
  `org/repo` usado para consultar e enviar baseline ao Bantuu.
