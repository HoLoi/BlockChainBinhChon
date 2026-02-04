import axios from "axios";
import { ethers } from "ethers";
import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";

const DEFAULT_CONTRACT = process.env.REACT_APP_CONTRACT_ADDRESS || "";
const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:4000";
const RPC_URL = process.env.REACT_APP_RPC_URL || "https://evm-t3.cronos.org";
const EXPLORER = "https://explorer.cronos.org/testnet";

const contractAbi = [
  "function vote(uint256 pollId, uint256 optionId)",
  "function createPoll(string title, string description, string[] options, uint64 startTime, uint64 endTime) returns (uint256)",
  "function totalPolls() view returns (uint256)",
  "function getPoll(uint256 pollId) view returns (string title, string description, string[] options, uint256[] votes, uint64 startTime, uint64 endTime, bool active, address creator)",
  "function owner() view returns (address)",
  "function hasAddressVoted(uint256 pollId, address voter) view returns (bool)",
];

const CRONOS_PARAMS = {
  chainId: "0x152",
  chainName: "Cronos Testnet",
  nativeCurrency: { name: "Cronos", symbol: "tCRO", decimals: 18 },
  rpcUrls: [RPC_URL],
  blockExplorerUrls: [EXPLORER],
};

const statusLabel = {
  live: "Đang diễn ra",
  scheduled: "Chờ mở",
  ended: "Hết hạn",
  closed: "Đã đóng",
};

