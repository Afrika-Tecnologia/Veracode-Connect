# Security Policy

## Supported Versions

Esta Action segue versionamento semantico. Em geral, apenas a ultima versao `v1.x.x` esta ativa e recebe correcoes.

Versoes suportadas:

- `v1.7.4`, com os aliases `v1.7` e `v1` apontando para o mesmo commit publicado na `main`.

A versão `v1.7.1` corrige a classificação de reprovações da política IaC: a chamada do avaliador em `v1.7.0` podia retornar `error` e preservar o job mesmo com bloqueio habilitado. Atualize referências fixadas em `v1.7.0` para receber a correção.

A versão `v1.7.2` preserva essa correção e consolida os resultados das chamadas do Connect no mesmo job. Os bloqueantes SAST exibidos são os findings selecionados pelo Pipeline Scan após os filtros de política e baseline, sem promover findings fora da política a bloqueantes. Status e detalhes de outros jobs, execuções, tentativas e workspaces não são reutilizados.

A versão `v1.7.3` mantém essas correções, sinaliza scans indisponíveis como warning sem bloquear por ausência de resultados e preserva o bloqueio final das violações confirmadas. O link de acesso do summary e do comentário do PR é definido por `veracode_url`; apenas URLs HTTP/HTTPS são renderizadas, com fallback para o login padrão.

## Bloqueio por resultados dos scans

Com `policy_fail: 'true'` e `fail_build: 'true'`, findings confirmados de policy/baseline do Pipeline Scan, reprovação da política IaC ou falha reportada pelo SCA com resultado de análise bloqueiam o job somente no último step. Os scans habilitados continuam e o Resumo Final é publicado antes do bloqueio, com os resultados reprovados em vermelho. Com qualquer um desses inputs desabilitado, os resultados continuam visíveis, sem bloqueio por esta action.

Quando `baseline_mode` é `repo` ou `portal_afrika`, o bloqueio do Pipeline exige que um baseline registrado tenha sido utilizado no scan. A execução inicial sem baseline preserva os findings e pode criar o baseline na branch padrão, mas não bloqueia por política; essa gravação só afeta scans posteriores. SCA/IaC e o Pipeline sem provedor de baseline continuam com suas decisões independentes.

No SCA, `policy_fail` controla `breakBuildOnPolicyFindings`. A ausência de resultado reconhecível com bibliotecas analisadas gera `warning`, sem bloqueio; artefatos SCA anteriores são removidos antes do scan. Com resultado de análise, a falha oficial continua bloqueante quando ambos os inputs estão habilitados. A action oficial não distingue reprovação de política de erro técnico nesse caso. A política SCA deve ser atribuída ao workspace na Veracode. A action oficial não aceita seleção de política por nome; para compartilhar a política do Pipeline Scan, atribua a mesma política ao workspace do token SCA.

Scans sem resultado, erros técnicos de execução/avaliação IaC e falhas de Upload & Scan aparecem como `⚠️ Warning` no Resumo Final e não bloqueiam isoladamente. Violações confirmadas em outros scans continuam bloqueantes. Arquivos de resultado anteriores do Pipeline são removidos antes do scan para evitar bloqueio por findings de outra execução.

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
