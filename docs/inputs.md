# Inputs e outputs

Os defaults abaixo correspondem ao [manifesto da action](../action.yml). Campos condicionais só são necessários quando a função relacionada está habilitada.

## Credenciais e artefato

| Input | Default | Finalidade |
| --- | --- | --- |
| `veracode_api_id` | Obrigatório | ID da API Veracode. |
| `veracode_api_key` | Obrigatório | Chave da API Veracode. |
| `scan_file` | Vazio | Arquivo a analisar quando o Auto Packager está desativado. |
| `enable_auto_packager` | `'false'` | Gera artefatos a partir do commit analisado. |
| `veracode_appname` | Repositório atual | Nome da aplicação no Veracode. |

## Scans e resultado

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
| `enable_iac_baseline` | `'false'` | Baseline IaC/Secrets no repositório de baseline (`iac-baseline.json`, gravado uma única vez). Só findings novos são avaliados pela política IaC. Exige `baseline_mode: 'repo'` e `enable_iac: 'true'`. Veja [Baseline IaC/Secrets](baseline.md#baseline-iacsecrets). |
| `enable_upload_scan` | `'false'` | Ativa Upload & Scan. |
| `upload_scan_artifacts` | `all` | Envia todos os pacotes do Auto Packager ou apenas o `primary`. |
| `veracode_sandbox` | Automático | Usa aplicação principal na branch padrão e sandbox nas demais; aceita `'true'` ou `'false'`. Ignorado quando `bypass` é `'true'`. |
| `veracode_sandbox_name` | Vazio | Obrigatório quando `veracode_sandbox` é `'true'`, exceto com `bypass: 'true'`; no modo automático, a action gera o nome. |
| `veracode_policy_name` | Vazio | Nome da policy para Pipeline Scan e, quando informado, Upload & Scan. |
| `fail_on_severity` | Vazio | Severidades consideradas quando há baseline. |
| `enable_sca_baseline` | `'false'` | Baseline SCA no repositório de baseline (`sca-baseline.json`, gravado uma única vez). Só vulnerabilidades novas que afetam a política bloqueiam. Exige `baseline_mode: 'repo'` e `enable_sca: 'true'`. Veja [Baseline SCA](baseline.md#baseline-sca). |
| `sca_fail_on_severity` | Vazio | Com baseline SCA, severidades das vulnerabilidades novas que afetam a política (`Very High, High, Medium, Low, Very Low`). Vazio = qualquer severidade. |
| `fail_on_cve` | Vazio | Lista de CVEs exatos que, se encontrados no resultado SCA, marcam o SCA como `failure` (com `policy_fail`) e bloqueiam com `fail_build`. Ex.: `CVE-2021-44228,CVE-2021-45046`. |
| `policy_fail` | `'false'` | Repassa `breakBuildOnPolicyFindings` ao SCA e habilita bloqueio final por falha SCA com resultado, CVE de `fail_on_cve` ou violação confirmada de policy/baseline do Pipeline/IaC. Não bloqueia o job quando `bypass` é `'true'`. |
| `fail_build` | `'true'` | Em conjunto com `policy_fail`, permite bloquear a esteira ao final, depois dos scans e do summary. Ignorado quando `bypass` é `'true'`. |
| `bypass` | `'false'` | Mantém os scans configurados, mas preserva a esteira mesmo com `policy_fail` e `fail_build`. Com Upload & Scan ativo, envia obrigatoriamente para a sandbox `bypass`. |

## Baseline

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

## Integrações e diagnóstico

| Input | Default | Finalidade |
| --- | --- | --- |
| `create_issues` | `'false'` | Publica issues de SCA e Pipeline Scan no repositório analisado. |
| `comment_pr` | `'false'` | Publica ou atualiza um comentário no Pull Request e remove comentários extras de SCA e IaC/Secrets publicados pelo bot. |
| `veracode_url` | `https://analysiscenter.veracode.com/` | Endereço HTTP/HTTPS do link **Acesse Aqui**, abaixo do título do Resumo Final no summary e no comentário do PR. |
| `enable_error_logs` | `'true'` | Publica diagnóstico em falhas técnicas ou falhas reportadas pelo SCA oficial. |

## Cache e rede

| Input | Default | Finalidade |
| --- | --- | --- |
| `enable_tools_cache` | `'true'` | Baixa uma vez a Veracode CLI, o Pipeline Scan e o agente SCA, guarda no `actions/cache` e serve às actions oficiais sem novos downloads (Linux). |
| `tools_cache_refresh` | `weekly` | Janela de renovação do Pipeline Scan e do agente SCA: `daily`, `weekly` ou `monthly`. |
| `tools_mirror_url` | Vazio | URL `https` base de um mirror próprio das ferramentas (layout em [Downloads, cache e Maven Central](cache.md)). |
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
| `cve_blocked_count` | Quantidade de vulnerabilidades SCA cujo CVE está em `fail_on_cve` (`0` quando desligado ou sem match). |
| `iac_status` | Status do IaC/Secrets: `success`, `failure`, `warning` ou `skipped`. Erros técnicos retornam `warning`; política reprovada retorna `failure`. |
| `iac_policy_status` | Resultado da política IaC: `not_used`, `passed`, `failed`, `error` ou `deferred` (baseline IaC ainda não utilizado). Com baseline IaC comparado, considera só os findings novos. |
| `iac_baseline_status` | Estado do baseline IaC: `not_used`, `deferred`, `seeded`, `compared` ou `error`. |
| `has_iac_baseline` | Indica se o baseline IaC já existia. |
| `iac_new_policy_count` | Findings IaC novos que violam a política. |
| `sca_baseline_status` | Estado do baseline SCA: `not_used`, `deferred`, `seeded`, `compared` ou `error`. |
| `has_sca_baseline` | `true` quando o baseline SCA já existia. |
| `sca_new_policy_count` | Vulnerabilidades SCA novas que afetam a política. |
| `upload_scan_status` | Status do Upload & Scan. |

Os módulos ativos também podem publicar artefatos de resultado no GitHub Actions. A presença desses arquivos depende de cada ferramenta e do ponto em que a execução terminou.
