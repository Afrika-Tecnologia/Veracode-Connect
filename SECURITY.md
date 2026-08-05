# Security Policy

## Supported Versions

Esta Action segue versionamento semantico. Em geral, apenas a ultima versao `v1.x.x` esta ativa e recebe correcoes.

Versoes suportadas:

- `v1` (ultima tag `v1.3.0` publicada)

## Baseline via repositorio (GitHub App)

Para `baseline_mode: repo`, a org em `baseline_org` **deve** conter o repositório fixo `Afrika-Veracode-Connect-Baseline`. Use GitHub App (`Contents: Read and write`) ou PAT com acesso a esse repo.

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
