# Java API wrapper (Upload & Scan)

Jar pinado do Maven Central: `com.veracode.vosp.api.wrappers:vosp-api-wrappers-java`.

O Connect usa este arquivo local (via shims `curl`/`wget`) para a `veracode/uploadandscan-action` **não** consultar `repo1.maven.org` em runtime.

## Atualizar (manual)

1. Consulte a versao em https://repo1.maven.org/maven2/com/veracode/vosp/api/wrappers/vosp-api-wrappers-java/maven-metadata.xml (`<latest>`).
2. Baixe o jar:
   ```bash
   VER=26.x.x.x
   curl -fsSL -o "vosp-api-wrappers-java-${VER}.jar" \
     "https://repo1.maven.org/maven2/com/veracode/vosp/api/wrappers/vosp-api-wrappers-java/${VER}/vosp-api-wrappers-java-${VER}.jar"
   ```
3. Substitua o `.jar` antigo nesta pasta, atualize `VERSION` com a mesma string `${VER}` e remova o jar da versao anterior.
4. Abra PR / release e valide um Upload & Scan real (sandbox + policy).
