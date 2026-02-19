# Script de Release Automatizado

Este script facilita o processo de tagueamento de novas versões da Action, garantindo que as `major` e `minor` tags (ex: `v1`, `v1.1`) apontem sempre para a versão mais recente (`v1.1.6`).

## Pré-requisitos

- Git instalado e configurado.
- Bash terminal (Git Bash no Windows, ou terminal nativo no Linux/Mac).
- Estar na raiz do projeto.

## Como usar

1.  **Prepare a Release:**
    - Atualize o `check-version` no `package.json` (se houver).
    - Atualize o `CHANGELOG.md`.
    - Atualize o `README.md` se houver novos inputs/outputs.
    - Faça o commit e push das alterações para a `main`.

2.  **Execute o Script:**
    Abra o terminal na raiz do projeto e execute:

    **Opção A: Windows (PowerShell)**
    ```powershell
    .\.github\scripts\release.ps1 -Version 1.1.6
    ```

    **Opção B: Linux / Mac / Git Bash**
    ```bash
    # Dê permissão de execução (apenas na 1ª vez)
    chmod +x .github/scripts/release.sh

    # Rode o script
    ./.github/scripts/release.sh 1.1.6
    ```

3.  **Confirme:**
    O script exibirá as tags que serão criadas/atualizadas. Digite `y` para confirmar.

## O que o script faz?

1.  Verifica se você passou uma versão válida (X.Y.Z).
2.  Cria a tag completa (Ex: `v1.1.6`).
3.  Atualiza a tag minor (Ex: `v1.1`) para apontar para o mesmo commit.
4.  Atualiza a tag major (Ex: `v1`) para apontar para o mesmo commit.
5.  Faz `git push` de todas as tags (com `--force` para as que foram movidas).