function shorten(value) {
  if (!value) return "";
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function formatDate(ts) {
  if (!ts) return "Không giới hạn";
  return new Date(ts * 1000).toLocaleString();
}

function App() {
  const [wallet, setWallet] = useState("");
  const [contractAddress, setContractAddress] = useState(DEFAULT_CONTRACT);
  const [privateKey, setPrivateKey] = useState("");
  const [signer, setSigner] = useState(null);
  const [usingPrivateKey, setUsingPrivateKey] = useState(false);
  const [owner, setOwner] = useState("");
  const [polls, setPolls] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [votingId, setVotingId] = useState(null);
  const [message, setMessage] = useState("");
  const [txHash, setTxHash] = useState("");
  const [newPoll, setNewPoll] = useState({ title: "", description: "", options: "", start: "", end: "" });

  const explorerTx = useMemo(() => (txHash ? `${EXPLORER}/tx/${txHash}` : ""), [txHash]);

  const fetchPolls = useCallback(async () => {
    if (!contractAddress) {
      setPolls([]);
      setMessage("Nhập địa chỉ hợp đồng để tải dữ liệu.");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const res = await axios.get(`${API_BASE}/polls`, { params: { address: contractAddress } });
      setPolls(res.data.polls || []);
    } catch (err) {
      setMessage("Không tải được dữ liệu từ backend.");
    } finally {
      setLoading(false);
    }
  }, [contractAddress]);

  useEffect(() => {
    fetchPolls();
  }, [fetchPolls]);

  const ensureCronos = useCallback(async () => {
    if (!window.ethereum) throw new Error("Cần MetaMask");
    const current = await window.ethereum.request({ method: "eth_chainId" });
    if (current === CRONOS_PARAMS.chainId) return;
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CRONOS_PARAMS.chainId }] });
    } catch (switchErr) {
      await window.ethereum.request({ method: "wallet_addEthereumChain", params: [CRONOS_PARAMS] });
    }
  }, []);

  const connectWallet = useCallback(async () => {
    try {
      if (privateKey.trim()) {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const walletSigner = new ethers.Wallet(privateKey.trim(), provider);
        setSigner(walletSigner);
        setWallet(walletSigner.address);
        setUsingPrivateKey(true);

        if (contractAddress) {
          const contract = new ethers.Contract(contractAddress, contractAbi, provider);
          const chainOwner = await contract.owner();
          setOwner(chainOwner.toLowerCase());
        }
        setMessage("Đã kết nối bằng khóa bí mật (chỉ lưu trong bộ nhớ).");
        return;
      }

      await ensureCronos();
      const [account] = await window.ethereum.request({ method: "eth_requestAccounts" });
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signerFromMetaMask = await provider.getSigner();

      setSigner(signerFromMetaMask);
      setWallet(account);
      setUsingPrivateKey(false);

      if (contractAddress) {
        const contract = new ethers.Contract(contractAddress, contractAbi, provider);
        const chainOwner = await contract.owner();
        setOwner(chainOwner.toLowerCase());
      }
    } catch (err) {
      setMessage(err.message || "Không thể kết nối ví");
    }
  }, [contractAddress, ensureCronos, privateKey]);

  const vote = useCallback(
    async (pollId, optionId) => {
      if (!contractAddress) {
        setMessage("Chưa nhập địa chỉ hợp đồng");
        return;
      }
      if (!signer) {
        setMessage("Cần kết nối ví trước");
        return;
      }

      try {
        setVotingId(pollId);
        if (!usingPrivateKey) await ensureCronos();
        const contract = new ethers.Contract(contractAddress, contractAbi, signer);

        const tx = await contract.vote(pollId, optionId);
        setTxHash(tx.hash);
        setMessage("Đang chờ xác nhận giao dịch...");
        await tx.wait();
        setMessage("Bình chọn thành công!");
        await fetchPolls();
      } catch (err) {
        setMessage(err.shortMessage || err.message || "Lỗi khi bình chọn");
      } finally {
        setVotingId(null);
      }
    },
    [contractAddress, ensureCronos, fetchPolls, signer, usingPrivateKey]
  );

  const createPoll = useCallback(
    async (evt) => {
      evt.preventDefault();
      if (!contractAddress) {
        setMessage("Chưa nhập địa chỉ hợp đồng");
        return;
      }
      if (!wallet || !signer) {
        setMessage("Cần kết nối ví để tạo poll");
        return;
      }

      const optionList = newPoll.options
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);

      if (optionList.length < 2) {
        setMessage("Cần ít nhất 2 lựa chọn");
        return;
      }

      const startTime = newPoll.start ? Math.floor(new Date(newPoll.start).getTime() / 1000) : 0;
      const endTime = newPoll.end ? Math.floor(new Date(newPoll.end).getTime() / 1000) : 0;

      try {
        setCreating(true);
        if (!usingPrivateKey) await ensureCronos();
        const contract = new ethers.Contract(contractAddress, contractAbi, signer);

        const tx = await contract.createPoll(newPoll.title, newPoll.description, optionList, startTime, endTime);
        setTxHash(tx.hash);
        setMessage("Đang tạo poll trên chain...");
        await tx.wait();
        setMessage("Tạo poll thành công");
        setNewPoll({ title: "", description: "", options: "", start: "", end: "" });
        await fetchPolls();
      } catch (err) {
        setMessage(err.shortMessage || err.message || "Lỗi khi tạo poll");
      } finally {
        setCreating(false);
      }
    },
    [contractAddress, ensureCronos, fetchPolls, newPoll, signer, usingPrivateKey, wallet]
  );
  const canCreate = !!contractAddress;

  const applyInputs = (evt) => {
    evt.preventDefault();
    setMessage("Đã lưu địa chỉ hợp đồng và khóa bí mật tạm thời trong phiên.");
    fetchPolls();
  };

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">Cronos Testnet · tCRO</p>
          <h1>Hệ thống bình chọn giảng viên & sinh viên</h1>
          <p className="lead">
            Kết nối MetaMask, bỏ phiếu on-chain và theo dõi giao dịch ngay trên Cronos Explorer.
          </p>
          <form className="form-grid" onSubmit={applyInputs} style={{ marginTop: 10 }}>
            <label>
              Địa chỉ hợp đồng
              <input
                value={contractAddress}
                onChange={(e) => setContractAddress(e.target.value.trim())}
                placeholder="0x..."
              />
            </label>
            <label>
              Khóa bí mật (tùy chọn)
              <input
                type="password"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value.trim())}
                placeholder="0x..."
              />
              <span className="hint">Chỉ lưu trong bộ nhớ trình duyệt hiện tại.</span>
            </label>
            <div className="actions" style={{ marginTop: 6 }}>
              <button className="primary" type="submit">Lưu / Áp dụng</button>
              <button className="ghost" type="button" onClick={fetchPolls} disabled={loading}>
                Làm mới dữ liệu
              </button>
            </div>
          </form>
          <div className="actions">
            <button className="primary" onClick={connectWallet}>
              {wallet ? "Đã kết nối ví" : "Kết nối ví"}
            </button>
          </div>
          <div className="meta">
            <span>Ví: {wallet ? shorten(wallet) : "Chưa kết nối"}</span>
            <span>
              Hợp đồng: {contractAddress ? (
                <a href={`${EXPLORER}/address/${contractAddress}`} target="_blank" rel="noreferrer">
                  {shorten(contractAddress)}
                </a>
              ) : (
                "Chưa cấu hình"
              )}
            </span>
            {owner && <span>Chủ hợp đồng: {shorten(owner)}</span>}
            <span>Quyền: Mọi người đều có thể tạo & bình chọn</span>
            {usingPrivateKey && <span>Đang dùng khóa bí mật cục bộ</span>}
          </div>
          {message && <div className="toast">{message}</div>}
          {explorerTx && (
            <div className="toast link">
              TX: <a href={explorerTx} target="_blank" rel="noreferrer">{shorten(txHash)}</a>
            </div>
          )}
        </div>
        <div className="hero-card">
          <h3>Trạng thái nhanh</h3>
          <div className="stat-line">
            <span>Số poll</span>
            <strong>{polls.length}</strong>
          </div>
          <div className="stat-line">
            <span>Kết nối</span>
            <strong>{wallet ? "Đã kết nối" : "Chưa kết nối"}</strong>
          </div>
          <div className="stat-line">
            <span>Chuỗi</span>
            <strong>Cronos Testnet (338)</strong>
          </div>
        </div>
      </header>

      {canCreate && (
        <section className="card form-card">
          <div className="form-head">
            <div>
              <p className="eyebrow">Bất kỳ người dùng</p>
              <h2>Tạo cuộc bình chọn</h2>
            </div>
            <span className="hint">Mọi ví đều có thể tạo poll</span>
          </div>
          <form className="form-grid" onSubmit={createPoll}>
            <label>
              Tiêu đề
              <input
                required
                value={newPoll.title}
                onChange={(e) => setNewPoll({ ...newPoll, title: e.target.value })}
                placeholder="Bầu chọn giảng viên xuất sắc"
              />
            </label>
            <label>
              Mô tả
              <textarea
                rows={2}
                value={newPoll.description}
                onChange={(e) => setNewPoll({ ...newPoll, description: e.target.value })}
                placeholder="Mô tả ngắn gọn tiêu chí bình chọn"
              />
            </label>
            <label>
              Lựa chọn (mỗi dòng 1 lựa chọn)
              <textarea
                rows={3}
                required
                value={newPoll.options}
                onChange={(e) => setNewPoll({ ...newPoll, options: e.target.value })}
                placeholder={`GV A\nGV B\nGV C`}
              />
            </label>
            <div className="two-col">
              <label>
                Bắt đầu (UTC)
                <input
                  type="datetime-local"
                  value={newPoll.start}
                  onChange={(e) => setNewPoll({ ...newPoll, start: e.target.value })}
                />
              </label>
              <label>
                Kết thúc (UTC)
                <input
                  type="datetime-local"
                  value={newPoll.end}
                  onChange={(e) => setNewPoll({ ...newPoll, end: e.target.value })}
                />
              </label>
            </div>
            <div className="form-actions">
              <button className="primary" type="submit" disabled={creating}>
                {creating ? "Đang tạo..." : "Tạo poll"}
              </button>
              <span className="hint">Nếu bỏ trống thời gian, poll mở ngay và không có hạn.</span>
            </div>
          </form>
        </section>
      )}

      <section>
        <div className="section-head">
          <h2>Danh sách bình chọn</h2>
          {loading && <span className="hint">Đang tải...</span>}
        </div>
        <div className="poll-grid">
          {polls.map((poll) => {
            const totalVotes = poll.votes.reduce((s, v) => s + v, 0);
            const state = poll.state || "live";
            const disabled = state !== "live" || !wallet;

            return (
              <div key={poll.id} className="card poll-card">
                <div className="poll-head">
                  <div>
                    <p className="eyebrow">#{poll.id}</p>
                    <h3>{poll.title}</h3>
                  </div>
                  <span className={`pill ${state}`}>{statusLabel[state] || state}</span>
                </div>
                {poll.description && <p className="muted">{poll.description}</p>}
                <div className="times">
                  <span>Bắt đầu: {formatDate(poll.startTime)}</span>
                  <span>Kết thúc: {formatDate(poll.endTime)}</span>
                </div>
                <div className="options">
                  {poll.options.map((opt, idx) => {
                    const count = poll.votes[idx] || 0;
                    const pct = totalVotes ? Math.round((count / totalVotes) * 100) : 0;
                    return (
                      <button
                        key={opt + idx}
                        className="option"
                        disabled={disabled || votingId === poll.id}
                        onClick={() => vote(poll.id, idx)}
                      >
                        <div className="option-main">
                          <span>{opt}</span>
                          <span className="muted">{count} phiếu</span>
                        </div>
                        <div className="progress">
                          <div style={{ width: `${pct}%` }} />
                        </div>
                        <span className="pct">{pct}%</span>
                      </button>
                    );
                  })}
                </div>
                <div className="foot">
                  <span className="muted">Tổng phiếu: {totalVotes}</span>
                  {poll.creator && (
                    <span className="muted">Tạo bởi: {shorten(poll.creator)}</span>
                  )}
                </div>
              </div>
            );
          })}
          {!loading && polls.length === 0 && <div className="empty">Chưa có poll nào.</div>}
        </div>
      </section>
    </div>
  );
}

export default App;
