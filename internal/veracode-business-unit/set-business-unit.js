const crypto = require("crypto");
const https = require("https");

function logGroupStart(name) {
  process.stdout.write(`::group::${name}\n`);
}

function logGroupEnd() {
  process.stdout.write("::endgroup::\n");
}

function warning(message) {
  process.stdout.write(`::warning::${message}\n`);
}

function setOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) return;
  require("fs").appendFileSync(outputFile, `${name}=${value}\n`);
}

function normalizeSpaces(value) {
  return value.replace(/\s+/g, " ").trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hmacSha256(data, key) {
  return crypto.createHmac("sha256", key).update(data).digest();
}

function buildVeracodeAuthHeader({ apiId, apiKeyHex, host, urlPathWithQuery, method }) {
  const requestVersion = "vcode_request_version_1";

  const nonceBytes = crypto.randomBytes(16);
  const nonceHex = nonceBytes.toString("hex").toUpperCase();
  const ts = Date.now().toString();

  const data = `id=${apiId}&host=${host}&url=${urlPathWithQuery}&method=${method.toUpperCase()}`;
  const dataBytes = Buffer.from(data, "utf8");
  const tsBytes = Buffer.from(ts, "utf8");
  const apiKeyBytes = Buffer.from(apiKeyHex, "hex");
  const requestVersionBytes = Buffer.from(requestVersion, "utf8");

  const kNonce = hmacSha256(nonceBytes, apiKeyBytes);
  const kDate = hmacSha256(tsBytes, kNonce);
  const kSignature = hmacSha256(requestVersionBytes, kDate);
  const signatureBytes = hmacSha256(dataBytes, kSignature);
  const sigHex = signatureBytes.toString("hex").toUpperCase();

  return `VERACODE-HMAC-SHA-256 id=${apiId},ts=${ts},nonce=${nonceHex},sig=${sigHex}`;
}

async function requestVeracodeJson({
  apiId,
  apiKeyHex,
  host,
  method,
  path,
  body,
  extraHeaders,
  maxAttempts = 5,
}) {
  const urlPathWithQuery = path;
  const headers = {
    "User-Agent": "Veracode Integration Helper - Veracode BU Linker",
    Accept: "application/json",
    ...extraHeaders,
  };

  let payload = undefined;
  if (body !== undefined && body !== null) {
    payload = Buffer.from(JSON.stringify(body), "utf8");
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = String(payload.length);
  }

  headers.Authorization = buildVeracodeAuthHeader({
    apiId,
    apiKeyHex,
    host,
    urlPathWithQuery,
    method,
  });

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await new Promise((resolve, reject) => {
      const req = https.request(
        {
          host,
          method,
          path: urlPathWithQuery,
          headers,
        },
        (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            const rawBody = Buffer.concat(chunks).toString("utf8");
            resolve({
              statusCode: res.statusCode || 0,
              headers: res.headers || {},
              rawBody,
            });
          });
        },
      );

      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });

    const statusCode = response.statusCode;
    const isRetryable = statusCode === 429 || (statusCode >= 500 && statusCode <= 599);

    if (!isRetryable) {
      if (statusCode >= 200 && statusCode <= 299) {
        const contentType = String(response.headers["content-type"] || "");
        if (contentType.includes("application/json")) {
          return JSON.parse(response.rawBody || "{}");
        }
        if (!response.rawBody) return {};
        try {
          return JSON.parse(response.rawBody);
        } catch {
          return { raw: response.rawBody };
        }
      }

      const safeBody = response.rawBody ? response.rawBody.slice(0, 2000) : "";
      throw new Error(`HTTP ${statusCode} em ${method} ${path}. Body (trunc): ${safeBody}`);
    }

    if (attempt === maxAttempts) {
      throw new Error(`HTTP ${statusCode} (retry esgotado) em ${method} ${path}`);
    }

    const backoffMs = Math.min(30000, 1000 * Math.pow(2, attempt - 1));
    await sleep(backoffMs);
  }

  throw new Error("Erro inesperado: loop de retry finalizado.");
}

