#!/usr/bin/env bash
# Toolchain do Veracode Connect.
#
#   toolchain.sh fetch  → garante cada ferramenta exigida no diretório do plano
#                         (reaproveita o cache restaurado; senão baixa UMA vez e verifica)
#   toolchain.sh shims  → instala o shim de curl que serve essas ferramentas às
#                         actions oficiais da Veracode sem acessar a rede
#
# Nunca derruba a execução: ferramenta que falhar fica sem cache e a action
# oficial faz o download direto, como antes.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHIM_MARKER='# veracode-connect-shim'

msg() {
    node "${SCRIPT_DIR}/messages.js" "$@"
}

warn() {
    echo "::warning::$(msg warning "$@")"
}

out() {
    if [ -n "${GITHUB_OUTPUT:-}" ]; then
        echo "$1=$2" >> "${GITHUB_OUTPUT}"
    fi
}

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

sha256_of() {
    sha256sum "$1" | awk '{print $1}'
}

download() {
    local url="$1" dest="$2"
    "${REAL_CURL}" -fsSL --retry 3 --retry-delay 5 --connect-timeout 15 --max-time 900 -o "${dest}" "${url}"
}

# .complete guarda o sha256 de cada arquivo; serve para validar o que veio do cache.
seal() {
    local dir="$1"
    shift
    (cd "${dir}" && sha256sum "$@" > .complete)
}

sealed() {
    local dir="$1"
    [ -f "${dir}/.complete" ] && (cd "${dir}" && sha256sum --check --status .complete)
}

new_tmp() {
    mkdir -p "${TOOLS_ROOT}"
    mktemp -d "${TOOLS_ROOT}/.tmp.XXXXXX"
}

# ── Veracode CLI (versão pinada em tools.json, sha256 obrigatório) ────────────
cli_ok() {
    local dir="$1"
    sealed "${dir}" || return 1
    [ -x "${dir}/veracode" ] || return 1
    [ "$(sha256_of "${dir}/veracode")" = "${CLI_BINARY_SHA256}" ]
}

fetch_cli() {
    local dir="${CLI_DIR}" tmp actual
    if cli_ok "${dir}"; then
        echo "$(msg success TOOL_REUSED tool=veracode-cli "dir=${dir}")"
        out cli_fetched false
        return 0
    fi
    if [ -e "${dir}" ]; then
        warn TOOL_CACHE_INVALID tool=veracode-cli "dir=${dir}"
    fi
    rm -rf "${dir}"
    tmp="$(new_tmp)"
    if ! download "${CLI_URL}" "${tmp}/cli.tgz"; then
        rm -rf "${tmp}"
        warn TOOL_FETCH_FAILED tool=veracode-cli "url=${CLI_URL}"
        return 1
    fi
    actual="$(sha256_of "${tmp}/cli.tgz")"
    if [ "${actual}" != "${CLI_ARCHIVE_SHA256}" ]; then
        rm -rf "${tmp}"
        warn TOOL_VERIFY_FAILED tool=veracode-cli "detail=sha256 do pacote ${actual} difere do pinado em tools.json"
        return 1
    fi
    mkdir -p "${tmp}/x"
    if ! tar xzf "${tmp}/cli.tgz" -C "${tmp}/x" --strip-components=1 || [ ! -f "${tmp}/x/veracode" ]; then
        rm -rf "${tmp}"
        warn TOOL_VERIFY_FAILED tool=veracode-cli "detail=pacote sem o binário veracode"
        return 1
    fi
    mkdir -p "${dir}"
    cp -f "${tmp}/x/veracode" "${dir}/veracode"
    chmod 0755 "${dir}/veracode"
    rm -rf "${tmp}"
    seal "${dir}" veracode
    if ! cli_ok "${dir}"; then
        rm -rf "${dir}"
        warn TOOL_VERIFY_FAILED tool=veracode-cli "detail=sha256 do binário difere do pinado em tools.json"
        return 1
    fi
    echo "$(msg success TOOL_FETCHED tool=veracode-cli "url=${CLI_URL}")"
    out cli_fetched true
}

