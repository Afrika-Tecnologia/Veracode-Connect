# Veracode Connect

GitHub Action que reúne Pipeline Scan, SCA, IaC/Secrets e Upload & Scan da Veracode em um único fluxo. O Pipeline Scan pode usar um baseline no Portal Afrika ou em um repositório GitHub. Cada módulo pode ser habilitado conforme a necessidade do repositório.

## Antes de usar

- Use um runner Linux e disponibilize `veracode_api_id` e `veracode_api_key` como secrets do workflow.
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
| `repo` | Lê o baseline de um repositório GitHub. Cria ou atualiza o baseline apenas na branch padrão do repositório analisado; outras branches somente o consultam. |

Para `repo`, prepare um repositório de baseline com pelo menos um commit. A autenticação pode usar um GitHub App instalado nesse repositório ou um PAT; a credencial precisa de acesso de leitura e escrita a Contents. O App usa `baseline_github_app_id`, `baseline_github_app_private_key` e `baseline_github_app_installation_id`. O PAT usa `baseline_github_token`. Essas credenciais são necessárias no workflow chamador somente quando o modo `repo` é usado.

## Resultado da esteira

Falhas técnicas de validação, empacotamento, análise, envio, baseline ou publicação geram aviso e **não reprovam o job por esta action**. O diagnóstico técnico fica habilitado por padrão. A action só bloqueia a esteira por findings de policy do Pipeline Scan quando `policy_fail` e `fail_build` são `'true'`, o fluxo terminou com sucesso, todos os artefatos planejados foram analisados e o resultado desta execução é válido. Um resultado parcial ou ausente não aciona esse bloqueio.

Findings de SCA, IaC/Secrets e do Upload & Scan não acionam essa decisão de bloqueio. O Upload & Scan faz um envio assíncrono; seu resultado de policy deve ser acompanhado na plataforma Veracode.

## Diagnóstico de falhas técnicas

Com `enable_error_logs: 'true'`, valor padrão, a action publica um artefato `veracode-connect-error-*` **somente quando identifica um incidente técnico**. O arquivo `diagnostic.json` contém repositório, run, tentativa, job, commit e uma lista de componentes, etapas e códigos de erro. Ele não contém credenciais, respostas de API, findings nem o log bruto. Findings de policy isolados e tentativas recuperadas por retry não geram esse artefato. Use `enable_error_logs: 'false'` para desativar a publicação.

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
| `enable_upload_scan` | `'false'` | Ativa Upload & Scan. |
| `upload_scan_artifacts` | `all` | Envia todos os pacotes do Auto Packager ou apenas o `primary`. |
| `veracode_sandbox` | Automático | Usa aplicação principal na branch padrão e sandbox nas demais; aceita `'true'` ou `'false'`. |
| `veracode_sandbox_name` | Vazio | Obrigatório quando `veracode_sandbox` é `'true'`; no modo automático, a action gera o nome. |
| `veracode_policy_name` | Vazio | Nome da policy para Pipeline Scan e, quando informado, Upload & Scan. |
| `fail_on_severity` | Vazio | Severidades consideradas quando há baseline. |
| `policy_fail` | `'false'` | Habilita reprovação por findings de policy do Pipeline Scan. |
| `fail_build` | `'true'` | Em conjunto com `policy_fail`, permite bloquear a esteira por policy em um scan completo. |

### Baseline

| Input | Default | Finalidade |
| --- | --- | --- |
| `baseline_mode` | `none` | Provedor: `none`, `portal_afrika` ou `repo`. |
| `portal_afrika_api_key` | Vazio | Obrigatório no modo `portal_afrika`. |
| `portal_afrika_base_url` | `https://www.bantuu.io` | URL do Portal, sem barra final. |
| `baseline_org` | Vazio | Organização dona do repositório de baseline; obrigatória no modo `repo`. |
| `baseline_repo_name` | `Afrika-Veracode-Connect-Baseline` | Repositório de baseline no modo `repo`. |
| `baseline_repo_branch` | Branch padrão do store | Branch usada para ler e gravar o baseline. |
| `baseline_github_app_id` | Vazio | ID do GitHub App para o modo `repo`. |
| `baseline_github_app_private_key` | Vazio | Chave privada do App. |
| `baseline_github_app_installation_id` | Vazio | ID da instalação do App. |
| `baseline_github_token` | Vazio | PAT alternativo ao App. |

### Integrações e diagnóstico

| Input | Default | Finalidade |
| --- | --- | --- |
| `create_issues` | `'false'` | Publica issues de SCA e Pipeline Scan no repositório analisado. |
| `comment_pr` | `'false'` | Publica ou atualiza um comentário no Pull Request. |
| `enable_error_logs` | `'true'` | Publica diagnóstico somente em falhas técnicas. |

## Outputs

| Output | Descrição |
| --- | --- |
| `baseline_mode` | Modo de baseline resolvido. |
| `has_baseline` | Indica se havia baseline para o repositório. |
| `pipeline_status` | Status do caminho seguido pelo Pipeline Scan. |
| `repository_full_name` | Nome completo do repositório analisado. |
| `sca_status` | Status do SCA. |
| `iac_status` | Status do IaC/Secrets. |
| `upload_scan_status` | Status do Upload & Scan. |

Os módulos ativos também podem publicar artefatos de resultado no GitHub Actions. A presença desses arquivos depende de cada ferramenta e do ponto em que a execução terminou.