function getEmbeddedList(json, embeddedKey) {
  if (!json || typeof json !== "object") return [];
  const embedded = json._embedded;
  if (!embedded || typeof embedded !== "object") return [];
  const list = embedded[embeddedKey];
  return Array.isArray(list) ? list : [];
}

function getNextHref(json) {
  const links = json && json._links;
  const next = links && links.next;
  const href = next && next.href;
  return typeof href === "string" ? href : null;
}

async function findAppGuidByName({ apiId, apiKeyHex, host, appName }) {
  const desired = appName.toLowerCase();
  const initialPath = `/appsec/v1/applications?name=${encodeURIComponent(appName)}&size=100`;

  let path = initialPath;
  for (let page = 0; page < 50; page += 1) {
    const json = await requestVeracodeJson({ apiId, apiKeyHex, host, method: "GET", path });
    const apps = getEmbeddedList(json, "applications");
    for (const app of apps) {
      const name = app?.profile?.name;
      if (typeof name === "string" && name.toLowerCase() === desired) {
        const guid = app?.guid;
        if (typeof guid === "string" && guid.length > 0) return guid;
      }
    }

    const nextHref = getNextHref(json);
    if (!nextHref) break;
    const nextUrl = new URL(nextHref);
    path = `${nextUrl.pathname}${nextUrl.search}`;
  }

  return null;
}

async function findBusinessUnitGuidByName({ apiId, apiKeyHex, host, buName }) {
  const desired = buName.toLowerCase();
  const candidates = [
    `/api/authn/v2/business_units?name=${encodeURIComponent(buName)}&size=100`,
    `/api/authn/v2/business_units?size=100`,
  ];

  for (const initialPath of candidates) {
    let path = initialPath;
    for (let page = 0; page < 200; page += 1) {
      const json = await requestVeracodeJson({ apiId, apiKeyHex, host, method: "GET", path });
      const bus = getEmbeddedList(json, "business_units");
      for (const bu of bus) {
        const name = bu?.name;
        if (typeof name === "string" && name.toLowerCase() === desired) {
          const guid = bu?.guid;
          if (typeof guid === "string" && guid.length > 0) return guid;
        }
      }

      const nextHref = getNextHref(json);
      if (!nextHref) break;
      const nextUrl = new URL(nextHref);
      path = `${nextUrl.pathname}${nextUrl.search}`;
    }
  }

  return null;
}

