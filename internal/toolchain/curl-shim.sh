#!/usr/bin/env bash
# veracode-connect-shim
#
# Shim de curl do Veracode Connect.
#
# As actions oficiais da Veracode baixam suas ferramentas a cada execução
# (pipeline-scan-LATEST.zip a cada slot, instalador da CLI, ci.sh e agente SCA).
# Este shim fica na frente do PATH e:
#   - serve do cache local as URLs listadas em map.tsv (mesmo diretório do shim);
#   - delega todo o resto ao PRÓXIMO curl do PATH, depois da última ocorrência
#     do próprio diretório (encadeia com outros shims sem risco de loop).
#
# Formato de map.tsv: <url-sem-query><TAB><arquivo-local>
set -uo pipefail

SHIM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAP="${SHIM_DIR}/map.tsv"
LOG="${SHIM_DIR}/served.log"

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
    return 1
}

delegate() {
    local next
    if ! next="$(next_bin curl "${SHIM_DIR}")"; then
        echo "veracode-connect: nenhum curl real encontrado no PATH após ${SHIM_DIR}." >&2
        exit 127
    fi
    exec "${next}" "$@"
}

lookup() {
    local wanted="$1" key file
    [ -f "${MAP}" ] || return 1
    while IFS=$'\t' read -r key file || [ -n "${key:-}" ]; do
        if [ "${key}" = "${wanted}" ] && [ -n "${file:-}" ] && [ -f "${file}" ]; then
            printf '%s\n' "${file}"
            return 0
        fi
    done < "${MAP}"
    return 1
}

out_file=""
remote_name=0
head_only=0
url=""
local_file=""
url_count=0

args=("$@")
n=${#args[@]}
i=0
while [ "${i}" -lt "${n}" ]; do
    a="${args[$i]}"
    case "${a}" in
        --output)
            i=$((i + 1))
            out_file="${args[$i]:-}"
            ;;
        --output=*)
            out_file="${a#--output=}"
            ;;
        --remote-name)
            remote_name=1
            ;;
        --head)
            head_only=1
            ;;
        --*|-)
            ;;
        -*)
            cluster="${a#-}"
            j=0
            while [ "${j}" -lt "${#cluster}" ]; do
                c="${cluster:$j:1}"
                rest="${cluster:$((j + 1))}"
                case "${c}" in
                    o)
                        if [ -n "${rest}" ]; then
                            out_file="${rest}"
                        else
                            i=$((i + 1))
                            out_file="${args[$i]:-}"
                        fi
                        break
                        ;;
                    O) remote_name=1 ;;
                    I) head_only=1 ;;
                    [AbcCdDeEFHKmPQrtTuUwxXyYz])
                        # Opção curta que recebe valor: o resto do cluster (ou o próximo argumento) é o valor.
                        if [ -z "${rest}" ]; then
                            i=$((i + 1))
                        fi
                        break
                        ;;
                esac
                j=$((j + 1))
            done
            ;;
        http://*|https://*)
            url_count=$((url_count + 1))
            if [ -z "${local_file}" ]; then
                candidate="${a%%\?*}"
                if found="$(lookup "${candidate}")"; then
                    local_file="${found}"
                    url="${candidate}"
                fi
            fi
            ;;
    esac
    i=$((i + 1))
done

if [ -z "${local_file}" ] || [ "${url_count}" -ne 1 ] || [ "${head_only}" -eq 1 ]; then
    delegate "$@"
fi

if [ -n "${out_file}" ] && [ "${out_file}" != "-" ]; then
    cp -f "${local_file}" "${out_file}" || delegate "$@"
elif [ -z "${out_file}" ] && [ "${remote_name}" -eq 1 ]; then
    cp -f "${local_file}" "./${url##*/}" || delegate "$@"
else
    cat "${local_file}" || exit 23
fi

printf '%s\t%s\n' "${url}" "${local_file}" >> "${LOG}" 2>/dev/null || true
# Silencioso por padrão: a veracode/veracode-sca publica todo stderr do ci.sh como erro no job.
if [ "${VERACODE_CONNECT_SHIM_VERBOSE:-0}" = "1" ]; then
    echo "veracode-connect: ${url} servido do cache local (sem rede)" >&2
fi
exit 0
