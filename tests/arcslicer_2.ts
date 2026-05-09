import * as fs from "fs";
import * as path from "path";
import { expect } from "chai";

type IdlInstruction = { name: string };
type Idl = { instructions: IdlInstruction[] };

describe("Arcslicer2 IDL", () => {
  it("exposes the current dark-pool instruction surface", () => {
    const idlPath = path.join(__dirname, "..", "target", "idl", "arcslicer_2.json");
    const idl = JSON.parse(fs.readFileSync(idlPath, "utf8")) as Idl;
    const instructionNames = idl.instructions.map((instruction) => instruction.name);

    expect(instructionNames).to.include.members([
      "deposit_and_init_vault",
      "secure_buy_request",
      "withdraw_remainder",
      "init_vault_balance_comp_def",
      "init_match_slice_comp_def",
      "init_reveal_fill_comp_def",
    ]);
  });
});