# ── Pipeline Scan (LATEST, renovado por período) ──────────────────────────────
fetch_pipeline() {
    local dir="${PIPELINE_DIR}" tmp zip
    if sealed "${dir}" && [ -f "${dir}/pipeline-scan-LATEST.zip" ]; then
        echo "$(msg success TOOL_REUSED tool=pipeline-scan "dir=${dir}")"
        out pipeline_fetched false
        return 0
    fi
    if [ -e "${dir}" ]; then
        warn TOOL_CACHE_INVALID tool=pipeline-scan "dir=${dir}"
    fi
    rm -rf "${dir}"
    tmp="$(new_tmp)"
    zip="${tmp}/pipeline-scan-LATEST.zip"
    if ! download "${PIPELINE_URL}" "${zip}"; then
        rm -rf "${tmp}"
        warn TOOL_FETCH_FAILED tool=pipeline-scan "url=${PIPELINE_URL}"
        return 1
    fi
    if ! unzip -tqq "${zip}" >/dev/null 2>&1 || ! unzip -Z1 "${zip}" 2>/dev/null | grep -qx 'pipeline-scan.jar'; then
        rm -rf "${tmp}"
        warn TOOL_VERIFY_FAILED tool=pipeline-scan "detail=zip inválido ou sem pipeline-scan.jar"
        return 1
    fi
    mkdir -p "${dir}"
    mv "${zip}" "${dir}/pipeline-scan-LATEST.zip"
    rm -rf "${tmp}"
    seal "${dir}" pipeline-scan-LATEST.zip
    echo "$(msg success TOOL_FETCHED tool=pipeline-scan "url=${PIPELINE_URL}")"
    out pipeline_fetched true
}

# ── Agente SCA (ci.sh + LATEST_VERSION + srcclr-<versão>-linux.tgz) ───────────
sca_version_of() {
    tr -d '[:space:]' < "$1/LATEST_VERSION"
}

valid_sca_version() {
    [[ "$1" =~ ^[0-9][0-9A-Za-z._-]*$ ]]
}

sca_ok() {
    local dir="$1" version
    sealed "${dir}" || return 1
    [ -f "${dir}/ci.sh" ] && [ -f "${dir}/LATEST_VERSION" ] || return 1
    version="$(sca_version_of "${dir}")"
    valid_sca_version "${version}" && [ -f "${dir}/srcclr-${version}-linux.tgz" ]
}

fetch_sca() {
    local dir="${SCA_DIR}" tmp version archive_url
    if sca_ok "${dir}"; then
        version="$(sca_version_of "${dir}")"
        echo "$(msg success TOOL_REUSED tool=sca-agent "dir=${dir}")"
        out sca_fetched false
        out sca_version "${version}"
        return 0
    fi
    if [ -e "${dir}" ]; then
        warn TOOL_CACHE_INVALID tool=sca-agent "dir=${dir}"
    fi
    rm -rf "${dir}"
    tmp="$(new_tmp)"
    if ! download "${SCA_CI_URL}" "${tmp}/ci.sh" || ! grep -q 'srcclr' "${tmp}/ci.sh"; then
        rm -rf "${tmp}"
        warn TOOL_FETCH_FAILED tool=sca-agent "url=${SCA_CI_URL}"
        return 1
    fi
    if ! download "${SCA_VERSION_URL}" "${tmp}/LATEST_VERSION"; then
        rm -rf "${tmp}"
        warn TOOL_FETCH_FAILED tool=sca-agent "url=${SCA_VERSION_URL}"
        return 1
    fi
    version="$(sca_version_of "${tmp}")"
    if ! valid_sca_version "${version}"; then
        rm -rf "${tmp}"
        warn TOOL_VERIFY_FAILED tool=sca-agent "detail=LATEST_VERSION inválido"
        return 1
    fi
    archive_url="${SCA_ARCHIVE_URL//\{version\}/${version}}"
    if ! download "${archive_url}" "${tmp}/srcclr-${version}-linux.tgz"; then
        rm -rf "${tmp}"
        warn TOOL_FETCH_FAILED tool=sca-agent "url=${archive_url}"
        return 1
    fi
    if ! tar tzf "${tmp}/srcclr-${version}-linux.tgz" >/dev/null 2>&1; then
        rm -rf "${tmp}"
        warn TOOL_VERIFY_FAILED tool=sca-agent "detail=pacote do agente corrompido"
        return 1
    fi
    mkdir -p "${dir}"
    mv "${tmp}/ci.sh" "${tmp}/LATEST_VERSION" "${tmp}/srcclr-${version}-linux.tgz" "${dir}/"
    rm -rf "${tmp}"
    seal "${dir}" ci.sh LATEST_VERSION "srcclr-${version}-linux.tgz"
    echo "$(msg success TOOL_FETCHED tool=sca-agent "url=${archive_url}")"
    out sca_fetched true
    out sca_version "${version}"
}

run_tool() {
    local need="$1" name="$2" fn="$3"
    if [ "${need}" != "true" ]; then
        out "${name}_ready" false
        out "${name}_fetched" false
        return 0
    fi
    if "${fn}"; then
        out "${name}_ready" true
    else
        out "${name}_ready" false
        out "${name}_fetched" false
    fi
}

cmd_fetch() {
    TOOLS_ROOT="${TOOLS_ROOT:?TOOLS_ROOT obrigatório}"
    if ! REAL_CURL="$(real_bin curl)"; then
        warn REAL_CURL_MISSING
        for name in pipeline cli sca; do
            out "${name}_ready" false
            out "${name}_fetched" false
        done
        return 0
    fi
    run_tool "${NEED_PIPELINE:-false}" pipeline fetch_pipeline
    run_tool "${NEED_CLI:-false}" cli fetch_cli
    run_tool "${NEED_SCA:-false}" sca fetch_sca
    rm -rf "${TOOLS_ROOT}"/.tmp.* 2>/dev/null || true
}

