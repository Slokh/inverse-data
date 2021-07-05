import "source-map-support";

import { Contract } from "ethers";
import { GOVERNANCE } from "@config/constants";
import { GOVERNANCE_ABI } from "@config/abis";
import { formatUnits } from "ethers/lib/utils";
import { DynamoDB } from "aws-sdk";
import { RetryProvider } from "@lib/retry-provider";

const GRACE_PERIOD = 1209600;

const dynamo = new DynamoDB.DocumentClient();

enum ProposalStatus {
  pending = "Pending",
  active = "Active",
  canceled = "Canceled",
  defeated = "Defeated",
  succeeded = "Succeeded",
  queued = "Queued",
  expired = "Expired",
  executed = "Executed",
}

export const handler = async () => {
  try {
    const provider = new RetryProvider(
      5,
      "https://cloudflare-eth.com/",
      "homestead"
    );
    const governance = new Contract(GOVERNANCE, GOVERNANCE_ABI, provider);

    const [
      blockNumber,
      proposalCount,
      quorumVotes,
      votesCast,
      proposalsCreated,
    ] = await Promise.all([
      provider.getBlockNumber(),
      governance.proposalCount(),
      governance.quorumVotes(),
      governance.queryFilter(governance.filters.VoteCast()),
      governance.queryFilter(governance.filters.ProposalCreated()),
    ]);

    const proposalData = await Promise.all(
      [...Array(proposalCount.toNumber()).keys()].map((i) =>
        governance.proposals(i + 1)
      )
    );

    const startBlocks = await Promise.all(
      proposalData.map(({ startBlock }) =>
        provider.getBlock(startBlock.toNumber())
      )
    );

    const endBlocks = await Promise.all(
      proposalData.map(({ endBlock }) => provider.getBlock(endBlock.toNumber()))
    );

    const proposals = proposalData.map(
      (
        {
          id,
          proposer,
          eta,
          startBlock,
          endBlock,
          forVotes,
          againstVotes,
          canceled,
          executed,
        },
        i
      ) => {
        const { args } = proposalsCreated.find(({ args }) => args.id.eq(id));
        const votes = votesCast.filter(({ args }) => args?.proposalId.eq(id));

        let status = ProposalStatus.queued;
        if (canceled) {
          status = ProposalStatus.canceled;
        } else if (executed) {
          status = ProposalStatus.executed;
        } else if (blockNumber <= startBlock.toNumber()) {
          status = ProposalStatus.pending;
        } else if (blockNumber <= endBlock.toNumber()) {
          status = ProposalStatus.active;
        } else if (forVotes.lte(againstVotes) || forVotes.lte(quorumVotes)) {
          status = ProposalStatus.defeated;
        } else if (eta.isZero()) {
          status = ProposalStatus.succeeded;
        } else if (Date.now() >= eta.toNumber() + GRACE_PERIOD) {
          status = ProposalStatus.expired;
        }

        return {
          id: id.toNumber(),
          proposer: proposer,
          etaTimestamp: eta.toNumber() * 1000,
          startTimestamp: startBlocks[i].timestamp * 1000,
          endTimestamp: endBlocks[i].timestamp * 1000,
          startBlock: startBlock.toNumber(),
          endBlock: endBlock.toNumber(),
          forVotes: parseFloat(formatUnits(forVotes)),
          againstVotes: parseFloat(formatUnits(againstVotes)),
          canceled: canceled,
          executed: executed,
          title: args.description.split("\n")[0].split("# ")[1],
          description: args.description.split("\n").slice(1).join("\n"),
          status,
          functions: args.targets.map((target: any, i: number) => ({
            target,
            signature: args.signatures[i],
            callData: args.calldatas[i],
          })),
          voters: votes.map((vote: any) => ({
            id: vote.args[1].toNumber(),
            voter: vote.args[0],
            support: vote.args[2],
            votes: parseFloat(formatUnits(vote.args[3])),
          })),
        };
      }
    );

    await dynamo
      .put({
        TableName: "inverse",
        Item: {
          field: "proposals",
          blockNumber,
          timestamp: Date.now(),
          data: proposals,
        },
      })
      .promise();

    return JSON.stringify({ status: "ok" });
  } catch (err) {
    console.error(err);
  }
};
