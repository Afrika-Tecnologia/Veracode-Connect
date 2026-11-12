# Veracode Connect

Integre a Veracode ao GitHub Actions com **um único step**. O Veracode Connect é uma action facilitadora que reúne **SAST** (Pipeline Scan), **SCA** e **IaC/Secrets** da Veracode, roda tudo na mesma esteira e entrega um resultado consolidado no summary do job e no Pull Request. Você liga só os módulos de que precisa, e a decisão de bloquear a esteira acontece uma vez, no final, depois de todos os scans.

## Funcionalidades principais

### Baseline para SAST

Adote o SAST em projetos antigos sem travar o time pelo passivo. Na primeira execução elegível, o Connect grava o baseline do Pipeline Scan num repositório GitHub da sua organização; depois disso, **só as vulnerabilidades novas que afetam a política bloqueiam**, e o backlog continua visível no relatório. Ative com `baseline_mode: 'repo'`, informando a organização do repositório de baseline (`baseline_org`) e um GitHub App ou PAT com acesso a ele.

### Baseline para SCA

O mesmo princípio para as dependências. Cada vulnerabilidade de cada biblioteca entra no baseline, e só as **novas que afetam a política** (`sca_fail_on_severity`) bloqueiam. Subir a versão de uma biblioteca sem corrigir a falha não esconde nada: o finding continua no backlog. Ative com `enable_sca_baseline: 'true'`.

### Bloqueio por CVE no SCA

Tem uma CVE crítica no radar, como a Log4Shell? Liste os CVEs em `fail_on_cve`: se qualquer um aparecer nas dependências, a esteira bloqueia, inclusive quando a vulnerabilidade já estava no backlog. Os findings bloqueados aparecem em destaque no summary e no PR.

### Baseline para IaC/Secrets

A Veracode não oferece baseline para Container/IaC/Secrets; o Connect mantém um próprio. Só os findings novos reprovados pela sua política IaC bloqueiam, e a identidade de cada finding não depende do número da linha. Os secrets encontrados nunca têm o trecho nem o valor gravados ou publicados. Ative com `enable_iac_baseline: 'true'`.

Os bloqueios acima valem com `policy_fail: 'true'` (o default é `'false'`, que só reporta) e `fail_build: 'true'` (default). Com `bypass: 'true'`, nada bloqueia.

O link **Acesse Aqui** do Resumo Final é configurável (`veracode_url`), para usar outra região ou o seu SSO da Veracode.

## E mais

- Pipeline Scan com até 6 artefatos, retry automático e controle de rate limit.
- Baseline SAST também via Portal Afrika.
- Política Container/IaC da Veracode e regras IaC centralizadas para toda a organização.
- Upload & Scan com sandbox automática por branch, e Auto Packager.
- Resumo Final unificado e comentário único no Pull Request.
- `bypass` para emergências, criação de issues, cache de ferramentas e de dependências Maven/Gradle, diagnóstico de falhas técnicas.

Detalhes de cada funcionalidade na [documentação](docs/README.md).

## Uso rápido

```yaml
name: Veracode

on:
  pull_request:
  push:
    branches: [ main ]

jobs:
  veracode:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
      - uses: Afrika-Tecnologia/Veracode-Connect@v1.9.0
        with:
          veracode_api_id: ${{ secrets.VERACODE_API_ID }}
          veracode_api_key: ${{ secrets.VERACODE_API_KEY }}
          enable_auto_packager: 'true'
          enable_sca: 'true'
          veracode_sca_token: ${{ secrets.VERACODE_SCA_TOKEN }}
          enable_iac: 'true'
          comment_pr: 'true'
          policy_fail: 'true'
```

Use um runner Linux. `@v1` e `@v1.9` acompanham a versão mais recente. Todos os inputs e outputs estão em [docs/inputs.md](docs/inputs.md).

## Links

- [Documentação](docs/README.md)
- [CHANGELOG](CHANGELOG.md)
- [Política de segurança](SECURITY.md)
