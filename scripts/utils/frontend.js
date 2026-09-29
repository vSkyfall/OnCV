const fs = require("fs");
const path = require("path");

const CONFIG_DIR = path.join(__dirname, "..", "..", "config");

/** Writes config/abi.ts from the compiled artifacts so the frontend is always typed against the real ABIs. */
async function writeAbi(hre) {
  const [proofSkill, registry, credential] = await Promise.all([
    hre.artifacts.readArtifact("ProofSkill"),
    hre.artifacts.readArtifact("ProjectRegistry"),
    hre.artifacts.readArtifact("OnCVCredential"),
  ]);
  const content =
    "// Auto-generated from artifacts/contracts - do not edit by hand.\n" +
    "// Regenerate with `npm run contracts:abi` (also runs automatically on deploy).\n\n" +
    `export const proofSkillAbi = ${JSON.stringify(proofSkill.abi, null, 2)} as const;\n\n` +
    `export const projectRegistryAbi = ${JSON.stringify(registry.abi, null, 2)} as const;\n\n` +
    `export const credentialAbi = ${JSON.stringify(credential.abi, null, 2)} as const;\n`;
  const target = path.join(CONFIG_DIR, "abi.ts");
  fs.writeFileSync(target, content);
  return target;
}

/** Writes config/deployment.json, which the frontend reads when the NEXT_PUBLIC_* addresses are not set. */
function writeDeployment(deployment) {
  const target = path.join(CONFIG_DIR, "deployment.json");
  fs.writeFileSync(target, `${JSON.stringify(deployment, null, 2)}\n`);
  return target;
}

module.exports = { writeAbi, writeDeployment };
