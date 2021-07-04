import "source-map-support";

import { InfuraProvider } from "@ethersproject/providers";
import { Contract } from "ethers";
import { GOVERNANCE, INV } from "@config/constants";
import { GOVERNANCE_ABI, INV_ABI } from "@config/abis";
import { formatUnits } from "ethers/lib/utils";
import { DynamoDB } from "aws-sdk";

const dynamo = new DynamoDB.DocumentClient();

export const handler = async () => {
  try {
    const provider = new InfuraProvider("homestead", process.env.INFURA_ID);
    const inv = new Contract(INV, INV_ABI, provider);
    const governance = new Contract(GOVERNANCE, GOVERNANCE_ABI, provider);

    const blockNumber = await provider.getBlockNumber();

    const [
      delegateVotesChanged,
      delegateChanged,
      votesCast,
    ] = await Promise.all([
      inv.queryFilter(inv.filters.DelegateVotesChanged()),
      inv.queryFilter(inv.filters.DelegateChanged()),
      governance.queryFilter(governance.filters.VoteCast()),
    ]);

    const delegates = delegateVotesChanged.reduce(
      (delegates: any, { args }) => {
        if (args) {
          delegates[args.delegate] = {
            address: args.delegate,
            votingPower: parseFloat(formatUnits(args.newBalance)),
            delegators: [],
            votes: [],
          };
        }
        return delegates;
      },
      {}
    );

    await Promise.all(
      Object.keys(delegates).map(async (delegate: string) => {
        const delegators = delegateChanged
          .filter(({ args }) => args.toDelegate === delegate)
          .map(({ args }) => args.delegator);

        const undelegators = delegateChanged
          .filter(({ args }) => args.fromDelegate === delegate)
          .map(({ args }) => args.delegator);

        const votes = votesCast.filter(({ args }) => args.voter === delegate);

        delegates[delegate] = {
          ...delegates[delegate],
          ensName: await provider.lookupAddress(delegate),
          delegators: await Promise.all(
            Array.from(
              new Set(
                delegators.filter(
                  (delegator) => !undelegators.includes(delegator)
                )
              )
            ).map(async (address: string) => ({
              address,
              ensName: await provider.lookupAddress(delegate),
            }))
          ),
          votes: votes.map(({ args }) => ({
            proposalId: args.proposalId.toNumber(),
            support: args.support,
            votes: parseFloat(formatUnits(args.votes)),
          })),
        };
      })
    );

    await dynamo
      .put(
        {
          TableName: "inverse",
          Item: {
            field: "delegates",
            blockNumber,
            timestamp: Date.now(),
            data: delegates,
          },
        },
        (res, err) => {
          console.log(res);
          console.log(err);
        }
      )
      .promise();

    return JSON.stringify({ status: "ok" });
  } catch (err) {
    console.error(err);
  }
};
