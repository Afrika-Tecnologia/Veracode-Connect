# Veracode Connect

GitHub Action que reúne Pipeline Scan, SCA, IaC/Secrets e Upload & Scan da Veracode em um único fluxo. O Pipeline Scan pode usar um baseline no Portal Afrika ou em um repositório GitHub. Cada módulo pode ser habilitado conforme a necessidade do repositório.

## Antes de usar

- Use um runner Linux e disponibilize `veracode_api_id` e `veracode_api_key` como secrets do workflow.
- Para usar regras IaC customizadas, faça checkout do repositório analisado antes da action e mantenha `veracode.yml` na raiz do **repositório de baseline**. Habilite `enable_iac_configs: 'true'` junto com `enable_iac: 'true'` e informe `baseline_org`, `baseline_repo_name` e as credenciais de acesso ao baseline. A action baixa o arquivo para a raiz do workspace, substituindo um `veracode.yml` local, e o aplica no `HOME` temporário do IaC. Usa `baseline_repo_branch` quando informado ou a branch padrão do baseline. Esse fluxo funciona com `baseline_mode: 'none'`, sem Pipeline Scan ou Auto Packager.
- Para aplicar uma política Container/IaC da Veracode, informe o nome dela em `iac_policy` junto com `enable_iac: 'true'`. Use uma política criada apenas para Container/IaC; políticas que também contêm regras SCA não podem ser baixadas em formato Rego pelo CLI.
- Quando houver Pipeline Scan, Upload & Scan ou baseline, forneça `scan_file` ou ative `enable_auto_packager`. Com Auto Packager, faça checkout do repositório antes de chamar a action.
- Declare `contents: read` nas permissões do job. Acrescente `issues: write` para `create_issues` e `pull-requests: write` para `comment_pr`. O repositório também precisa ter Issues habilitadas para `create_issues`.
- Passe os valores booleanos como strings: `'true'` ou `'false'`.

## Como a análise funciona

O Pipeline Scan vem habilitado por padrão. SCA, IaC/Secrets e Upload & Scan são opcionais. Com `baseline_mode: 'none'`, o Pipeline Scan roda sem provedor de baseline; nos outros modos, consulta o baseline antes de analisar. O Upload & Scan envia o artefato para análise estática, mas não espera a análise terminar nem avalia sua policy nesta execução.

O Auto Packager empacota o conteúdo do commit em análise. Arquivos criados durante o job, incluindo binários de build, não entram nesse pacote; para analisá-los, use `scan_file`. Quando houver vários pacotes elegíveis, o Pipeline Scan analisa até seis em sequência. O Upload & Scan pode receber todos os pacotes gerados ou apenas o principal.

| Modo de baseline | Comportamento |
| --- | --- |
| `none` | Pipeline Scan sem baseline. |
| `portal_afrika` | Consulta o Portal Afrika e envia resultados ao Portal. Um baseline ausente só pode ser criado a partir da branch padrão do repositório analisado. |
| `repo` | Lê o baseline de um repositório GitHub. Cria o baseline uma única vez, quando ele ainda não existe, a partir da branch padrão do repositório analisado ou de um PR destinado a ela. Depois de criado, o baseline não é regravado; para refazê-lo, apague `<org>/<repo>/baseline.json` no repositório de baseline. |

Para `repo`, prepare um repositório de baseline com pelo menos um commit. A autenticação pode usar um GitHub App instalado nesse repositório ou um PAT; a credencial precisa de acesso de leitura e escrita a Contents. O App usa `baseline_github_app_id`, `baseline_github_app_private_key` e `baseline_github_app_installation_id`. O PAT usa `baseline_github_token`. Essas credenciais também são necessárias com IaC e `enable_iac_configs: 'true'`; para apenas baixar `veracode.yml`, basta Contents: read.

### Regras IaC centralizadas

Coloque `veracode.yml` na raiz do repositório de baseline. Este exemplo executa somente IaC e usa um PAT para buscar as regras; os inputs do GitHub App também podem ser usados no lugar do PAT.

```yaml
- uses: actions/checkout@v4
- uses: Afrika-Tecnologia/Veracode-Connect@v1.8.2
  with:
    veracode_api_id: ${{ secrets.VERACODE_API_ID }}
    veracode_api_key: ${{ secrets.VERACODE_API_KEY }}
    enable_iac: 'true'
    enable_iac_configs: 'true'
    enable_pipelinescan: 'false'
    baseline_mode: 'none'
    baseline_org: ${{ github.repository_owner }}
    baseline_repo_name: Afrika-Veracode-Connect-Baseline
    baseline_github_token: ${{ secrets.BASELINE_GITHUB_TOKEN }}
```

