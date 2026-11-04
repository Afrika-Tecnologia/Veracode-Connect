#!/usr/bin/env bash
# Prepara o Java API wrapper vendorizado e shims curl/wget para a
# veracode/uploadandscan-action nao consultar o Maven Central.
#
# Uso (composite): bash "$GITHUB_ACTION_PATH/prepare-java-wrapper.sh"
set -euo pipefail

ACTION_PATH="${GITHUB_ACTION_PATH:?GITHUB_ACTION_PATH obrigatorio}"
WORKSPACE="${GITHUB_WORKSPACE:?GITHUB_WORKSPACE obrigatorio}"
VENDOR_DIR="${ACTION_PATH}/vendor"
VERSION_FILE="${VENDOR_DIR}/VERSION"

if [ ! -f "${VERSION_FILE}" ]; then
  echo "::error::$(node "${ACTION_PATH}/messages.js" error WRAPPER_VERSION_MISSING "path=${VERSION_FILE}")"
  exit 1
fi

VERSION="$(tr -d '[:space:]' < "${VERSION_FILE}")"
JAR_NAME="vosp-api-wrappers-java-${VERSION}.jar"
VENDOR_JAR="${VENDOR_DIR}/${JAR_NAME}"

if [ ! -f "${VENDOR_JAR}" ]; then
  echo "::error::$(node "${ACTION_PATH}/messages.js" error WRAPPER_JAR_MISSING "path=${VENDOR_JAR}" "version=${VERSION}")"
  exit 1
fi

case "$(uname -s 2>/dev/null || echo unknown)" in
  Linux*|Darwin*) ;;
  MINGW*|MSYS*|CYGWIN*|Windows*)
    echo "::error::$(node "${ACTION_PATH}/messages.js" error WRAPPER_OS_UNSUPPORTED)"
    exit 1
    ;;
  *)
    # GitHub-hosted runners de Upload & Scan sao Linux; demais Unix seguem.
    ;;
esac

SHIM_MARKER='# veracode-connect-shim'

# Primeiro binário do PATH que não seja shim do Veracode Connect.
real_bin() {
  local name="$1" entry candidate
  local -a entries
  IFS=':' read -r -a entries <<< "${PATH}"
  for entry in "${entries[@]}"; do
    candidate="${entry:-.}/${name}"
    if [ -f "${candidate}" ] && [ -x "${candidate}" ] && ! grep -qF "${SHIM_MARKER}" "${candidate}" 2>/dev/null; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done
  return 1
}

if ! real_bin curl >/dev/null; then
  echo "::error::$(node "${ACTION_PATH}/messages.js" error WRAPPER_CURL_MISSING)"
  exit 1
fi
if ! real_bin wget >/dev/null; then
  echo "::error::$(node "${ACTION_PATH}/messages.js" error WRAPPER_WGET_MISSING)"
  exit 1
fi

SHIM_DIR="${RUNNER_TEMP:-/tmp}/veracode-connect-wrapper-shims"
mkdir -p "${SHIM_DIR}"
cp -f "${VENDOR_JAR}" "${WORKSPACE}/${JAR_NAME}"
cp -f "${VENDOR_JAR}" "${SHIM_DIR}/${JAR_NAME}"

# Metadata minima que a uploadandscan-action parseia com /<latest>([\d.]+)<\/latest>/
cat > "${SHIM_DIR}/maven-metadata.xml" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<metadata>
  <groupId>com.veracode.vosp.api.wrappers</groupId>
  <artifactId>vosp-api-wrappers-java</artifactId>
  <versioning>
    <latest>${VERSION}</latest>
    <release>${VERSION}</release>
    <versions>
      <version>${VERSION}</version>
    </versions>
  </versioning>
</metadata>
EOF

# Delegação: próximo binário do PATH depois da ÚLTIMA ocorrência do diretório do
# shim. Encadeia com o shim do toolchain (internal/toolchain) sem risco de loop.
SHIM_NEXT_BIN="$(cat <<'EOF'
next_bin() {
  local name="$1" own="$2" entry idx last=-1
  local -a entries
  IFS=':' read -r -a entries <<< "${PATH}"
  for idx in "${!entries[@]}"; do
    entry="${entries[$idx]:-.}"
    if [ -d "${entry}" ] && [ "${entry}" -ef "${own}" ]; then
      last="${idx}"
    fi
  done
  for idx in "${!entries[@]}"; do
    [ "${idx}" -le "${last}" ] && continue
    entry="${entries[$idx]:-.}"
    if [ -d "${entry}" ] && [ "${entry}" -ef "${own}" ]; then
      continue
    fi
    if [ -f "${entry}/${name}" ] && [ -x "${entry}/${name}" ]; then
      printf '%s\n' "${entry}/${name}"
      return 0
    fi
  done
  echo "veracode-connect: nenhum ${name} real encontrado no PATH após ${own}." >&2
  return 1
}
EOF
)"

{
  echo '#!/usr/bin/env bash'
  echo "${SHIM_MARKER}"
  echo 'set -euo pipefail'
  echo "SHIM_DIR='${SHIM_DIR}'"
  echo "META='${SHIM_DIR}/maven-metadata.xml'"
  echo "${SHIM_NEXT_BIN}"
  cat <<'EOF'
for arg in "$@"; do
  case "$arg" in
    *vosp-api-wrappers-java*maven-metadata.xml*)
      cat "${META}"
      exit 0
      ;;
  esac
done
NEXT="$(next_bin curl "${SHIM_DIR}")" || exit 127
exec "${NEXT}" "$@"
EOF
} > "${SHIM_DIR}/curl"

{
  echo '#!/usr/bin/env bash'
  echo "${SHIM_MARKER}"
  echo 'set -euo pipefail'
  echo "SHIM_DIR='${SHIM_DIR}'"
  echo "VENDOR_JAR='${SHIM_DIR}/${JAR_NAME}'"
  echo "${SHIM_NEXT_BIN}"
  cat <<'EOF'
for arg in "$@"; do
  case "$arg" in
    *vosp-api-wrappers-java*.jar*)
      out="$(basename "${arg%%\?*}")"
      cp -f "${VENDOR_JAR}" "${PWD}/${out}"
      exit 0
      ;;
  esac
done
NEXT="$(next_bin wget "${SHIM_DIR}")" || exit 127
exec "${NEXT}" "$@"
EOF
} > "${SHIM_DIR}/wget"

chmod +x "${SHIM_DIR}/curl" "${SHIM_DIR}/wget"

case ":${PATH}:" in
  *":${SHIM_DIR}:"*) ;;
  *) echo "${SHIM_DIR}" >> "${GITHUB_PATH}" ;;
esac
echo "wrapper_version=${VERSION}" >> "${GITHUB_OUTPUT}"
echo "wrapper_jar=${WORKSPACE}/${JAR_NAME}" >> "${GITHUB_OUTPUT}"
echo "$(node "${ACTION_PATH}/messages.js" success WRAPPER_READY "version=${VERSION}" "jar=${JAR_NAME}")"
