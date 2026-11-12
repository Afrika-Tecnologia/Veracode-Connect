# Configuração

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

