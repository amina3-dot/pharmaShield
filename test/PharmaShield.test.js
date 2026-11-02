const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PharmaShield", () => {
  let c, mfr, dist, rogue;
  const id = ethers.id;
  beforeEach(async () => {
    [, mfr, dist, rogue] = await ethers.getSigners();
    c = await ethers.deployContract("PharmaShield");
    await c.grantRole(await c.MANUFACTURER(), mfr.address);
    await c.grantRole(await c.DISTRIBUTOR(), dist.address);
    await c.connect(mfr).registerBatch(id("B1"), id("cert"));
    await c.connect(mfr).registerPackage(id("P1"), id("B1"), id("meta"));
  });
  it("rejects duplicate package IDs", async () => {
    await expect(c.connect(mfr).registerPackage(id("P1"), id("B1"), id("m"))).to.be.revertedWith("R1: duplicate package id");
  });
  it("blocks registration by accounts without the role", async () => {
    await expect(c.connect(rogue).registerBatch(id("B2"), id("c"))).to.be.reverted;
  });
  it("needs two-step transfer", async () => {
    await c.connect(mfr).transferPackage(id("P1"), dist.address);
    await expect(c.connect(rogue).acceptPackage(id("P1"))).to.be.revertedWith("R2: not intended recipient");
    await c.connect(dist).acceptPackage(id("P1"));
    expect((await c.verifyPackage(id("P1")))[1]).to.equal(dist.address);
  });
  it("recall overrides status", async () => {
    await c.grantRole(await c.RECALL_ADMIN(), mfr.address);
    await c.connect(mfr).recallBatch(id("B1"));
    expect((await c.verifyPackage(id("P1")))[0]).to.equal(5);
  });
});
