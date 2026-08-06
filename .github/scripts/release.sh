#!/bin/bash

# Script para automatizar o processo de release e tagging da Action
# Uso: ./release.sh <versao> [--yes]
# Exemplo: ./release.sh 1.1.6
#          ./release.sh 1.1.6 --yes   # sem prompt (CI/automacao)

set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "Uso: $0 <versao> [--yes]"
  echo "Exemplo: $0 1.1.6"
  exit 1
fi

VERSION="$1"
SKIP_CONFIRM=false
if [ "${2:-}" = "--yes" ] || [ "${2:-}" = "-y" ]; then
  SKIP_CONFIRM=true
fi

# Valida formato X.Y.Z
if ! [[ "${VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Erro: A versao deve estar no formato X.Y.Z (ex: 1.1.6)"
  exit 1
fi

# Extrai partes da versao
MAJOR=$(echo "${VERSION}" | cut -d. -f1)
MINOR=$(echo "${VERSION}" | cut -d. -f2)
PATCH=$(echo "${VERSION}" | cut -d. -f3)

TAG_FULL="v${MAJOR}.${MINOR}.${PATCH}"
TAG_MINOR="v${MAJOR}.${MINOR}"
TAG_MAJOR="v${MAJOR}"

echo "Iniciando release da versao ${VERSION}..."
echo "Tags a serem criadas/atualizadas:"
echo "  - ${TAG_FULL} (nova)"
echo "  - ${TAG_MINOR} (movida para apontar para este commit)"
echo "  - ${TAG_MAJOR} (movida para apontar para este commit)"
echo ""

if [ "${SKIP_CONFIRM}" != "true" ]; then
  read -p "Confirma? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo "Cancelado."
      exit 1
  fi
fi

# Garante que estamos na main atualizada
git checkout main
git pull origin main

# Cria a tag de patch (nunca deve existir, eh uma release nova)
if git rev-parse "${TAG_FULL}" >/dev/null 2>&1; then
    echo "Erro: A tag ${TAG_FULL} ja existe locally."
    exit 1
fi

echo "Criando tag ${TAG_FULL}..."
git tag "${TAG_FULL}"

# Atualiza (forca) as tags de major e minor
echo "Atualizando tag ${TAG_MINOR}..."
git tag -f "${TAG_MINOR}"

echo "Atualizando tag ${TAG_MAJOR}..."
git tag -f "${TAG_MAJOR}"

# Push
echo "Enviando para o remote..."
git push origin "${TAG_FULL}"
git push origin "${TAG_MINOR}" --force
git push origin "${TAG_MAJOR}" --force

echo ""
echo "Sucesso! Release ${TAG_FULL} publicada."
echo "Lembre-se de criar a Release no GitHub associada a tag ${TAG_FULL}."
