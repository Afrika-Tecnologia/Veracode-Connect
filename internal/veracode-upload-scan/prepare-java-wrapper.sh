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

REAL_CURL="/usr/bin/curl"
REAL_WGET="/usr/bin/wget"
if [ ! -x "${REAL_CURL}" ]; then
  REAL_CURL="$(command -v curl || true)"
fi
if [ ! -x "${REAL_WGET}" ]; then
  REAL_WGET="$(command -v wget || true)"
fi
if [ -z "${REAL_CURL}" ] || [ ! -x "${REAL_CURL}" ]; then
  echo "::error::$(node "${ACTION_PATH}/messages.js" error WRAPPER_CURL_MISSING)"
  exit 1
fi
if [ -z "${REAL_WGET}" ] || [ ! -x "${REAL_WGET}" ]; then
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

cat > "${SHIM_DIR}/curl" <<EOF
#!/usr/bin/env bash
set -euo pipefail
REAL_CURL="${REAL_CURL}"
META="${SHIM_DIR}/maven-metadata.xml"
for arg in "\$@"; do
  case "\$arg" in
    *vosp-api-wrappers-java*maven-metadata.xml*)
      cat "\${META}"
      exit 0
      ;;
  esac
done
exec "\${REAL_CURL}" "\$@"
EOF

cat > "${SHIM_DIR}/wget" <<EOF
#!/usr/bin/env bash
set -euo pipefail
REAL_WGET="${REAL_WGET}"
VENDOR_JAR="${SHIM_DIR}/${JAR_NAME}"
for arg in "\$@"; do
  case "\$arg" in
    *vosp-api-wrappers-java*.jar*)
      out="\$(basename "\${arg%%\\?*}")"
      cp -f "\${VENDOR_JAR}" "\${PWD}/\${out}"
      exit 0
      ;;
  esac
done
exec "\${REAL_WGET}" "\$@"
EOF

chmod +x "${SHIM_DIR}/curl" "${SHIM_DIR}/wget"

echo "${SHIM_DIR}" >> "${GITHUB_PATH}"
echo "wrapper_version=${VERSION}" >> "${GITHUB_OUTPUT}"
echo "wrapper_jar=${WORKSPACE}/${JAR_NAME}" >> "${GITHUB_OUTPUT}"
echo "$(node "${ACTION_PATH}/messages.js" success WRAPPER_READY "version=${VERSION}" "jar=${JAR_NAME}")"
