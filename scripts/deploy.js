const hre = require("hardhat");
const fs = require("fs");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const c = await hre.ethers.deployContract("PharmaShield");
  await c.waitForDeployment();
  const address = await c.getAddress();
  const block = (await c.deploymentTransaction().wait()).blockNumber;

  // Demo setup: the deployer wallet receives every role so one wallet can try the whole flow.
  for (const role of ["MANUFACTURER", "DISTRIBUTOR", "PHARMACY", "RECALL_ADMIN"]) {
    await (await c.grantRole(await c[role](), deployer.address)).wait();
  }
  console.log("PharmaShield deployed to:", address, "| block:", block);

  fs.writeFileSync(
    "frontend/config.js",
    `window.PHARMA_CONFIG = { address: "${address}", chainId: 11155111, deployBlock: ${block} };\n`
  );
  console.log("frontend/config.js updated");
}
main().catch((e) => { console.error(e); process.exit(1); });
