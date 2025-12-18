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
        id: bantuu_veracode_baseline
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
  API Key usada no Bantuu.

- `veracode_api_id` (obrigatório)  
  ID da API do Veracode.

- `veracode_api_key` (obrigatório)  
  Key da API do Veracode.

- `scan_file` (obrigatório)  
  Arquivo compactado enviado ao Pipeline Scan (ex.: `app.zip`).

- `policy_fail` (opcional, default: `"false"`)  
  Define se o scan deve quebrar o build por policy (`true`/`false`).

- `fail_on_severity` (opcional)  
  Severidades que fazem o scan falhar. (ex.: `"Very High, High"`).

---

## Notas e limitações

- A Action foi projetada para rodar em `ubuntu-latest` (usa `apt-get` e `sudo` para instalar `jq`).
- Requer acesso de rede até a URL configurada (por padrão `https://www.bantuu.io`) a partir do runner.
- A URL base padrão do Bantuu é `https://www.bantuu.io`.
- É responsabilidade do workflow gerar o arquivo indicado em `scan_file` antes da chamada.
- O scan é executado via `veracode/Veracode-pipeline-scan-action@v1.0.20`.