async function main() {
  const enable =
    (process.env.ENABLE_BUSINESS_UNIT || "false").toLowerCase() === "true" ||
    (process.env.ENABLE_SET_BUSINESS_UNIT || "false").toLowerCase() === "true";

  const rawBusinessUnit = process.env.VERACODE_BUSINESS_UNIT || "";

  const apiId = process.env.VERACODE_API_ID || "";
  const apiKeyHex = process.env.VERACODE_API_KEY || "";
  const host = process.env.VERACODE_API_HOST || "api.veracode.com";
  const appName = process.env.VERACODE_APP_NAME || "";

  const uploadEnabled = (process.env.ENABLE_UPLOAD_SCAN || "false").toLowerCase() === "true";
  const uploadOutcome = process.env.UPLOAD_AND_SCAN_OUTCOME || "skipped";

  setOutput("set_business_unit_status", "skipped");
  setOutput("business_unit_name", "");
  setOutput("business_unit_guid", "");

  if (!enable) {
    return;
  }

  logGroupStart("Veracode Business Unit (REST)");

  const businessUnit = normalizeSpaces(rawBusinessUnit || "");

  if (!businessUnit) {
    warning("enable_Business_unit=true, mas veracode_business_unit esta vazio. Pulando.");
    logGroupEnd();
    return;
  }

  if (!apiId || !apiKeyHex) {
    logGroupEnd();
    throw new Error("veracode_api_id/veracode_api_key nao foram fornecidos (necessarios para REST).");
  }
  if (!/^[0-9a-fA-F]+$/.test(apiKeyHex) || apiKeyHex.length % 2 !== 0) {
    logGroupEnd();
    throw new Error("veracode_api_key deve ser uma string hexadecimal valida (VKEY).");
  }

  if (!appName) {
    logGroupEnd();
    throw new Error("ERRO: app name vazio (VERACODE_APP_NAME).");
  }

  if (!uploadEnabled) {
    logGroupEnd();
    throw new Error(
      "enable_Business_unit=true exige enable_upload_scan=true, pois o vinculo deve rodar somente apos o Upload & Scan (createprofile=true).",
    );
  }

  if (uploadOutcome !== "success") {
    logGroupEnd();
    throw new Error(
      `Upload & Scan esta habilitado, mas nao concluiu com sucesso (outcome=${uploadOutcome}). Nao e seguro aplicar Business Unit.`,
    );
  }

  if (businessUnit.includes(",")) {
    setOutput("set_business_unit_status", "failed");
    logGroupEnd();
    throw new Error("Veracode permite apenas uma Business Unit por aplicacao. Informe apenas uma BU.");
  }

  if (businessUnit.length === 0) {
    warning("Nenhuma Business Unit valida foi encontrada apos normalizacao. Pulando.");
    logGroupEnd();
    return;
  }

  setOutput("business_unit_name", businessUnit);

  process.stdout.write(`Setting Business Unit '${businessUnit}' for application '${appName}'\n`);
  process.stdout.write(`Host: ${host}\n`);

  const buGuid = await findBusinessUnitGuidByName({ apiId, apiKeyHex, host, buName: businessUnit });
  if (!buGuid) {
    setOutput("set_business_unit_status", "failed");
    logGroupEnd();
    throw new Error(`BU '${businessUnit}' nao existe ou nao foi localizada via Identity API.`);
  }
  setOutput("business_unit_guid", buGuid);
  process.stdout.write(`Business Unit GUID resolved: ${buGuid}\n`);

  const appGuid = await findAppGuidByName({ apiId, apiKeyHex, host, appName });
  if (!appGuid) {
    setOutput("set_business_unit_status", "failed");
    logGroupEnd();
    throw new Error(
      `Aplicacao '${appName}' nao foi localizada via Applications API. Verifique se o Upload & Scan criou o profile (createprofile=true) e se o nome confere.`,
    );
  }
  process.stdout.write(`App GUID: ${appGuid}\n`);

  const app = await requestVeracodeJson({
    apiId,
    apiKeyHex,
    host,
    method: "GET",
    path: `/appsec/v1/applications/${encodeURIComponent(appGuid)}`,
  });

  if (!app || typeof app !== "object") {
    setOutput("set_business_unit_status", "failed");
    logGroupEnd();
    throw new Error("Falha ao obter o application profile completo (GET).");
  }

  if (!app.profile || typeof app.profile !== "object") {
    app.profile = {};
  }
  if (!app.profile.business_unit || typeof app.profile.business_unit !== "object") {
    app.profile.business_unit = {};
  }

  const updatedApp = JSON.parse(JSON.stringify(app));
  if (updatedApp && typeof updatedApp === "object") {
    delete updatedApp._links;
  }
  if (!updatedApp.profile || typeof updatedApp.profile !== "object") {
    updatedApp.profile = {};
  }
  if (!updatedApp.profile.business_unit || typeof updatedApp.profile.business_unit !== "object") {
    updatedApp.profile.business_unit = {};
  }
  updatedApp.profile.business_unit.guid = buGuid;

  await requestVeracodeJson({
    apiId,
    apiKeyHex,
    host,
    method: "PUT",
    path: `/appsec/v1/applications/${encodeURIComponent(appGuid)}`,
    body: updatedApp,
  });

  setOutput("set_business_unit_status", "success");
  process.stdout.write("Application profile updated successfully\n");
  logGroupEnd();
}

main().catch((err) => {
  if (process.env.GITHUB_OUTPUT) {
    setOutput("set_business_unit_status", "failed");
  }
  process.stderr.write(`${err?.message || String(err)}\n`);
  process.exit(1);
});
