# Security Policy

## Supported Versions

Esta Action segue versionamento semantico. Em geral, apenas a ultima versao `v1.x.x` esta ativa e recebe correcoes.

Versoes suportadas:

- `v1.7.0`, com os aliases `v1.7` e `v1` apontando para o mesmo commit publicado na `main`.

## Bloqueio por resultados dos scans

Com `policy_fail: 'true'` e `fail_build: 'true'`, findings confirmados de policy/baseline do Pipeline Scan, reprovação da política IaC ou falha reportada pelo SCA bloqueiam o job somente no último step. Os scans habilitados continuam e o Resumo Final é publicado antes do bloqueio, com os resultados reprovados em vermelho. Com qualquer um desses inputs desabilitado, os resultados continuam visíveis, sem bloqueio por esta action.

No SCA, `policy_fail` controla `breakBuildOnPolicyFindings`. A action oficial também reporta falha para erros técnicos do scanner; como não distingue a causa, esses erros podem bloquear ao final quando ambos os inputs estão habilitados. A política SCA deve ser atribuída ao workspace na Veracode. A action oficial não aceita seleção de política por nome; para compartilhar a política do Pipeline Scan, atribua a mesma política ao workspace do token SCA.

Falhas técnicas isoladas do Pipeline/IaC geram aviso, sem serem tratadas como violações confirmadas. Arquivos de resultado anteriores do Pipeline são removidos antes do scan para evitar bloqueio por findings de outra execução.

## Baseline via repositorio (GitHub App)

Para `baseline_mode: repo`, a org em `baseline_org` **deve** conter o repositório de store (`baseline_repo_name`, default `Afrika-Veracode-Connect-Baseline`). Use GitHub App (`Contents: Read and write`) ou PAT com acesso a esse repo.

Com `enable_iac_configs: 'true'`, a action também usa esse acesso para baixar o `veracode.yml` da raiz do repositório de baseline para a raiz do workspace analisado. Para somente ler essa configuração, `Contents: Read` é suficiente; o fluxo Repo Baseline que atualiza arquivos continua exigindo escrita. Mantenha as credenciais em secrets do GitHub e revise as regras centralizadas antes de publicá-las no baseline.

## Reportando vulnerabilidades

Se voce encontrar uma vulnerabilidade ou comportamento de seguranca inesperado relacionado a Action **Veracode Connect**:

- Nao abra uma issue publica com detalhes sensiveis.
- Use o fluxo de **GitHub Security Advisories** no repositorio ou entre em contato de forma privada com os mantenedores do projeto.

Inclua, se possivel:

- Passo a passo para reproduzir o problema;
- Logs/trechos de saida relevantes (sem segredos);
- Versao da Action (`v1`, `v1.0.0`, etc.);
- Qualquer contexto adicional (tipo de repositorio, linguagem, etc.).

Os mantenedores avaliarao o relato, responderao assim que possivel e, se necessario, publicarao uma correcao e um release com as devidas notas.