O arquivo é baixado da branch padrão do baseline; informe `baseline_repo_branch` para selecionar outra branch. O download substitui o `veracode.yml` da raiz do workspace e suas regras são aplicadas no `HOME` temporário usado pelo IaC. `@v1` e `@v1.8` também apontam para a versão `v1.8.2`.

### Baseline IaC/Secrets

A Veracode não oferece baseline para Container/IaC/Secrets; o Veracode Connect mantém um próprio. Com `enable_iac_baseline: 'true'`, `baseline_mode: 'repo'` e `enable_iac: 'true'`, a primeira execução elegível grava `<org>/<repo>/iac-baseline.json` no repositório de baseline, na mesma pasta do `baseline.json` do Pipeline Scan. É elegível a execução cujo destino é a branch padrão do repositório analisado: push nela ou PR destinado a ela. O arquivo é gravado uma única vez e nunca é regravado; para refazê-lo, apague `iac-baseline.json` no repositório de baseline.

Nas execuções seguintes, o scan IaC roda como antes e cada finding é comparado ao baseline:

| Grupo | Bloqueia |
| --- | --- |
| Novos que afetam a política: ausentes do baseline e reprovados pela política de `iac_policy` | Sim, com `policy_fail` e `fail_build` ligados e `bypass` desligado |
| Novos que não afetam a política | Não |
| Backlog: presentes no baseline e no scan atual | Não |

Os findings corrigidos não aparecem; o card informa só quantos foram. O summary e o comentário do PR mostram os três grupos por severidade num único card IaC. O detalhamento completo fica em `iac-results/iac-baseline-diff.json`, no artefato do IaC.

A identidade de cada finding não depende do número da linha: vulnerabilidades usam identificador, pacote e manifesto (sem a versão); secrets usam regra e arquivo; configurações usam regra, arquivo e recurso. Deslocar linhas, editar o recurso ou subir a versão de uma biblioteca sem corrigir a vulnerabilidade mantém o finding no backlog. O baseline guarda só identificadores e campos de exibição; o trecho e o valor dos secrets nunca são gravados.

Enquanto não houver baseline IaC, inclusive na execução que o grava, a política IaC é avaliada e exibida, mas não bloqueia (`iac_policy_status: deferred`). Sem `iac_policy`, os findings novos aparecem, mas nenhum bloqueia. Falha ao ler o baseline gera aviso e também não bloqueia por IaC. A autenticação é a mesma do modo `repo` (GitHub App ou PAT com Contents read/write).

O summary IaC e o comentário do PR somam as vulnerabilidades de dependências, os findings de secrets (incluindo regras customizadas) e os findings de configurações. O detalhamento usa identificador da regra, título e arquivo/linha; os campos `Code` e `Match` dos secrets não são publicados. As severidades exibidas são as reportadas nos findings pelo scanner.

## Resultado da esteira

Com `policy_fail: 'true'` e `fail_build: 'true'` (padrão), a action bloqueia a esteira por falha reportada pelo SCA com resultado de análise, reprovação da política IaC ou findings confirmados de policy/baseline do Pipeline Scan. No Pipeline, é necessário um resultado válido desta execução e ao menos um artefato analisado com violação. Se outro artefato apresentar erro técnico ou não puder ser analisado, isso não apaga uma violação já confirmada. Resultado ausente ou inválido, sem evidência de violação, não aciona o bloqueio do Pipeline.

Nos modos `repo` e `portal_afrika`, o Pipeline Scan só bloqueia por política quando utiliza um baseline já registrado. Enquanto o baseline estiver ausente, os findings continuam no relatório, mas não reprovam a esteira por política. Gravar o primeiro baseline após o scan não ativa o bloqueio nessa mesma execução; ele passa a valer quando uma execução seguinte consultar e utilizar esse baseline. O seed continua restrito à branch padrão. Essa condição não altera as decisões independentes de SCA/IaC nem o Pipeline configurado com `baseline_mode: 'none'`.

Antes de planejar os scans, o Pipeline limpa seus arquivos de resultado gerados anteriormente. Isso evita usar findings antigos como evidência da execução atual; o arquivo de baseline continua disponível.

