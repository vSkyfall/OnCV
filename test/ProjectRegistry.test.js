const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { eventInput, deploySystem, checkIn } = require("./helpers");

const INTERVAL = 90n * 24n * 3600n; // production checkpoint spacing (90 days)
const HOUR = 3600;
const Stage = { Registered: 0, StillActive: 1, FirstCustomer: 2, Funded: 3, ShutDown: 4 };
const Checkpoint = { Upcoming: 0, Open: 1, Completed: 2, Missed: 3 };
const PROJECT_OFFSET = 1n << 128n;

function decodeDataUri(uri, prefix) {
  expect(uri.startsWith(prefix)).to.equal(true);
  return Buffer.from(uri.slice(prefix.length), "base64").toString("utf8");
}

describe("ProjectRegistry + OnCVCredential", function () {
  async function deployFixture() {
    const sys = await deploySystem({ interval: INTERVAL });
    const [admin, organizer, alice, bob, carol, dave, eve, frank, investor, outsider] = sys.signers;
    const { proofSkill, registry, token } = sys;

    // The hackathon is run by a verified partner organizer, not the admin, so attester rules are meaningful.
    await proofSkill.addOrganizer(organizer.address, "Blockchain ITU", "blockchainitu.com");
    await proofSkill
      .connect(organizer)
      .createEvent(
        eventInput({
          name: 'Avalanche "Build" <Hackathon> & Demo Day',
          durationHours: 24,
          lat: 41_000_000,
          long: 29_000_000,
          category: 1,
          skillTags: "Solidity",
          checkInSigner: sys.qrSigner.address,
        }),
      );
    for (const s of [alice, bob, carol, dave, eve, frank]) await checkIn(sys, s, 1n);
    await registry.addInvestor(investor.address, "Avalanche Ventures", "https://example.org");

    const input = (overrides = {}) => ({
      eventId: 1n,
      title: "FraudShield",
      pitch: "Detects fake check-ins with on-device ML.",
      url: "https://github.com/oncv/fraudshield",
      invitees: [],
      ...overrides,
    });

    return { ...sys, proofSkill, registry, token, admin, organizer, alice, bob, carol, dave, eve, frank, investor, outsider, input };
  }

  /** alice owns project 1 with bob as an accepted member. */
  async function teamFixture() {
    const ctx = await deployFixture();
    await ctx.registry.connect(ctx.alice).registerProject(ctx.input({ invitees: [ctx.bob.address] }));
    await ctx.registry.connect(ctx.bob).acceptInvite(1n);
    return { ...ctx, projectId: 1n };
  }

  const score = (ctx, signer) => ctx.proofSkill.getUserProofScore(signer.address);

  describe("registration and invites (L1)", function () {
    it("registers the owner only; invitees join by accepting and then receive the credential", async function () {
      const { registry, token, alice, bob, input } = await loadFixture(deployFixture);
      await expect(registry.connect(alice).registerProject(input({ invitees: [bob.address] })))
        .to.emit(registry, "ProjectRegistered")
        .withArgs(1n, 1n, alice.address)
        .and.to.emit(registry, "MemberInvited")
        .withArgs(1n, bob.address);

      let p = await registry.getProject(1n);
      expect(p.owner).to.equal(alice.address);
      expect(p.team).to.deep.equal([alice.address]);
      expect(p.pendingInvites).to.deep.equal([bob.address]);
      expect(await registry.getInvites(bob.address)).to.deep.equal([1n]);
      expect(await registry.isMember(1n, bob.address)).to.equal(false);
      expect(await token.balanceOf(alice.address, PROJECT_OFFSET + 1n)).to.equal(1n);
      expect(await token.balanceOf(bob.address, PROJECT_OFFSET + 1n)).to.equal(0n);

      await expect(registry.connect(bob).acceptInvite(1n))
        .to.emit(registry, "InviteResolved")
        .withArgs(1n, bob.address, true)
        .and.to.emit(registry, "MemberJoined")
        .withArgs(1n, bob.address);
      p = await registry.getProject(1n);
      expect(p.team).to.deep.equal([alice.address, bob.address]);
      expect(p.pendingInvites).to.deep.equal([]);
      expect(await registry.getInvites(bob.address)).to.deep.equal([]);
      expect(await registry.getMemberProjects(bob.address)).to.deep.equal([1n]);
      expect(await registry.getEventProjects(1n)).to.deep.equal([1n]);
      expect(await token.balanceOf(bob.address, PROJECT_OFFSET + 1n)).to.equal(1n);
    });

    it("cannot lock someone into a team: an invitee can register elsewhere, decline or be cancelled", async function () {
      const { registry, alice, bob, carol, dave, input } = await loadFixture(deployFixture);
      await registry.connect(alice).registerProject(input({ invitees: [bob.address, carol.address, dave.address] }));

      // bob starts his own project while invited; the old invite can no longer be accepted.
      await registry.connect(bob).registerProject(input({ title: "Bob's" }));
      await expect(registry.connect(bob).acceptInvite(1n)).to.be.revertedWithCustomError(registry, "AlreadyInProject").withArgs(bob.address);

      await expect(registry.connect(carol).declineInvite(1n)).to.emit(registry, "InviteResolved").withArgs(1n, carol.address, false);
      await expect(registry.connect(carol).acceptInvite(1n)).to.be.revertedWithCustomError(registry, "NotInvited");

      await expect(registry.connect(bob).cancelInvite(1n, dave.address)).to.be.revertedWithCustomError(registry, "NotProjectOwner");
      await registry.connect(alice).cancelInvite(1n, dave.address);
      await expect(registry.connect(dave).acceptInvite(1n)).to.be.revertedWithCustomError(registry, "NotInvited");
      await expect(registry.connect(dave).declineInvite(1n)).to.be.revertedWithCustomError(registry, "NotInvited");
      expect((await registry.getProject(1n)).pendingInvites).to.deep.equal([bob.address]);
    });

    it("rejects non-attendees, revoked attendees, bad invitees and double membership", async function () {
      const { registry, proofSkill, organizer, alice, bob, carol, outsider, input } = await loadFixture(deployFixture);
      await expect(registry.connect(outsider).registerProject(input())).to.be.revertedWithCustomError(registry, "NotAttendee");
      await expect(registry.connect(alice).registerProject(input({ invitees: [outsider.address] })))
        .to.be.revertedWithCustomError(registry, "InviteeNotAttendee")
        .withArgs(outsider.address);
      await expect(registry.connect(alice).registerProject(input({ invitees: [alice.address] }))).to.be.revertedWithCustomError(
        registry,
        "InvalidInput",
      );
      await expect(registry.connect(alice).registerProject(input({ invitees: [bob.address, bob.address] })))
        .to.be.revertedWithCustomError(registry, "AlreadyInvited")
        .withArgs(bob.address);

      await proofSkill.connect(organizer).revokeCredential(carol.address, 1n, "No-show");
      await expect(registry.connect(carol).registerProject(input())).to.be.revertedWithCustomError(registry, "NotAttendee");

      await registry.connect(alice).registerProject(input({ invitees: [bob.address] }));
      await expect(registry.connect(alice).registerProject(input()))
        .to.be.revertedWithCustomError(registry, "AlreadyInProject")
        .withArgs(alice.address);
      await registry.connect(bob).acceptInvite(1n);
      await expect(registry.connect(alice).inviteMember(1n, bob.address))
        .to.be.revertedWithCustomError(registry, "AlreadyInProject")
        .withArgs(bob.address);
    });

    it("caps team + pending invites at five", async function () {
      const { registry, alice, bob, carol, dave, eve, frank, input } = await loadFixture(deployFixture);
      const five = [bob, carol, dave, eve, frank].map((s) => s.address);
      await expect(registry.connect(alice).registerProject(input({ invitees: five }))).to.be.revertedWithCustomError(
        registry,
        "TeamTooLarge",
      );
      await registry.connect(alice).registerProject(input({ invitees: five.slice(0, 4) }));
      await expect(registry.connect(alice).inviteMember(1n, frank.address)).to.be.revertedWithCustomError(registry, "TeamTooLarge");
      await registry.connect(alice).cancelInvite(1n, eve.address);
      await expect(registry.connect(alice).inviteMember(1n, frank.address)).to.emit(registry, "MemberInvited");
      await expect(registry.connect(bob).inviteMember(1n, eve.address)).to.be.revertedWithCustomError(registry, "NotProjectOwner");
    });

    it("validates input and closes registration and invites a week after the event ends", async function () {
      const { registry, alice, bob, input } = await loadFixture(deployFixture);
      await expect(registry.connect(alice).registerProject(input({ title: "" }))).to.be.revertedWithCustomError(registry, "InvalidInput");
      await expect(registry.connect(alice).registerProject(input({ title: "T".repeat(81) }))).to.be.revertedWithCustomError(
        registry,
        "InvalidInput",
      );
      await expect(registry.connect(alice).registerProject(input({ pitch: "" }))).to.be.revertedWithCustomError(registry, "InvalidInput");
      await expect(registry.connect(alice).registerProject(input({ url: "u".repeat(201) }))).to.be.revertedWithCustomError(
        registry,
        "InvalidInput",
      );

      await registry.connect(alice).registerProject(input({ invitees: [bob.address] }));
      await time.increase(24 * HOUR + 7 * 24 * HOUR + 60);
      await expect(registry.connect(bob).registerProject(input())).to.be.revertedWithCustomError(registry, "RegistrationClosed");
      await expect(registry.connect(bob).acceptInvite(1n)).to.be.revertedWithCustomError(registry, "RegistrationClosed");
      await expect(registry.connect(bob).declineInvite(1n)).to.emit(registry, "InviteResolved");
    });

    it("transfers ownership only to a team member (T-3)", async function () {
      const { registry, alice, bob, carol, projectId } = await loadFixture(teamFixture);
      await expect(registry.connect(alice).transferProjectOwnership(projectId, carol.address)).to.be.revertedWithCustomError(
        registry,
        "NotTeamMember",
      );
      await expect(registry.connect(bob).transferProjectOwnership(projectId, bob.address)).to.be.revertedWithCustomError(
        registry,
        "NotProjectOwner",
      );
      await expect(registry.connect(alice).transferProjectOwnership(projectId, bob.address))
        .to.emit(registry, "OwnershipTransferred")
        .withArgs(projectId, alice.address, bob.address);
      await expect(registry.connect(alice).postUpdate(projectId, Stage.StillActive, "", "")).to.be.revertedWithCustomError(
        registry,
        "NotProjectOwner",
      );
      await expect(registry.connect(bob).postUpdate(projectId, Stage.StillActive, "", "")).to.emit(registry, "ProjectUpdated");
    });
  });

  describe("tracking", function () {
    it("anchors the 3rd / 6th month checkpoints at the event end and flags missed ones (T-1)", async function () {
      const { registry, proofSkill, alice, projectId } = await loadFixture(teamFixture);
      const [, start, end] = await proofSkill.getEventWindow(1n);
      const p = await registry.getProject(projectId);
      expect(p.anchorAt).to.equal(end);
      expect(end - start).to.equal(24n * 3600n);

      let [status, dueAt, windowStart, windowEnd] = await registry.getCheckpoint(projectId, 1);
      expect(status).to.equal(BigInt(Checkpoint.Upcoming));
      expect(dueAt).to.equal(end + INTERVAL);
      expect(windowStart).to.equal(dueAt - INTERVAL / 2n);
      expect(windowEnd).to.equal(dueAt + INTERVAL / 2n);

      await time.increaseTo(dueAt);
      [status] = await registry.getCheckpoint(projectId, 1);
      expect(status).to.equal(BigInt(Checkpoint.Open));

      await expect(registry.connect(alice).postUpdate(projectId, Stage.StillActive, "12 pilot users", "https://demo.example"))
        .to.emit(registry, "ProjectUpdated")
        .withArgs(projectId, 0n, Stage.StillActive);
      let updateIndex;
      [status, , , , updateIndex] = await registry.getCheckpoint(projectId, 1);
      expect(status).to.equal(BigInt(Checkpoint.Completed));
      expect(updateIndex).to.equal(1n);
      const [update] = await registry.getUpdates(projectId);
      expect(update.note).to.equal("12 pilot users");
      expect(update.evidence).to.equal("https://demo.example");

      await time.increase(Number(INTERVAL) * 2); // past the month-6 window without an update
      [status] = await registry.getCheckpoint(projectId, 2);
      expect(status).to.equal(BigInt(Checkpoint.Missed));
      await expect(registry.getCheckpoint(projectId, 0)).to.be.revertedWithCustomError(registry, "InvalidCheckpoint");
      await expect(registry.getCheckpoint(projectId, 3)).to.be.revertedWithCustomError(registry, "InvalidCheckpoint");
    });

    it("only the owner posts bounded updates; shut-down projects are final", async function () {
      const { registry, alice, bob, projectId } = await loadFixture(teamFixture);
      await expect(registry.connect(bob).postUpdate(projectId, Stage.StillActive, "", "")).to.be.revertedWithCustomError(
        registry,
        "NotProjectOwner",
      );
      await expect(registry.connect(alice).postUpdate(projectId, Stage.Registered, "", "")).to.be.revertedWithCustomError(
        registry,
        "InvalidStage",
      );
      await expect(registry.connect(alice).postUpdate(projectId, Stage.StillActive, "n".repeat(201), "")).to.be.revertedWithCustomError(
        registry,
        "InvalidInput",
      );
      await expect(registry.connect(alice).postUpdate(projectId, Stage.StillActive, "", "e".repeat(201))).to.be.revertedWithCustomError(
        registry,
        "InvalidInput",
      );
      await registry.connect(alice).postUpdate(projectId, Stage.ShutDown, "Team disbanded", "");
      await expect(registry.connect(alice).postUpdate(projectId, Stage.StillActive, "", "")).to.be.revertedWithCustomError(
        registry,
        "ProjectClosed",
      );
      await expect(registry.getUpdates(99n)).to.be.revertedWithCustomError(registry, "ProjectNotFound");
    });

    it("caps the number of updates", async function () {
      const { registry, alice, projectId } = await loadFixture(teamFixture);
      for (let i = 0; i < 24; i++) await registry.connect(alice).postUpdate(projectId, Stage.StillActive, "", "");
      await expect(registry.connect(alice).postUpdate(projectId, Stage.StillActive, "", "")).to.be.revertedWithCustomError(
        registry,
        "TooManyUpdates",
      );
    });
  });

  describe("attestation (L3 / T-2)", function () {
    it("lets the event organizer attest traction but reserves 'funded' for investors and the admin", async function () {
      const { registry, proofSkill, admin, organizer, investor, alice, bob, outsider, projectId } = await loadFixture(teamFixture);
      expect(await registry.canAttestStage(projectId, organizer.address, Stage.StillActive)).to.equal(true);
      expect(await registry.canAttestStage(projectId, organizer.address, Stage.Funded)).to.equal(false);
      expect(await registry.canAttestStage(projectId, investor.address, Stage.Funded)).to.equal(true);
      expect(await registry.canAttestStage(projectId, admin.address, Stage.Funded)).to.equal(true);
      expect(await registry.canAttestStage(projectId, bob.address, Stage.StillActive)).to.equal(false);
      expect(await registry.canAttestStage(projectId, outsider.address, Stage.StillActive)).to.equal(false);

      await registry.connect(alice).postUpdate(projectId, Stage.Funded, "Pre-seed closed", "https://news.example");
      for (const s of [alice, bob, outsider, organizer]) {
        await expect(registry.connect(s).attestUpdate(projectId, 0)).to.be.revertedWithCustomError(registry, "NotAttester");
      }
      await expect(registry.connect(investor).attestUpdate(projectId, 0))
        .to.emit(registry, "UpdateAttested")
        .withArgs(projectId, 0n, investor.address, Stage.Funded);
      expect((await registry.getProject(projectId)).stageAttested).to.equal(true);
      expect(await score({ proofSkill }, alice)).to.equal(25n + 85n);
      expect(await score({ proofSkill }, bob)).to.equal(25n + 85n);
      expect(await registry.pointsEarned(projectId, bob.address)).to.equal(85n);
      await expect(registry.connect(admin).attestUpdate(projectId, 0)).to.be.revertedWithCustomError(registry, "AlreadyAttested");
      await expect(registry.connect(admin).attestUpdate(projectId, 5)).to.be.revertedWithCustomError(registry, "UpdateNotFound");
    });

    it("rejects a removed investor and an organizer who lost verification", async function () {
      const { registry, proofSkill, organizer, investor, alice, projectId } = await loadFixture(teamFixture);
      await registry.connect(alice).postUpdate(projectId, Stage.StillActive, "", "");
      await registry.removeInvestor(investor.address);
      await proofSkill.removeOrganizer(organizer.address);
      await expect(registry.connect(investor).attestUpdate(projectId, 0)).to.be.revertedWithCustomError(registry, "NotAttester");
      await expect(registry.connect(organizer).attestUpdate(projectId, 0)).to.be.revertedWithCustomError(registry, "NotAttester");
    });

    it("awards cumulative 10 / 35 / 85 points only on forward progress, so cycling earns nothing", async function () {
      const ctx = await loadFixture(teamFixture);
      const { registry, organizer, investor, alice, projectId } = ctx;
      const post = async (stage) => {
        await registry.connect(alice).postUpdate(projectId, stage, "", "");
        return (await registry.getUpdates(projectId)).length - 1;
      };

      await registry.connect(organizer).attestUpdate(projectId, await post(Stage.StillActive));
      expect(await score(ctx, alice)).to.equal(35n);
      await registry.connect(organizer).attestUpdate(projectId, await post(Stage.FirstCustomer));
      expect(await score(ctx, alice)).to.equal(60n);
      await registry.connect(organizer).attestUpdate(projectId, await post(Stage.StillActive));
      await registry.connect(organizer).attestUpdate(projectId, await post(Stage.FirstCustomer));
      expect(await score(ctx, alice)).to.equal(60n);
      await registry.connect(investor).attestUpdate(projectId, await post(Stage.Funded));
      expect(await score(ctx, alice)).to.equal(110n);
      await registry.connect(organizer).attestUpdate(projectId, await post(Stage.ShutDown));
      expect(await score(ctx, alice)).to.equal(110n);
      expect((await registry.getProject(projectId)).highestRewarded).to.equal(BigInt(Stage.Funded));
    });

    it("marks the current stage attested only when the latest update is attested", async function () {
      const { registry, organizer, alice, projectId } = await loadFixture(teamFixture);
      await registry.connect(alice).postUpdate(projectId, Stage.StillActive, "", "");
      await registry.connect(alice).postUpdate(projectId, Stage.FirstCustomer, "", "");
      await registry.connect(organizer).attestUpdate(projectId, 0);
      expect((await registry.getProject(projectId)).stageAttested).to.equal(false);
      await registry.connect(organizer).attestUpdate(projectId, 1);
      expect((await registry.getProject(projectId)).stageAttested).to.equal(true);
      await registry.connect(alice).postUpdate(projectId, Stage.FirstCustomer, "", "");
      expect((await registry.getProject(projectId)).stageAttested).to.equal(false);
    });
  });

  describe("moderation and investors", function () {
    it("lets only the admin hide projects and manage investors (T-5)", async function () {
      const { registry, token, organizer, outsider, projectId } = await loadFixture(teamFixture);
      await expect(registry.connect(organizer).setProjectHidden(projectId, true)).to.be.revertedWithCustomError(registry, "NotAdmin");
      await expect(registry.connect(outsider).addInvestor(outsider.address, "X", "")).to.be.revertedWithCustomError(registry, "NotAdmin");
      await expect(registry.addInvestor(ethers.ZeroAddress, "X", "")).to.be.revertedWithCustomError(registry, "InvalidInput");
      await expect(registry.addInvestor(outsider.address, "", "")).to.be.revertedWithCustomError(registry, "InvalidInput");

      await expect(registry.setProjectHidden(projectId, true)).to.emit(registry, "ProjectHidden").withArgs(projectId, true);
      expect((await registry.getProject(projectId)).hidden).to.equal(true);
      const json = JSON.parse(decodeDataUri(await token.uri(PROJECT_OFFSET + projectId), "data:application/json;base64,"));
      expect(json.attributes.find((a) => a.trait_type === "Verification").value).to.equal("Hidden by moderator");
      await registry.setProjectHidden(projectId, false);
      expect((await registry.getProject(projectId)).hidden).to.equal(false);
    });

    it("returns projects newest first with a capped page size", async function () {
      const { registry, alice, carol, input } = await loadFixture(deployFixture);
      await registry.connect(alice).registerProject(input({ title: "A" }));
      await registry.connect(carol).registerProject(input({ title: "B" }));
      expect((await registry.getProjects(0, 1000)).map((p) => p.title)).to.deep.equal(["B", "A"]);
      expect((await registry.getProjects(1, 1)).map((p) => p.title)).to.deep.equal(["A"]);
      expect(await registry.getProjects(5, 10)).to.deep.equal([]);
    });
  });

  describe("revocation cascade (L2)", function () {
    it("removes a revoked member, burns their project token and claws back milestone points", async function () {
      const ctx = await loadFixture(teamFixture);
      const { registry, proofSkill, token, organizer, alice, bob, projectId } = ctx;
      await registry.connect(alice).postUpdate(projectId, Stage.StillActive, "", "");
      await registry.connect(organizer).attestUpdate(projectId, 0);
      expect(await score(ctx, bob)).to.equal(35n);

      await expect(proofSkill.connect(organizer).revokeCredential(bob.address, 1n, "Was not on site"))
        .to.emit(registry, "MemberRemoved")
        .withArgs(projectId, bob.address);
      expect(await score(ctx, bob)).to.equal(0n);
      expect(await registry.isMember(projectId, bob.address)).to.equal(false);
      expect(await registry.projectOf(1n, bob.address)).to.equal(0n);
      expect(await registry.pointsEarned(projectId, bob.address)).to.equal(0n);
      expect(await registry.getMemberProjects(bob.address)).to.deep.equal([]);
      expect(await token.balanceOf(bob.address, PROJECT_OFFSET + projectId)).to.equal(0n);
      expect(await token.balanceOf(bob.address, 1n)).to.equal(0n);
      expect((await registry.getProject(projectId)).team).to.deep.equal([alice.address]);
      expect(await score(ctx, alice)).to.equal(35n);
    });

    it("passes ownership on, and closes the project when every member is revoked", async function () {
      const { registry, proofSkill, organizer, alice, bob, carol, projectId } = await loadFixture(teamFixture);
      await registry.connect(alice).inviteMember(projectId, carol.address);

      await expect(proofSkill.connect(organizer).revokeCredential(alice.address, 1n, ""))
        .to.emit(registry, "OwnershipTransferred")
        .withArgs(projectId, alice.address, bob.address);
      expect((await registry.getProject(projectId)).owner).to.equal(bob.address);

      await proofSkill.connect(organizer).revokeCredential(bob.address, 1n, "");
      const p = await registry.getProject(projectId);
      expect(p.owner).to.equal(ethers.ZeroAddress);
      expect(p.team).to.deep.equal([]);
      expect(p.stage).to.equal(BigInt(Stage.ShutDown));
      await expect(registry.connect(carol).acceptInvite(projectId)).to.be.revertedWithCustomError(registry, "ProjectClosed");
    });

    it("only ProofSkill can trigger the cascade", async function () {
      const { registry, admin, bob } = await loadFixture(teamFixture);
      await expect(registry.connect(admin).onAttendanceRevoked(bob.address, 1n)).to.be.revertedWithCustomError(
        registry,
        "NotProofSkill",
      );
    });
  });

  describe("soulbound credential token", function () {
    it("mints an attendance credential on check-in (ERC-5192 Locked) and burns it on revocation", async function () {
      const ctx = await loadFixture(deployFixture);
      const { token, proofSkill, organizer, alice, outsider } = ctx;
      expect(await token.balanceOf(alice.address, 1n)).to.equal(1n);
      await expect(checkIn(ctx, outsider, 1n)).to.emit(token, "Locked").withArgs(1n);
      await proofSkill.connect(organizer).revokeCredential(alice.address, 1n, "Duplicate account");
      expect(await token.balanceOf(alice.address, 1n)).to.equal(0n);
    });

    it("blocks transfers and approvals and advertises ERC-1155 + ERC-5192", async function () {
      const { token, alice, bob } = await loadFixture(deployFixture);
      await expect(token.connect(alice).safeTransferFrom(alice.address, bob.address, 1n, 1n, "0x")).to.be.revertedWithCustomError(
        token,
        "Soulbound",
      );
      await expect(
        token.connect(alice).safeBatchTransferFrom(alice.address, bob.address, [1n], [1n], "0x"),
      ).to.be.revertedWithCustomError(token, "Soulbound");
      await expect(token.connect(alice).setApprovalForAll(bob.address, true)).to.be.revertedWithCustomError(token, "Soulbound");
      expect(await token.locked(1n)).to.equal(true);
      expect(await token.supportsInterface("0xb45a3c0e")).to.equal(true);
      expect(await token.supportsInterface("0xd9b67a26")).to.equal(true);
      expect(await token.supportsInterface("0xffffffff")).to.equal(false);
    });

    it("has no admin: nobody can mint, burn or re-wire it (C2 / C3)", async function () {
      const { token, registry, proofSkill, admin, outsider, alice } = await loadFixture(deployFixture);
      for (const caller of [admin, outsider]) {
        await expect(token.connect(caller).mintAttendance(caller.address, 1n)).to.be.revertedWithCustomError(token, "Unauthorized");
        await expect(token.connect(caller).burnAttendance(alice.address, 1n)).to.be.revertedWithCustomError(token, "Unauthorized");
        await expect(token.connect(caller).mintProject(caller.address, 1n)).to.be.revertedWithCustomError(token, "Unauthorized");
        await expect(token.connect(caller).burnProject(alice.address, 1n)).to.be.revertedWithCustomError(token, "Unauthorized");
        await expect(token.connect(caller).refreshProject(1n)).to.be.revertedWithCustomError(token, "Unauthorized");
      }
      await expect(token.setProjectRegistry(outsider.address)).to.be.revertedWithCustomError(token, "AlreadyWired");
      await expect(registry.setCredentialToken(outsider.address)).to.be.revertedWithCustomError(registry, "AlreadyWired");

      const fresh = await (await ethers.getContractFactory("OnCVCredential")).deploy(await proofSkill.getAddress());
      await expect(fresh.connect(outsider).setProjectRegistry(outsider.address)).to.be.revertedWithCustomError(fresh, "Unauthorized");
    });

    it("renders escaped on-chain metadata for attendance credentials", async function () {
      const { token } = await loadFixture(deployFixture);
      const json = JSON.parse(decodeDataUri(await token.uri(1n), "data:application/json;base64,"));
      expect(json.name).to.equal('Avalanche "Build" <Hackathon> & Demo Day');
      expect(json.attributes.find((a) => a.trait_type === "Organizer").value).to.equal("Blockchain ITU");
      const svg = decodeDataUri(json.image, "data:image/svg+xml;base64,");
      expect(svg).to.contain("VERIFIED ATTENDANCE");
      expect(svg).to.contain("&quot;Build&quot; &lt;Hacka");
      expect(svg).to.not.contain("<Hackathon>");
    });

    it("labels online events", async function () {
      const ctx = await loadFixture(deployFixture);
      await ctx.proofSkill.createEvent(eventInput({ name: "Online AMA", location: "Zoom", isOnline: true, checkInSigner: ctx.qrSigner.address }));
      const json = JSON.parse(decodeDataUri(await ctx.token.uri(2n), "data:application/json;base64,"));
      expect(json.attributes.find((a) => a.trait_type === "Location").value).to.equal("Online");
    });

    it("updates the project credential's metadata as the project progresses", async function () {
      const { token, registry, organizer, alice, projectId } = await loadFixture(teamFixture);
      const tokenId = PROJECT_OFFSET + projectId;
      const read = async () => JSON.parse(decodeDataUri(await token.uri(tokenId), "data:application/json;base64,"));
      const trait = (json, name) => json.attributes.find((a) => a.trait_type === name).value;

      let json = await read();
      expect(trait(json, "Stage")).to.equal("Registered");
      expect(trait(json, "Checkpoint 3M")).to.equal("Upcoming");
      expect(trait(json, "Team size")).to.equal(2);

      const [, dueAt] = await registry.getCheckpoint(projectId, 1);
      await time.increaseTo(dueAt);
      await expect(registry.connect(alice).postUpdate(projectId, Stage.FirstCustomer, "First paying customer", ""))
        .to.emit(token, "MetadataUpdate")
        .withArgs(tokenId);
      json = await read();
      expect(trait(json, "Stage")).to.equal("First customer");
      expect(trait(json, "Verification")).to.equal("Self-reported");
      expect(trait(json, "Checkpoint 3M")).to.equal("Completed");

      await registry.connect(organizer).attestUpdate(projectId, 0);
      json = await read();
      expect(trait(json, "Verification")).to.equal("Attested");
      const svg = decodeDataUri(json.image, "data:image/svg+xml;base64,");
      expect(svg).to.contain("First customer - Attested");
    });
  });
});
