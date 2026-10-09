const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const H1 = ethers.keccak256(ethers.toUtf8Bytes("head-1"));
const H2 = ethers.keccak256(ethers.toUtf8Bytes("head-2"));

describe("AuditAnchor", function () {
  async function deploy() {
    const [owner, other] = await ethers.getSigners();
    const anchor = await ethers.deployContract("AuditAnchor");
    return { anchor, owner, other };
  }

  it("sets the deployer as owner", async function () {
    const { anchor, owner } = await loadFixture(deploy);
    expect(await anchor.owner()).to.equal(owner.address);
    expect(await anchor.anchorCount()).to.equal(0n);
  });

  it("stores anchors and emits Anchored", async function () {
    const { anchor } = await loadFixture(deploy);
    await expect(anchor.anchor(H1, 10)).to.emit(anchor, "Anchored").withArgs(0, H1, 10, (t) => t > 0n);
    await anchor.anchor(H2, 25);
    expect(await anchor.anchorCount()).to.equal(2n);
    const [hash, entryId, at] = await anchor.getAnchor(1);
    expect(hash).to.equal(H2);
    expect(entryId).to.equal(25n);
    expect(at).to.be.greaterThan(0n);
  });

  it("only the owner can anchor", async function () {
    const { anchor, other } = await loadFixture(deploy);
    await expect(anchor.connect(other).anchor(H1, 1)).to.be.revertedWithCustomError(anchor, "NotOwner");
  });

  it("rejects a zero hash", async function () {
    const { anchor } = await loadFixture(deploy);
    await expect(anchor.anchor(ethers.ZeroHash, 1)).to.be.revertedWithCustomError(anchor, "ZeroHash");
  });

  it("requires strictly increasing audit entry ids", async function () {
    const { anchor } = await loadFixture(deploy);
    await anchor.anchor(H1, 10);
    await expect(anchor.anchor(H2, 10))
      .to.be.revertedWithCustomError(anchor, "NotIncreasing")
      .withArgs(10, 10);
    await expect(anchor.anchor(H2, 9)).to.be.revertedWithCustomError(anchor, "NotIncreasing");
  });

  it("reverts on a missing index", async function () {
    const { anchor } = await loadFixture(deploy);
    await expect(anchor.getAnchor(0)).to.be.revertedWithCustomError(anchor, "NoSuchAnchor").withArgs(0);
  });

  it("transfers ownership, and the old owner loses access", async function () {
    const { anchor, owner, other } = await loadFixture(deploy);
    await expect(anchor.transferOwnership(other.address))
      .to.emit(anchor, "OwnershipTransferred")
      .withArgs(owner.address, other.address);
    await expect(anchor.anchor(H1, 1)).to.be.revertedWithCustomError(anchor, "NotOwner");
    await anchor.connect(other).anchor(H1, 1);
    await expect(anchor.connect(other).transferOwnership(ethers.ZeroAddress)).to.be.revertedWithCustomError(
      anchor,
      "ZeroAddress",
    );
  });
});
