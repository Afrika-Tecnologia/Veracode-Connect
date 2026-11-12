# Downloads, cache e Maven Central

As actions oficiais da Veracode baixam suas ferramentas a cada execução: o `pipeline-scan-LATEST.zip` (≈8 MB) em **cada** slot do Pipeline Scan (até 12 por run, com retries), a Veracode CLI (≈64 MB) no IaC e no Auto Packager, e o agente SCA (≈140 MB). O SCA e o Auto Packager também rodam o Maven/Gradle do projeto, que baixa todas as dependências do Maven Central em runners limpos.

Com `enable_tools_cache: 'true'` (padrão, runners Linux), a action:

1. Calcula quais ferramentas a execução usa e restaura cada uma do `actions/cache` (chave por versão/janela).
2. Baixa **uma única vez** o que faltar, verifica a integridade (sha256 pinado em [`internal/toolchain/tools.json`](../internal/toolchain/tools.json) para a CLI; zip/tgz válidos para Pipeline Scan e agente SCA) e salva no cache logo em seguida, mesmo que a esteira seja bloqueada depois.
3. Coloca um shim de `curl` na frente do `PATH`. Ele responde do disco local apenas as URLs de download dessas ferramentas e repassa qualquer outra chamada ao `curl` real. As actions oficiais continuam inalteradas e pinadas.

| Ferramenta | Antes (por execução) | Com cache aquecido |
| --- | --- | --- |
| `pipeline-scan-LATEST.zip` | 1 por slot (até 12) | 0 |
| Veracode CLI | até 2 (IaC + Auto Packager) | 0 |
| Agente SCA (`ci.sh`, `LATEST_VERSION`, `.tgz`) | 3 | 0 |
| Wrapper Java do Upload & Scan (Maven Central) | 0 (vendorizado) | 0 |
| Dependências Maven/Gradle | 1 resolução completa por SCA/Auto Packager | só artefatos novos |

A CLI segue a versão pinada (`2.54.1`), a mesma usada pelo IaC e pelo Auto Packager. O Pipeline Scan e o agente SCA só são publicados como `LATEST`, então são renovados por janela em `tools_cache_refresh` (`weekly` por padrão). As ferramentas ficam em `$RUNNER_TEMP`, nunca no workspace, e o cache do `actions/cache` é isolado por repositório. Se algo falhar (download, verificação, runner Windows/macOS/ARM ou Alpine), a ferramenta afetada não entra no cache e a action oficial baixa normalmente, como antes.

Com `cache_dependencies: 'true'` (padrão) e SCA ou Auto Packager ativos, `~/.m2/repository`, `~/.m2/wrapper`, `~/.gradle/caches` e `~/.gradle/wrapper` são restaurados antes do SCA e salvos depois do Upload & Scan. A chave usa o hash de `pom.xml`, `build.gradle(.kts)`, `settings.gradle(.kts)`, `libs.versions.toml`, `gradle.lockfile` e dos `*-wrapper.properties`; sem esses arquivos o cache não é usado. Se o workflow já faz cache do Maven/Gradle (por exemplo, `actions/setup-java` com `cache: maven`), use `cache_dependencies: 'false'` para não duplicar.

Para não usar o Maven Central, informe `maven_mirror_url` (Nexus/Artifactory, `https`). A action cria um `~/.m2/settings.xml` temporário com `<mirrorOf>central</mirrorOf>` (ou o valor de `maven_mirror_of`, por exemplo `*`) e o remove ao final. Um `settings.xml` existente nunca é sobrescrito. Credenciais opcionais: `maven_mirror_username` e `maven_mirror_password` (use secrets). Para Gradle, configure o mirror no próprio projeto (`settings.gradle`/`init.gradle`).

Para não depender da CDN da Veracode, publique as ferramentas em um mirror `https` próprio e informe a URL base em `tools_mirror_url`:

```text
<tools_mirror_url>/veracode-cli/veracode-cli_<versão>_linux_x86.tar.gz
<tools_mirror_url>/securityscan/pipeline-scan-LATEST.zip
<tools_mirror_url>/sca/ci.sh
<tools_mirror_url>/sca/LATEST_VERSION
<tools_mirror_url>/sca/srcclr-<versão>-linux.tgz
```

O mirror precisa aceitar leitura anônima. O sha256 pinado da CLI continua sendo verificado.

```yaml
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
- uses: Afrika-Tecnologia/Veracode-Connect@v1.9.0
  with:
    veracode_api_id: ${{ secrets.VERACODE_API_ID }}
    veracode_api_key: ${{ secrets.VERACODE_API_KEY }}
    enable_sca: 'true'
    veracode_sca_token: ${{ secrets.VERACODE_SCA_TOKEN }}
    enable_auto_packager: 'true'
    maven_mirror_url: https://nexus.example.com/repository/maven-public/
    maven_mirror_username: ${{ secrets.NEXUS_USER }}
    maven_mirror_password: ${{ secrets.NEXUS_TOKEN }}
```

Para atualizar a CLI, troque `version` e os dois sha256 em `internal/toolchain/tools.json` e o default de `cli_version` em `internal/auto-packager/action.yml`; o teste `wiring.test.js` falha se divergirem.