Todos os scans habilitados continuam antes da decisão final. O summary e o comentário consolidado do PR mostram a reprovação; o summary exibe **Build travado por policy**, **Build travado por falha do SCA** ou **Build travado por CVE bloqueado no SCA** conforme o resultado. Somente o último step retorna erro, depois do summary, comentário e diagnóstico. Com `policy_fail: 'false'`, `fail_build: 'false'` ou `bypass: 'true'`, os achados registrados continuam sinalizados no summary, com a esteira preservada.

Com `bypass: 'true'`, a action executa os scans conforme os demais inputs, mas não bloqueia o job por `policy_fail`, `fail_build`, `fail_on_cve`, `fail_on_severity`, política IaC ou violação de Pipeline/baseline. Se `enable_upload_scan: 'true'`, o Upload & Scan ignora `veracode_sandbox` e `veracode_sandbox_name` e envia o artefato para a sandbox chamada `bypass` (`createsandbox` ativo). Com Upload & Scan desligado, nada é enviado.

O **Resumo Final** é gerado também quando a validação de inputs falha e reúne os resultados que puderam ser obtidos. Cada scan ou política reprovada aparece em vermelho (`❌ Failed`); violações confirmadas do Pipeline continuam vermelhas mesmo quando o bloqueio está desativado. Avisos técnicos sem violação confirmada usam amarelo. O resultado do scan e a decisão de reprovar o job são apresentados separadamente.

