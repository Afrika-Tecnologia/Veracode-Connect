# Diagnóstico de falhas técnicas

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
