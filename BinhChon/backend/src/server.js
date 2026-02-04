const path = require("path");
const express = require("express");
const cors = require("cors");
const { createPublicClient, defineChain, http, parseAbi } = require("viem");

// Luôn load file .env ở thư mục backend gốc, dù chạy từ backend/src
const envPath = path.resolve(__dirname, "..", ".env");
require("dotenv").config({ path: envPath });

const app = express();
app.use(cors());
app.use(express.json());

// Log mỗi request để dễ debug
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

const rpcUrl = process.env.CRONOS_TESTNET_RPC_URL || "https://evm-t3.cronos.org";
const envContractAddress = process.env.CONTRACT_ADDRESS;
const port = process.env.PORT || 4000;

const cronosTestnet = defineChain({
  id: 338,
  name: "Cronos Testnet",
  nativeCurrency: { name: "Cronos", symbol: "tCRO", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } },
  blockExplorers: {
    default: { name: "Cronos Testnet Explorer", url: "https://explorer.cronos.org/testnet" },
  },
});

const client = createPublicClient({ chain: cronosTestnet, transport: http(rpcUrl) });

const votingAbi = parseAbi([
  "function totalPolls() view returns (uint256)",
  "function getPoll(uint256 pollId) view returns (string title, string description, string[] options, uint256[] votes, uint64 startTime, uint64 endTime, bool active, address creator)",
  "function hasAddressVoted(uint256 pollId, address voter) view returns (bool)",
]);

function deriveState(poll) {
  const now = Math.floor(Date.now() / 1000);
  if (!poll.active) return "closed";
  if (now < poll.startTime) return "scheduled";
  if (poll.endTime !== 0 && now > poll.endTime) return "ended";
  return "live";
}

function getContractAddress(req) {
  return (req.query.address || "").trim() || envContractAddress;
}

async function readPoll(pollId, contractAddress) {
  const [title, description, options, votes, startTime, endTime, active, creator] =
    await client.readContract({
      address: contractAddress,
      abi: votingAbi,
      functionName: "getPoll",
      args: [BigInt(pollId)],
    });

  const poll = {
    id: pollId,
    title,
    description,
    options,
    votes: votes.map((v) => Number(v)),
    startTime: Number(startTime),
    endTime: Number(endTime),
    active,
    creator,
  };

  return { ...poll, state: deriveState(poll) };
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/polls", async (req, res) => {
  const contractAddress = getContractAddress(req);

  if (!contractAddress) {
    console.error("Missing CONTRACT_ADDRESS (env or query) at", envPath);
    return res.status(500).json({ error: "Missing CONTRACT_ADDRESS" });
  }

  try {
    console.log("Reading total polls from", contractAddress);
    const total = Number(
      await client.readContract({ address: contractAddress, abi: votingAbi, functionName: "totalPolls" })
    );

    console.log("Total polls:", total);
    const ids = Array.from({ length: total }, (_, i) => i);
    const polls = await Promise.all(ids.map((id) => readPoll(id, contractAddress)));

    res.json({ total, polls, chainId: cronosTestnet.id, rpcUrl });
  } catch (err) {
    console.error("/polls", err);
    res.status(500).json({ error: "Unable to read polls", details: err.message });
  }
});

app.get("/polls/:id", async (req, res) => {
  const contractAddress = getContractAddress(req);

  if (!contractAddress) {
    return res.status(500).json({ error: "Missing CONTRACT_ADDRESS" });
  }

  const pollId = Number(req.params.id);

  try {
    console.log(`Reading poll ${pollId} from`, contractAddress);
    const poll = await readPoll(pollId, contractAddress);
    res.json(poll);
  } catch (err) {
    console.error(`/polls/${pollId}`, err);
    res.status(500).json({ error: "Unable to read poll", details: err.message });
  }
});

app.listen(port, () => {
  console.log(`Backend dang chay o http://localhost:${port}`);
});
