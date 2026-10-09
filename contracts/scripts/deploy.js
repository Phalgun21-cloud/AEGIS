// Deploys AuditAnchor and writes:
//   contracts/deployments/<network>.json   address, chain id, deployer, block
//   backend/app/services/abi/AuditAnchor.json   ABI used by the backend (Web3.py)
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const { ethers, network, artifacts } = hre;
  if (network.name === "mainnet") throw new Error("AEGIS anchoring is testnet-only.");

  const [deployer] = await ethers.getSigners();
  const contract = await ethers.deployContract("AuditAnchor");
  await contract.waitForDeployment();
  const receipt = await contract.deploymentTransaction().wait();
  const { chainId } = await ethers.provider.getNetwork();

  const info = {
    network: network.name,
    chainId: Number(chainId),
    address: await contract.getAddress(),
    deployer: deployer.address,
    blockNumber: receipt.blockNumber,
    txHash: receipt.hash,
    deployedAt: new Date().toISOString(),
  };
  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${network.name}.json`), JSON.stringify(info, null, 2) + "\n");

  const abiDir = path.join(__dirname, "..", "..", "backend", "app", "services", "abi");
  fs.mkdirSync(abiDir, { recursive: true });
  const { abi } = await artifacts.readArtifact("AuditAnchor");
  fs.writeFileSync(path.join(abiDir, "AuditAnchor.json"), JSON.stringify(abi, null, 2) + "\n");

  console.log(`AuditAnchor deployed to ${info.address} on ${network.name} (chain ${info.chainId})`);
  console.log("Set these in backend/.env:");
  console.log(`  ANCHOR_CONTRACT_ADDRESS=${info.address}`);
  console.log(`  ANCHOR_CHAIN_ID=${info.chainId}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