# ── Shims ─────────────────────────────────────────────────────────────────────
safe_path() {
    case "$1" in
        *"'"*|*$'\t'*|*$'\n'*) return 1 ;;
    esac
    return 0
}

cmd_shims() {
    local shim_dir="${SHIM_DIR:-${RUNNER_TEMP:?RUNNER_TEMP obrigatório}/veracode-connect-tool-shims}"
    local entries map_new count url
    mkdir -p "${shim_dir}"
    entries="$(mktemp)"

    if [ "${PIPELINE_READY:-false}" = "true" ] && safe_path "${PIPELINE_DIR}"; then
        printf '%s\t%s\n' "${PIPELINE_INTERCEPT_URL}" "${PIPELINE_DIR}/pipeline-scan-LATEST.zip" >> "${entries}"
    fi

    if [ "${CLI_READY:-false}" = "true" ] && safe_path "${CLI_DIR}"; then
        cat > "${shim_dir}/veracode-cli-install.sh" <<EOF
#!/bin/sh
# Gerado pelo Veracode Connect: instala a Veracode CLI ${CLI_VERSION} do cache local (sem rede).
set -e
cp -f '${CLI_DIR}/veracode' ./veracode
chmod +x ./veracode
echo "Veracode CLI ${CLI_VERSION} instalada a partir do cache do Veracode Connect."
EOF
        printf '%s\t%s\n' "${CLI_INSTALL_URL}" "${shim_dir}/veracode-cli-install.sh" >> "${entries}"
        if [ -n "${GITHUB_ENV:-}" ]; then
            echo "VERACODE_CONNECT_CLI=${CLI_DIR}/veracode" >> "${GITHUB_ENV}"
        fi
    fi

    if [ "${SCA_READY:-false}" = "true" ] && safe_path "${SCA_DIR}" && valid_sca_version "${SCA_VERSION:-}"; then
        {
            printf "CACHE_DIR='%s'\n" "${SCA_DIR}"
            printf 'export CACHE_DIR\n'
            cat "${SCA_DIR}/ci.sh"
        } > "${shim_dir}/sca-ci.sh"
        for url in ${SCA_CI_INTERCEPT_URLS}; do
            printf '%s\t%s\n' "${url}" "${shim_dir}/sca-ci.sh" >> "${entries}"
        done
        printf '%s\t%s\n' "${SCA_VERSION_INTERCEPT_URL}" "${SCA_DIR}/LATEST_VERSION" >> "${entries}"
        printf '%s\t%s\n' "${SCA_ARCHIVE_INTERCEPT_URL//\{version\}/${SCA_VERSION}}" "${SCA_DIR}/srcclr-${SCA_VERSION}-linux.tgz" >> "${entries}"
    fi

    if [ ! -s "${entries}" ] && [ ! -s "${shim_dir}/map.tsv" ]; then
        rm -f "${entries}"
        warn SHIMS_NOT_INSTALLED
        out shims_installed false
        out shim_dir ""
        return 0
    fi

    # Mescla com o map de chamadas anteriores do Connect no mesmo job (novas entradas vencem).
    map_new="$(mktemp)"
    cat "${entries}" > "${map_new}"
    if [ -f "${shim_dir}/map.tsv" ]; then
        # FILENAME (e não NR==FNR): com "entries" vazio, NR==FNR também valeria para o map antigo.
        awk -F'\t' -v fresh="${entries}" 'FILENAME == fresh { seen[$1]=1; next } !($1 in seen)' "${entries}" "${shim_dir}/map.tsv" >> "${map_new}"
    fi
    mv -f "${map_new}" "${shim_dir}/map.tsv"
    rm -f "${entries}"

    cp -f "${SCRIPT_DIR}/curl-shim.sh" "${shim_dir}/curl"
    chmod 0755 "${shim_dir}/curl"

    case ":${PATH}:" in
        *":${shim_dir}:"*) ;;
        *)
            if [ -n "${GITHUB_PATH:-}" ]; then
                echo "${shim_dir}" >> "${GITHUB_PATH}"
            fi
            ;;
    esac
    if [ -n "${GITHUB_ENV:-}" ]; then
        echo "VERACODE_CONNECT_SHIM_DIR=${shim_dir}" >> "${GITHUB_ENV}"
    fi

    count="$(wc -l < "${shim_dir}/map.tsv" | tr -d ' ')"
    echo "$(msg success SHIMS_READY "dir=${shim_dir}" "count=${count}")"
    out shims_installed true
    out shim_dir "${shim_dir}"
}

case "${1:-}" in
    fetch) cmd_fetch ;;
    shims) cmd_shims ;;
    *)
        echo "Uso: toolchain.sh <fetch|shims>" >&2
        exit 2
        ;;
esac