Logo abaixo de **Veracode Connect — Resumo Final**, o summary e o comentário do PR exibem **Link de acesso para Veracode: [Acesse Aqui](https://analysiscenter.veracode.com/)**. Configure `veracode_url` para usar outro endereço de acesso, inclusive de outra região ou SSO. O padrão é `https://analysiscenter.veracode.com/`; URLs vazias ou inválidas usam esse padrão. Os links automáticos de relatório SCA e de plataforma do Upload & Scan deixam de ser exibidos.

Nos fluxos SAST com baseline, a tabela **Vulnerabilidades Bloqueantes de Esteira** usa somente os findings de `filtered_results.json`, selecionados pelo Pipeline Scan após aplicar a política e o baseline. Findings novos fora dos critérios da política continuam na tabela **Todas Vulnerabilidades**. Resultado filtrado vazio significa zero bloqueantes; se o arquivo estiver ausente ou não puder ser lido, o resumo informa que os bloqueantes estão indisponíveis.

Quando o Connect é chamado mais de uma vez no mesmo job, o último **Resumo Final** e o comentário do PR reúnem os resultados dessas chamadas. Um Pipeline executado antes de uma chamada somente de SCA/IaC continua visível como **Pipeline Scan (Repo Baseline)**, **Pipeline Scan (Portal Afrika Baseline)** ou **Pipeline Scan**, junto com seu detalhamento. Scans desativados na chamada seguinte preservam o resultado anterior; uma nova execução do mesmo scan substitui o resultado mostrado. A consolidação é separada por job, execução, tentativa e workspace.

Quando um scan não consegue executar ou produzir resultados, o **Resumo Final** mostra `⚠️ Warning`, preserva os avisos existentes (como `⚠️ Nenhum artefato de resultado SCA encontrado.`) e **não reprova o job por essa ausência**, mesmo com `policy_fail` e `fail_build` habilitados. Erros técnicos de execução/avaliação IaC e de Upload & Scan também ficam amarelos. Violações confirmadas por outro scan continuam bloqueantes. O diagnóstico técnico fica habilitado por padrão.

No SCA, `policy_fail` é repassado ao parâmetro oficial `breakBuildOnPolicyFindings`. Sem resultado reconhecível com bibliotecas analisadas, o status é `warning`; arquivos ausentes, inválidos, contendo apenas erros ou sem bibliotecas não bloqueiam. Resultados SCA anteriores são removidos antes de cada scan. Com resultado de análise, a falha da action oficial continua bloqueante quando os dois inputs estão habilitados. A action oficial não distingue a causa de um retorno não zero; nessa situação o summary indica **falha do SCA**, sem afirmar que ela comprova uma violação de política.

O input `fail_on_cve` é uma regra da própria Connect (não existe na action oficial SCA). Após o SCA, a Connect lê `scaResults.json` e compara cada vulnerabilidade com a lista informada (match exato de CVE, separados por vírgula, espaço ou quebra de linha; ex.: `CVE-2021-44228,CVE-2021-45046`). Com match e `policy_fail: 'true'`, o status SCA vira `failure` e, com `fail_build: 'true'`, a esteira bloqueia ao final. Sem `policy_fail`, o match aparece como warning e no relatório, sem travar. O summary e o comentário do PR mostram **Findings bloqueados por CVE** acima de **Findings do SCA**; os findings bloqueados também permanecem na lista geral.

A action oficial SCA Agent-based não aceita uma política por nome. Para usar a mesma política selecionada por `veracode_policy_name` no Pipeline, atribua essa política ao **workspace SCA associado ao token**, na opção Policy Assignment da plataforma Veracode. A política precisa conter regras aplicáveis ao SCA Agent-based. A Connect não altera essa atribuição e não consegue garantir que as duas políticas sejam iguais apenas pelo input. Veja [atribuição de políticas ao workspace](https://docs.veracode.com/r/Manage_security_policies) e [inputs da action oficial SCA](https://github.com/veracode/veracode-sca/blob/aeeb6aaa608a49195cab32c44b75db4f6a07a2df/action.yml).

Findings do Upload & Scan não acionam essa decisão de bloqueio. Com `iac_policy: 'none'` (padrão), não há avaliação de política IaC nem bloqueio por ela. `enable_iac_configs` aplica as regras customizadas do `veracode.yml`; para bloquear por política IaC, também informe a política em `iac_policy`. Falha ao baixar/aplicar uma política pedida aparece como política não avaliada e IaC com status de warning, sem ser confundida com reprovação de policy. O Upload & Scan faz um envio assíncrono; seu resultado de policy deve ser acompanhado na plataforma Veracode.

## Downloads, cache e Maven Central

As actions oficiais da Veracode baixam suas ferramentas a cada execução: o `pipeline-scan-LATEST.zip` (≈8 MB) em **cada** slot do Pipeline Scan (até 12 por run, com retries), a Veracode CLI (≈64 MB) no IaC e no Auto Packager, e o agente SCA (≈140 MB). O SCA e o Auto Packager também rodam o Maven/Gradle do projeto, que baixa todas as dependências do Maven Central em runners limpos.

Com `enable_tools_cache: 'true'` (padrão, runners Linux), a action:

1. Calcula quais ferramentas a execução usa e restaura cada uma do `actions/cache` (chave por versão/janela).
2. Baixa **uma única vez** o que faltar, verifica a integridade (sha256 pinado em [`internal/toolchain/tools.json`](internal/toolchain/tools.json) para a CLI; zip/tgz válidos para Pipeline Scan e agente SCA) e salva no cache logo em seguida, mesmo que a esteira seja bloqueada depois.
3. Coloca um shim de `curl` na frente do `PATH`. Ele responde do disco local apenas as URLs de download dessas ferramentas e repassa qualquer outra chamada ao `curl` real. As actions oficiais continuam inalteradas e pinadas.

| Ferramenta | Antes (por execução) | Com cache aquecido |
| --- | --- | --- |
| `pipeline-scan-LATEST.zip` | 1 por slot (até 12) | 0 |
| Veracode CLI | até 2 (IaC + Auto Packager) | 0 |
| Agente SCA (`ci.sh`, `LATEST_VERSION`, `.tgz`) | 3 | 0 |
| Wrapper Java do Upload & Scan (Maven Central) | 0 (vendorizado) | 0 |
| Dependências Maven/Gradle | 1 resolução completa por SCA/Auto Packager | só artefatos novos |

A CLI segue a versão pinada (`2.54.1`), a mesma usada pelo IaC e pelo Auto Packager. O Pipeline Scan e o agente SCA só são publicados como `LATEST`, então são renovados por janela em `tools_cache_refresh` (`weekly` por padrão). As ferramentas ficam em `$RUNNER_TEMP`, nunca no workspace, e o cache do `actions/cache` é isolado por repositório. Se algo falhar (download, verificação, runner Windows/macOS/ARM ou Alpine), a ferramenta afetada não entra no cache e a action oficial baixa normalmente, como antes.

Com `cache_dependencies: 'true'` (padrão) e SCA ou Auto Packager ativos, `~/.m2/repository`, `~/.m2/wrapper`, `~/.gradle/caches` e `~/.gradle/wrapper` são restaurados antes do SCA e salvos depois do Upload & Scan. A chave usa o hash de `pom.xml`, `build.gradle(.kts)`, `settings.gradle(.kts)`, `libs.versions.toml`, `gradle.lockfile` e dos `*-wrapper.properties`; sem esses arquivos o cache não é usado. Se o workflow já faz cache do Maven/Gradle (por exemplo, `actions/setup-java` com `cache: maven`), use `cache_dependencies: 'false'` para não duplicar.

Para não usar o Maven Central, informe `maven_mirror_url` (Nexus/Artifactory, `https`). A action cria um `~/.m2/settings.xml` temporário com `<mirrorOf>central</mirrorOf>` (ou o valor de `maven_mirror_of`, por exemplo `*`) e o remove ao final. Um `settings.xml` existente nunca é sobrescrito. Credenciais opcionais: `maven_mirror_username` e `maven_mirror_password` (use secrets). Para Gradle, configure o mirror no próprio projeto (`settings.gradle`/`init.gradle`).

Para não depender da CDN da Veracode, publique as ferramentas em um mirror `https` próprio e informe a URL base em `tools_mirror_url`:

```text
<tools_mirror_url>/veracode-cli/veracode-cli_<versão>_linux_x86.tar.gz
<tools_mirror_url>/securityscan/pipeline-scan-LATEST.zip
<tools_mirror_url>/sca/ci.sh
<tools_mirror_url>/sca/LATEST_VERSION
<tools_mirror_url>/sca/srcclr-<versão>-linux.tgz
```

O mirror precisa aceitar leitura anônima. O sha256 pinado da CLI continua sendo verificado.

```yaml
- uses: actions/checkout@v4
- uses: Afrika-Tecnologia/Veracode-Connect@v1.8.2
  with:
    veracode_api_id: ${{ secrets.VERACODE_API_ID }}
    veracode_api_key: ${{ secrets.VERACODE_API_KEY }}
    enable_sca: 'true'
    veracode_sca_token: ${{ secrets.VERACODE_SCA_TOKEN }}
    enable_auto_packager: 'true'
    maven_mirror_url: https://nexus.example.com/repository/maven-public/
    maven_mirror_username: ${{ secrets.NEXUS_USER }}
    maven_mirror_password: ${{ secrets.NEXUS_TOKEN }}
```

Para atualizar a CLI, troque `version` e os dois sha256 em `internal/toolchain/tools.json` e o default de `cli_version` em `internal/auto-packager/action.yml`; o teste `wiring.test.js` falha se divergirem.

## Diagnóstico de falhas técnicas

Com `enable_error_logs: 'true'`, valor padrão, a action publica um artefato `veracode-connect-error-*` quando identifica um incidente técnico ou uma falha do SCA oficial, que não distingue erro técnico de reprovação de política. O arquivo `diagnostic.json` contém repositório, run, tentativa, job, commit e uma lista de componentes, etapas e códigos de erro. Ele não contém credenciais, respostas de API, findings nem o log bruto. Findings de policy isolados do Pipeline/IaC e tentativas recuperadas por retry não geram esse artefato. Use `enable_error_logs: 'false'` para desativar a publicação.

| Código | Significado |
| --- | --- |
| `STEP_FAILED` | Falha de uma etapa técnica. |
| `SCAN_ERROR` | Pipeline Scan sem resultado válido após o retry. |
| `RATE_LIMIT` | Falha final do Pipeline Scan com indicação de limite de requisições. |
| `UNSCANNABLE` | Artefato selecionado que a ferramenta não conseguiu analisar. |
| `RESULT_MISSING` | Resultado esperado ausente ou inválido. |
| `NO_LIBRARIES_ANALYZED` | SCA terminou sem bibliotecas analisadas. |

O artefato é temporário, fica no **repositório que executa o workflow** e segue a visibilidade desse repositório. A retenção solicitada é de 14 dias, sujeita à política do GitHub da organização. Os logs completos pertencem ao workflow do GitHub Actions: um coletor externo, ainda separado desta action, poderá buscar o artefato e os logs depois que o run terminar e gravá-los em um repositório privado próprio. Nenhuma credencial desse coletor é passada para a action. Cancelamento do job, perda do runner ou falha no upload podem impedir a publicação do diagnóstico.

## Inputs

Os defaults abaixo correspondem ao [manifesto da action](action.yml). Campos condicionais só são necessários quando a função relacionada está habilitada.

### Credenciais e artefato

| Input | Default | Finalidade |
| --- | --- | --- |
| `veracode_api_id` | Obrigatório | ID da API Veracode. |
| `veracode_api_key` | Obrigatório | Chave da API Veracode. |
| `scan_file` | Vazio | Arquivo a analisar quando o Auto Packager está desativado. |
| `enable_auto_packager` | `'false'` | Gera artefatos a partir do commit analisado. |
| `veracode_appname` | Repositório atual | Nome da aplicação no Veracode. |

### Scans e resultado

| Input | Default | Finalidade |
| --- | --- | --- |
| `enable_pipelinescan` | `'true'` | Ativa o Pipeline Scan quando `baseline_mode` é `none`. |
| `pipeline_scan_max_artifacts` | `'6'` | Limite de artefatos do Pipeline Scan, de 1 a 6. |
| `pipeline_scan_pace_seconds` | `'12'` | Intervalo entre inícios de scans. |
| `pipeline_scan_retry` | `'true'` | Repete uma vez scans sem resultado válido. |
| `enable_sca` | `'false'` | Ativa SCA. |
| `veracode_sca_token` | Vazio | Token necessário quando SCA está ativo. |
| `enable_iac` | `'false'` | Ativa IaC/Secrets. |
| `enable_iac_configs` | `'false'` | Baixa `veracode.yml` da raiz do repositório de baseline para o workspace e aplica as regras no IaC. Só tem efeito com `enable_iac: 'true'`; exige organização e GitHub App/PAT do baseline, independentemente de `baseline_mode`. Se o arquivo faltar ou o download falhar, a action avisa e continua sem as regras customizadas do baseline. |
| `iac_policy` | `'none'` | Nome da política Container/IaC Veracode a baixar e aplicar. `none` mantém o fluxo atual; outro valor exige `enable_iac: 'true'` e uma política compatível com Rego. A reprovação aparece no status IaC e no resumo final sem encerrar o step do scan. |
| `enable_iac_baseline` | `'false'` | Baseline IaC/Secrets no repositório de baseline (`iac-baseline.json`, gravado uma única vez). Só findings novos são avaliados pela política IaC. Exige `baseline_mode: 'repo'` e `enable_iac: 'true'`. Veja [Baseline IaC/Secrets](#baseline-iacsecrets). |
| `enable_upload_scan` | `'false'` | Ativa Upload & Scan. |
| `upload_scan_artifacts` | `all` | Envia todos os pacotes do Auto Packager ou apenas o `primary`. |
| `veracode_sandbox` | Automático | Usa aplicação principal na branch padrão e sandbox nas demais; aceita `'true'` ou `'false'`. Ignorado quando `bypass` é `'true'`. |
| `veracode_sandbox_name` | Vazio | Obrigatório quando `veracode_sandbox` é `'true'`, exceto com `bypass: 'true'`; no modo automático, a action gera o nome. |
| `veracode_policy_name` | Vazio | Nome da policy para Pipeline Scan e, quando informado, Upload & Scan. |
| `fail_on_severity` | Vazio | Severidades consideradas quando há baseline. |
| `fail_on_cve` | Vazio | Lista de CVEs exatos que, se encontrados no resultado SCA, marcam o SCA como `failure` (com `policy_fail`) e bloqueiam com `fail_build`. Ex.: `CVE-2021-44228,CVE-2021-45046`. |
| `policy_fail` | `'false'` | Repassa `breakBuildOnPolicyFindings` ao SCA e habilita bloqueio final por falha SCA com resultado, CVE de `fail_on_cve` ou violação confirmada de policy/baseline do Pipeline/IaC. Não bloqueia o job quando `bypass` é `'true'`. |
| `fail_build` | `'true'` | Em conjunto com `policy_fail`, permite bloquear a esteira ao final, depois dos scans e do summary. Ignorado quando `bypass` é `'true'`. |
| `bypass` | `'false'` | Mantém os scans configurados, mas preserva a esteira mesmo com `policy_fail` e `fail_build`. Com Upload & Scan ativo, envia obrigatoriamente para a sandbox `bypass`. |

### Baseline

| Input | Default | Finalidade |
| --- | --- | --- |
| `baseline_mode` | `none` | Provedor: `none`, `portal_afrika` ou `repo`. |
| `portal_afrika_api_key` | Vazio | Obrigatório no modo `portal_afrika`. |
| `portal_afrika_base_url` | `https://www.bantuu.io` | URL do Portal, sem barra final. |
| `baseline_org` | Vazio | Organização dona do repositório de baseline; obrigatória no modo `repo` ou com regras IaC centralizadas ativas. |
| `baseline_repo_name` | `Afrika-Veracode-Connect-Baseline` | Repositório de baseline no modo `repo` e fonte do `veracode.yml` quando `enable_iac_configs` está ativo. |
| `baseline_repo_branch` | Branch padrão do store | Branch usada para ler/gravar o baseline e baixar `veracode.yml`. |
| `baseline_github_app_id` | Vazio | ID do GitHub App para acessar o baseline e as regras IaC centralizadas. |
| `baseline_github_app_private_key` | Vazio | Chave privada do App. |
| `baseline_github_app_installation_id` | Vazio | ID da instalação do App. |
| `baseline_github_token` | Vazio | PAT alternativo ao App. |

### Integrações e diagnóstico

| Input | Default | Finalidade |
| --- | --- | --- |
| `create_issues` | `'false'` | Publica issues de SCA e Pipeline Scan no repositório analisado. |
| `comment_pr` | `'false'` | Publica ou atualiza um comentário no Pull Request e remove comentários extras de SCA e IaC/Secrets publicados pelo bot. |
| `veracode_url` | `https://analysiscenter.veracode.com/` | Endereço HTTP/HTTPS do link **Acesse Aqui**, abaixo do título do Resumo Final no summary e no comentário do PR. |
| `enable_error_logs` | `'true'` | Publica diagnóstico em falhas técnicas ou falhas reportadas pelo SCA oficial. |

### Cache e rede

| Input | Default | Finalidade |
| --- | --- | --- |
| `enable_tools_cache` | `'true'` | Baixa uma vez a Veracode CLI, o Pipeline Scan e o agente SCA, guarda no `actions/cache` e serve às actions oficiais sem novos downloads (Linux). |
| `tools_cache_refresh` | `weekly` | Janela de renovação do Pipeline Scan e do agente SCA: `daily`, `weekly` ou `monthly`. |
| `tools_mirror_url` | Vazio | URL `https` base de um mirror próprio das ferramentas (layout em [Downloads, cache e Maven Central](#downloads-cache-e-maven-central)). |
| `cache_dependencies` | `'true'` | Cache de `~/.m2` e `~/.gradle` quando SCA ou Auto Packager estão ativos. |
| `maven_mirror_url` | Vazio | Mirror Maven `https`; gera um `settings.xml` temporário se não existir. |
| `maven_mirror_of` | `central` | Valor de `<mirrorOf>`; use `*` para redirecionar todos os repositórios. |
| `maven_mirror_username` | Vazio | Usuário do mirror (exige `maven_mirror_password`). |
| `maven_mirror_password` | Vazio | Senha/token do mirror; use um secret. |

Com `comment_pr: 'true'`, os comentários automáticos das actions oficiais de SCA e Container/IaC/Secrets são removidos ao final do job, inclusive os de execuções anteriores. Essas actions ainda podem publicá-los temporariamente durante o scan; a remoção não impede notificações já enviadas pelo GitHub.

## Outputs

| Output | Descrição |
| --- | --- |
| `baseline_mode` | Modo de baseline resolvido. |
| `has_baseline` | Indica se havia baseline para o repositório. |
| `pipeline_status` | Status do caminho seguido pelo Pipeline Scan. |
| `repository_full_name` | Nome completo do repositório analisado. |
| `sca_status` | Status do SCA: `success`, `failure`, `warning` ou `skipped`. Sem resultado de análise, retorna `warning`. `success` não comprova qual política está atribuída ao workspace. |
| `iac_status` | Status do IaC/Secrets: `success`, `failure`, `warning` ou `skipped`. Erros técnicos retornam `warning`; política reprovada retorna `failure`. |
| `iac_policy_status` | Resultado da política IaC: `not_used`, `passed`, `failed`, `error` ou `deferred` (baseline IaC ainda não utilizado). Com baseline IaC comparado, considera só os findings novos. |
| `iac_baseline_status` | Estado do baseline IaC: `not_used`, `deferred`, `seeded`, `compared` ou `error`. |
| `has_iac_baseline` | Indica se o baseline IaC já existia. |
| `iac_new_policy_count` | Findings IaC novos que violam a política. |
| `upload_scan_status` | Status do Upload & Scan. |

Os módulos ativos também podem publicar artefatos de resultado no GitHub Actions. A presença desses arquivos depende de cada ferramenta e do ponto em que a execução terminou.
