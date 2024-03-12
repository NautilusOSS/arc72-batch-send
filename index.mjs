import algosdk, {
  signTransaction,
  waitForConfirmation,
  mnemonicToSecretKey,
  decodeUnsignedTransaction,
} from "algosdk";
import dotenv from "dotenv";
import { CONTRACT } from "ulujs";
import axios from "axios";

dotenv.config();

const { CID, MN, ADDR_TO } = process.env;

const { addr: addrFrom, sk: skFrom } = mnemonicToSecretKey(MN || "");
const addrTo = ADDR_TO;
const collectionId = Number(CID);

const ALGO_SERVER = "https://testnet-api.voi.nodly.io";
const ALGO_INDEXER_SERVER = "https://testnet-idx.voi.nodly.io";

const algodClient = new algosdk.Algodv2(
  process.env.ALGOD_TOKEN || "",
  process.env.ALGOD_SERVER || ALGO_SERVER,
  process.env.ALGOD_PORT || ""
);

const indexerClient = new algosdk.Indexer(
  process.env.INDEXER_TOKEN || "",
  process.env.INDEXER_SERVER || ALGO_INDEXER_SERVER,
  process.env.INDEXER_PORT || ""
);

const signTxns = async (txns, sk) => {
  const stxns = txns
    .map((t) => new Uint8Array(Buffer.from(t, "base64")))
    .map(decodeUnsignedTransaction)
    .map((t) => signTransaction(t, sk));
  return stxns;
};

const arc72Spec = {
  name: "ARC-72",
  description: "High Forge Smart Contract NFT Interface",
  methods: [
    // added
    {
      name: "custom",
      args: [],
      returns: {
        type: "void",
      },
    },
    {
      name: "arc72_transferFrom",
      args: [{ type: "address" }, { type: "address" }, { type: "uint256" }],
      returns: { type: "void" },
    },
  ],
  events: [],
};

const ci = new CONTRACT(collectionId, algodClient, indexerClient, arc72Spec, {
  addr: addrFrom,
});

const builder = {
  arc72: new CONTRACT(
    collectionId,
    algodClient,
    indexerClient,
    arc72Spec,
    {
      addr: addrFrom,
    },
    true,
    false,
    true
  ),
};

const {
  data: { tokens },
} = await axios.get(
  "https://arc72-idx.nftnavigator.xyz/nft-indexer/v1/tokens?contractId=29105406"
);

const holdings = [];

for (const token of tokens) {
  if (token.owner === addrFrom) {
    holdings.push(token);
  }
}

// split holdings into slices of 10
const slices = [];
const size = 11;
for (let i = 0; i < holdings.length; i += size) {
  slices.push(holdings.slice(i, i + size));
}

const stxns = [];
for (const slice of slices) {
  const buildP = (
    await Promise.all(
      slice.map((s) =>
        builder.arc72.arc72_transferFrom(addrFrom, addrTo, s.tokenId)
      )
    )
  ).map(({ obj }) => obj);

  ci.setPaymentAmount(28500);
  ci.setEnableGroupResourceSharing(true);
  ci.setExtraTxns(buildP);
  const customR = await ci.custom();
  if (!customR.success) process.exit(1);
  stxns.push(await signTxns(customR.txns, skFrom));
}

for (const stxn of stxns) {
  await algodClient.sendRawTransaction(stxn.map(({ blob }) => blob)).do();
  await Promise.all(
    stxn.map(({ txID }) => {
      console.log(txID);
      waitForConfirmation(algodClient, txID, 4);
    })
  );
}
