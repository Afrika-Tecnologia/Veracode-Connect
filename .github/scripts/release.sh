#!/bin/bash

# Script para automatizar o processo de release e tagging da Action
# Uso: ./release.sh <versao>
# Exemplo: ./release.sh 1.1.6

set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "Uso: $0 <versao>"
  echo "Exemplo: $0 1.1.6"
  exit 1
fi

VERSION="$1"

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

read -p "Confirma? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelado."
    exit 1
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
