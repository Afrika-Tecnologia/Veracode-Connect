const {
    ENABLE_SCA,
    SCA_TOKEN,
    ENABLE_IAC,
    ENABLE_PIPELINE,
    ENABLE_BASELINE,
    BANTUU_KEY,
    BANTUU_URL,
    ENABLE_AUTO_PACKAGER,
    SCAN_FILE,
    ENABLE_UPLOAD,
    ENABLE_BU,
    BU_NAME,
    VID,
    VKEY
} = process.env;

console.log("::group::Validar inputs condicionais");
const erros = [];

if (!VID) erros.push("veracode_api_id é obrigatório.");
if (!VKEY) erros.push("veracode_api_key é obrigatório.");
if (ENABLE_SCA === 'true' && !SCA_TOKEN) erros.push("enable_sca=true requer veracode_sca_token.");
if (ENABLE_BASELINE === 'true' && !BANTUU_KEY) erros.push("enable_baseline=true requer bantuu_api_key.");

if (ENABLE_BASELINE === 'true' && BANTUU_URL) {
    if (BANTUU_URL.endsWith('/')) erros.push(`bantuu_base_url não deve terminar com barra (/). Atual: '${BANTUU_URL}'`);
    if (!/^https?:\/\//.test(BANTUU_URL)) erros.push(`bantuu_base_url deve começar com http:// ou https://. Atual: '${BANTUU_URL}'`);
}

const needsScanFile = ['true'].includes(ENABLE_PIPELINE) || ['true'].includes(ENABLE_UPLOAD) || ['true'].includes(ENABLE_BASELINE);
if (needsScanFile && ENABLE_AUTO_PACKAGER !== 'true' && !SCAN_FILE) {
    erros.push("scan_file é obrigatório quando auto_packager está desativado e pipeline/upload/baseline estão ativos.");
}

if (ENABLE_BU === 'true') {
    if (ENABLE_UPLOAD !== 'true') erros.push("enable_business_unit=true requer enable_upload_scan=true (o vínculo depende do profile criado pelo Upload & Scan).");
    if (!BU_NAME) erros.push("enable_business_unit=true requer veracode_business_unit (nome da BU).");
    if (BU_NAME?.includes(',')) erros.push("veracode_business_unit não pode conter vírgula (Veracode permite apenas uma BU por aplicação).");
}

if (erros.length > 0) {
    console.log("\n============================================");
    console.log("  VALIDAÇÃO DE INPUTS FALHOU");
    console.log("============================================");
    for (const e of erros) {
        console.log(`::error::${e}`);
    }
    console.log("============================================");
    console.log("::endgroup::");
    process.exit(1);
}

console.log("Todos os inputs validados com sucesso.");
console.log("::endgroup::");
