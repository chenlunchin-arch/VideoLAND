import React, { useState, useEffect, useRef, useMemo } from "react";
import Hls from "hls.js";
import { Play, Lock, User, Settings, Plus, Trash2, X, Clock, Crown, Film, ChevronDown, LogIn } from "lucide-react";

// API 位置：串接真實後端時改成後端網址（例如 https://api.yourdomain.com）
const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

async function apiFetch(path, { method = "GET", body, token } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: "include", // 帶上 guest_token cookie
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // 沒有 body（例如某些錯誤回應）
  }
  if (!res.ok) {
    const err = new Error(data?.message || `API 錯誤 ${res.status}`);
    err.code = data?.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

// 綠界結帳採「後端組參數、前端自動送出表單」的方式，不是單純導向一個網址
function submitEcpayForm(action, params) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = action;
  Object.entries(params).forEach(([key, value]) => {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = key;
    input.value = value;
    form.appendChild(input);
  });
  document.body.appendChild(form);
  form.submit();
}

// ---------- 本機示範資料（API 尚未連上時的備援，讓畫面仍可操作） ----------

const CATS = ["戲劇", "電影", "動漫", "紀錄片", "綜藝"];

const COLORS = [
  "from-amber-700 to-stone-900",
  "from-rose-800 to-stone-900",
  "from-teal-700 to-stone-900",
  "from-indigo-700 to-stone-900",
  "from-emerald-700 to-stone-900",
  "from-fuchsia-800 to-stone-900",
];

const seedVideos = () => {
  const titles = {
    戲劇: ["深夜食堂", "台北故事", "浮光之城", "雨後彩虹"],
    電影: ["星際邊界", "最後一夜", "山海之間", "逆光飛行"],
    動漫: ["劍與幻境", "少年的天空", "機甲少女", "妖狐物語"],
    紀錄片: ["海洋秘境", "城市脈動", "手作職人", "極地探索"],
    綜藝: ["歡樂加班", "料理對決", "旅行日記", "音樂擂台"],
  };
  let id = 1;
  const list = [];
  CATS.forEach((cat, ci) => {
    titles[cat].forEach((t, i) => {
      list.push({
        id: String(id++),
        title: t,
        category: cat,
        duration: 24 + ((i * 7 + ci * 3) % 40),
        color: COLORS[(id + ci) % COLORS.length],
      });
    });
  });
  return list;
};

const defaultTierConfig = {
  1: { hours: 60, price: 299 },
  2: { hours: 120, price: 499 },
  3: { hours: 240, price: 899 },
  extraHourPrice: 39,
};

function fmtMinutes(min) {
  min = Math.max(0, Math.round(min));
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h <= 0) return `${m} 分鐘`;
  return `${h} 小時 ${m} 分鐘`;
}

// ---------- 登入方塊（右上角）----------

function LoginBox({ authState, onLogin, onRegister, onLogout, tierConfig, tierIdByLevel, onOpenAdmin }) {
  const [open, setOpen] = useState(false);
  const [formMode, setFormMode] = useState("closed"); // "closed" | "login" | "register"
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [registerError, setRegisterError] = useState("");
  const [subscribing, setSubscribing] = useState(false);
  const [subscribeError, setSubscribeError] = useState("");
  const [canceling, setCanceling] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [canceled, setCanceled] = useState(false);

  const subscribeToTier = async (level) => {
    setSubscribeError("");
    const tierId = tierIdByLevel?.[level];
    if (!tierId) {
      setSubscribeError("尚未取得方案 ID，請確認後端 /membership/tiers 是否正常");
      return;
    }
    setSubscribing(true);
    try {
      const order = await apiFetch("/payments/orders", {
        method: "POST",
        token: authState.accessToken,
        body: { type: "subscription", tierId, gateway: "ecpay" },
      });
      if (order.type === "ecpay_form") {
        submitEcpayForm(order.action, order.params);
      } else if (order.type === "redirect" && order.url) {
        window.location.href = order.url;
      }
    } catch (err) {
      setSubscribeError(err.message || "建立訂單失敗");
      setSubscribing(false);
    }
  };

  const cancelSubscription = async () => {
    setCancelError("");
    setCanceling(true);
    try {
      await apiFetch("/payments/subscription/cancel", { method: "POST", token: authState.accessToken });
      setCanceled(true);
    } catch (err) {
      setCancelError(err.message || "取消訂閱失敗");
    } finally {
      setCanceling(false);
    }
  };

  const isLoggedIn = !!authState.user;

  const submitLogin = async (e) => {
    e.preventDefault();
    setLoginError("");
    try {
      await onLogin(email, password);
      setFormMode("closed");
      setOpen(false);
    } catch (err) {
      setLoginError(err.message || "登入失敗，請檢查帳號密碼");
    }
  };

  const submitRegister = async (e) => {
    e.preventDefault();
    setRegisterError("");
    try {
      await onRegister(email, password, name);
      setFormMode("closed");
      setOpen(false);
    } catch (err) {
      setRegisterError(err.message || "註冊失敗，請確認資料或換一個 Email");
    }
  };

  return (
    <div className="relative flex items-center gap-2">
      <button
        onClick={onOpenAdmin}
        className="flex items-center gap-1 rounded-full border border-stone-700 px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-800 transition"
        title="後台管理"
      >
        <Settings size={14} />
        後台
      </button>

      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-amber-700/50 bg-stone-900 px-3 py-1.5 hover:border-amber-500 transition"
      >
        {!isLoggedIn ? (
          <>
            <LogIn size={14} className="text-amber-500" />
            <span className="text-xs text-stone-200">登入 / 加入會員</span>
          </>
        ) : (
          <>
            <Crown size={14} className="text-amber-500" />
            <span className="text-xs text-stone-200">{authState.user.name}</span>
            {authState.user.tier ? (
              <span className="text-[10px] text-amber-500 border border-amber-700/50 rounded px-1">
                第{authState.user.tier}級
              </span>
            ) : (
              <span className="text-[10px] text-stone-500 border border-stone-700 rounded px-1">未訂閱</span>
            )}
          </>
        )}
        <ChevronDown size={12} className="text-stone-500" />
      </button>

      {open && (
        <div className="absolute right-0 top-11 w-72 rounded-lg border border-stone-700 bg-stone-900 shadow-xl z-30 overflow-hidden">
          {!isLoggedIn ? (
            <div className="p-3">
              {formMode === "closed" && (
                <div className="flex gap-2">
                  <button
                    onClick={() => setFormMode("login")}
                    className="flex-1 text-xs bg-amber-600 hover:bg-amber-500 text-stone-950 font-medium rounded px-3 py-2 transition"
                  >
                    會員登入
                  </button>
                  <button
                    onClick={() => setFormMode("register")}
                    className="flex-1 text-xs border border-stone-700 text-stone-200 rounded px-3 py-2 hover:bg-stone-800 transition"
                  >
                    註冊新帳號
                  </button>
                </div>
              )}

              {formMode === "login" && (
                <form onSubmit={submitLogin} className="space-y-2">
                  <input
                    type="email"
                    required
                    placeholder="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-stone-800 border border-stone-700 rounded px-2 py-1.5 text-xs outline-none focus:border-amber-600"
                  />
                  <input
                    type="password"
                    required
                    placeholder="密碼"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-stone-800 border border-stone-700 rounded px-2 py-1.5 text-xs outline-none focus:border-amber-600"
                  />
                  {loginError && <p className="text-[11px] text-rose-500">{loginError}</p>}
                  <button
                    type="submit"
                    className="w-full text-xs bg-amber-600 hover:bg-amber-500 text-stone-950 font-medium rounded px-3 py-2 transition"
                  >
                    登入
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFormMode("register");
                      setLoginError("");
                    }}
                    className="w-full text-[11px] text-stone-500 hover:text-stone-300 transition"
                  >
                    還沒有帳號？改成註冊
                  </button>
                </form>
              )}

              {formMode === "register" && (
                <form onSubmit={submitRegister} className="space-y-2">
                  <input
                    type="text"
                    required
                    placeholder="姓名"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-stone-800 border border-stone-700 rounded px-2 py-1.5 text-xs outline-none focus:border-amber-600"
                  />
                  <input
                    type="email"
                    required
                    placeholder="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-stone-800 border border-stone-700 rounded px-2 py-1.5 text-xs outline-none focus:border-amber-600"
                  />
                  <input
                    type="password"
                    required
                    minLength={8}
                    placeholder="密碼（至少 8 碼）"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-stone-800 border border-stone-700 rounded px-2 py-1.5 text-xs outline-none focus:border-amber-600"
                  />
                  {registerError && <p className="text-[11px] text-rose-500">{registerError}</p>}
                  <button
                    type="submit"
                    className="w-full text-xs bg-amber-600 hover:bg-amber-500 text-stone-950 font-medium rounded px-3 py-2 transition"
                  >
                    註冊並登入
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFormMode("login");
                      setRegisterError("");
                    }}
                    className="w-full text-[11px] text-stone-500 hover:text-stone-300 transition"
                  >
                    已經有帳號？改成登入
                  </button>
                </form>
              )}

              {formMode !== "closed" && (
                <p className="text-[10px] text-stone-600 mt-2">
                  呼叫後端 POST /auth/{formMode === "register" ? "register" : "login"}，尚未接上真實資料庫前會失敗，此時前台會以訪客身份繼續運作。
                </p>
              )}
            </div>
          ) : (
            <div className="p-3 text-xs text-stone-300 space-y-1">
              {authState.user.tier ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-stone-500">本月方案時數</span>
                    <span>{fmtMinutes(tierConfig[authState.user.tier].hours * 60)}</span>
                  </div>
                  <div className="flex justify-between font-medium pt-1 border-t border-stone-800">
                    <span className="text-stone-400">剩餘可看（依伺服器回報）</span>
                    <span className={authState.remainingMinutes <= 0 ? "text-rose-500" : "text-emerald-400"}>
                      {authState.remainingMinutes == null ? "—" : fmtMinutes(authState.remainingMinutes)}
                    </span>
                  </div>
                  {cancelError && <p className="text-[11px] text-rose-500 pt-1">{cancelError}</p>}
                  {canceled ? (
                    <p className="text-[11px] text-emerald-400 pt-1">已取消自動續訂，本期結束前仍可正常觀看。</p>
                  ) : (
                    <button
                      onClick={cancelSubscription}
                      disabled={canceling}
                      className="w-full mt-1 text-xs border border-stone-700 rounded px-3 py-1.5 hover:bg-stone-800 disabled:opacity-50 transition"
                    >
                      {canceling ? "處理中…" : "取消自動續訂"}
                    </button>
                  )}
                </>
              ) : (
                <>
                  <p className="text-stone-400 pb-1">尚未訂閱方案，選一個開始：</p>
                  {[1, 2, 3].map((level) => (
                    <button
                      key={level}
                      onClick={() => subscribeToTier(level)}
                      disabled={subscribing}
                      className="w-full flex justify-between items-center text-xs rounded px-2 py-1.5 mb-1 border border-stone-800 hover:border-amber-600/60 disabled:opacity-50 transition"
                    >
                      <span>
                        第{level}級 · {fmtMinutes(tierConfig[level].hours * 60)}
                      </span>
                      <span className="text-amber-500">NT${tierConfig[level].price}/月</span>
                    </button>
                  ))}
                  {subscribeError && <p className="text-[11px] text-rose-500">{subscribeError}</p>}
                </>
              )}
              <button
                onClick={onLogout}
                className="w-full mt-2 text-xs border border-stone-700 rounded px-3 py-1.5 hover:bg-stone-800 transition"
              >
                登出
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- 影片卡片 ----------

function VideoCard({ video, onClick }) {
  return (
    <button onClick={() => onClick(video)} className="group shrink-0 w-44 text-left focus:outline-none">
      <div
        className={`relative w-44 h-60 rounded-lg bg-gradient-to-br ${video.color} overflow-hidden border border-stone-800 group-hover:border-amber-600/60 transition`}
      >
        <div className="absolute inset-0 flex items-center justify-center opacity-30">
          <Film size={40} className="text-white" />
        </div>
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition flex items-center justify-center">
          <Play size={30} className="text-white opacity-0 group-hover:opacity-100 transition" fill="white" />
        </div>
        <span className="absolute bottom-2 right-2 text-[10px] bg-black/60 text-stone-200 rounded px-1.5 py-0.5">
          {video.duration} 分鐘
        </span>
      </div>
      <p className="mt-2 text-sm text-stone-200 truncate">{video.title}</p>
      <p className="text-[11px] text-stone-500">{video.category}</p>
    </button>
  );
}

// ---------- 播放器彈窗：串接真實的 開始/心跳/結束 API ----------

const HEARTBEAT_MS = 5000; // 展示用途縮短為 5 秒一次，正式環境建議 20~30 秒

function PlayerModal({ video, onClose, authState, onGoLogin, refreshQuota }) {
  const [playing, setPlaying] = useState(false);
  const [session, setSession] = useState(null); // { sessionId, playbackUrl }
  const [remaining, setRemaining] = useState(null);
  const [lockedReason, setLockedReason] = useState(null); // 'quota_exceeded' | 'guest_limit_reached' | null
  const [starting, setStarting] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [purchaseError, setPurchaseError] = useState("");
  const intervalRef = useRef(null);
  const videoRef = useRef(null);
  const hlsRef = useRef(null);

  const token = authState.accessToken;
  const locked = !!lockedReason || (session && remaining !== null && remaining <= 0);

  // 拿到播放 session 後，真的把 HLS 串流接到 <video> 上
  useEffect(() => {
    if (!session?.playbackUrl || !videoRef.current) return;
    const el = videoRef.current;

    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(session.playbackUrl);
      hls.attachMedia(el);
      hlsRef.current = hls;
      return () => hls.destroy();
    }
    if (el.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari 原生支援 HLS，不需要 hls.js
      el.src = session.playbackUrl;
    }
  }, [session]);

  // 額度用完或訪客試看超時：把影片暫停
  useEffect(() => {
    if (locked && videoRef.current) videoRef.current.pause();
  }, [locked]);

  // 開啟時向後端要一個播放 session
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch("/playback/sessions", {
          method: "POST",
          body: { videoId: video.id },
          token,
        });
        if (cancelled) return;
        setSession(data);
        setStarting(false);
      } catch (err) {
        if (cancelled) return;
        setStarting(false);
        setLockedReason(err.code || "start_failed");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.id]);

  // 播放中：每隔 HEARTBEAT_MS 呼叫一次心跳，由後端決定是否還能繼續看
  useEffect(() => {
    if (!playing || !session) return;
    intervalRef.current = setInterval(async () => {
      try {
        const data = await apiFetch(`/playback/sessions/${session.sessionId}/heartbeat`, {
          method: "POST",
          token,
        });
        setRemaining(data.remainingMinutes);
        if (data.remainingMinutes <= 0) {
          setPlaying(false);
        }
      } catch (err) {
        setPlaying(false);
        setLockedReason(err.code || "heartbeat_failed");
      }
    }, HEARTBEAT_MS);
    return () => clearInterval(intervalRef.current);
  }, [playing, session, token]);

  // 關閉彈窗時結束 session
  useEffect(() => {
    return () => {
      if (session) {
        apiFetch(`/playback/sessions/${session.sessionId}/end`, { method: "POST", token }).catch(() => {});
        refreshQuota();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const purchaseExtraHours = async () => {
    setPurchasing(true);
    setPurchaseError("");
    try {
      const order = await apiFetch("/payments/orders", {
        method: "POST",
        token,
        body: { type: "extra_hours", hours: 10, gateway: "ecpay" },
      });
      if (order.type === "ecpay_form") {
        submitEcpayForm(order.action, order.params);
      } else if (order.type === "redirect" && order.url) {
        window.location.href = order.url;
      } else {
        throw new Error("未收到金流導向資訊");
      }
      // 離開頁面前往金流頁，實際發放時數會在付款成功的 webhook 觸發後才生效
    } catch (err) {
      setPurchaseError(err.message || "建立訂單失敗，請確認後端與金流環境變數已設定");
      setPurchasing(false);
    }
  };

  const isGuest = !authState.user;

  return (
    <div className="fixed inset-0 z-40 bg-black/80 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-stone-900 rounded-xl border border-stone-700 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-800">
          <div>
            <p className="text-sm text-stone-100">{video.title}</p>
            <p className="text-[11px] text-stone-500">
              {video.category} · 共 {video.duration} 分鐘
            </p>
          </div>
          <button onClick={onClose} className="text-stone-500 hover:text-stone-200">
            <X size={18} />
          </button>
        </div>

        <div className={`relative aspect-video ${!starting && !locked ? "bg-black" : `bg-gradient-to-br ${video.color}`} flex items-center justify-center`}>
          {starting ? (
            <p className="text-xs text-stone-300">正在向伺服器要求播放授權…</p>
          ) : !locked ? (
            <>
              <video
                ref={videoRef}
                controls
                autoPlay
                className="w-full h-full"
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
              />
              <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-[11px] text-stone-200 pointer-events-none">
                <span className="bg-black/50 rounded px-2 py-1">
                  {playing ? "播放中（伺服器計時）" : "已暫停"}
                </span>
                <span className="bg-black/50 rounded px-2 py-1 flex items-center gap-1">
                  <Clock size={11} />
                  {remaining == null
                    ? isGuest
                      ? "試看剩餘 10 分鐘"
                      : "尚未開始計時"
                    : isGuest
                    ? `試看剩餘 ${remaining} 分鐘`
                    : `本月剩餘 ${fmtMinutes(remaining)}`}
                </span>
              </div>
            </>
          ) : (
            <div className="text-center px-6">
              <Lock size={30} className="mx-auto mb-3 text-amber-500" />
              {isGuest ? (
                <>
                  <p className="text-stone-100 text-sm mb-1">非會員每部影片限看 10 分鐘</p>
                  <p className="text-stone-400 text-xs mb-4">登入或加入會員即可繼續觀看</p>
                  <button
                    onClick={onGoLogin}
                    className="rounded-full bg-amber-600 hover:bg-amber-500 text-stone-950 text-sm font-medium px-5 py-2 transition"
                  >
                    立即登入 / 加入會員
                  </button>
                </>
              ) : (
                <>
                  <p className="text-stone-100 text-sm mb-1">本月觀看時數已用完</p>
                  <p className="text-stone-400 text-xs mb-4">加購 10 小時即可繼續觀看</p>
                  {purchaseError && <p className="text-[11px] text-rose-500 mb-2">{purchaseError}</p>}
                  <button
                    onClick={purchaseExtraHours}
                    disabled={purchasing}
                    className="rounded-full bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-stone-950 text-sm font-medium px-5 py-2 transition"
                  >
                    {purchasing ? "處理中…" : "加購 10 小時"}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- 前台 ----------

function Frontend({ videos, categories, authState, tierConfig, tierIdByLevel, onOpenAdmin, onLogin, onRegister, onLogout, refreshQuota, activeCat, setActiveCat }) {
  const [selectedVideo, setSelectedVideo] = useState(null);
  const grouped = activeCat === "全部" ? categories : [activeCat];

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">
      <header className="sticky top-0 z-20 bg-stone-950/90 backdrop-blur border-b border-stone-800">
        <div className="max-w-6xl mx-auto px-5 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Film className="text-amber-500" size={20} />
              <span className="font-medium tracking-wide text-stone-100">影窩 StreamNest</span>
            </div>
            <nav className="hidden md:flex items-center gap-1">
              {["全部", ...categories].map((c) => (
                <button
                  key={c}
                  onClick={() => setActiveCat(c)}
                  className={`text-xs px-3 py-1.5 rounded-full transition ${
                    activeCat === c
                      ? "bg-amber-700/20 text-amber-400 border border-amber-700/50"
                      : "text-stone-400 hover:text-stone-200"
                  }`}
                >
                  {c}
                </button>
              ))}
            </nav>
          </div>
          <LoginBox
            authState={authState}
            onLogin={onLogin}
            onRegister={onRegister}
            onLogout={onLogout}
            tierConfig={tierConfig}
            tierIdByLevel={tierIdByLevel}
            onOpenAdmin={onOpenAdmin}
          />
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-5 py-6 space-y-10">
        {!authState.user && (
          <div className="rounded-lg border border-amber-800/40 bg-amber-900/10 px-4 py-3 text-xs text-amber-300">
            目前為訪客身份，每部影片可試看 10 分鐘。登入會員享有每月固定時數，時數可累積。
          </div>
        )}

        {grouped.map((cat) => {
          const list = videos.filter((v) => v.category === cat);
          if (list.length === 0) return null;
          return (
            <section key={cat}>
              <h2 className="text-base text-stone-100 mb-3 flex items-center gap-2">
                {cat}
                <span className="text-[11px] text-stone-600">{list.length} 部</span>
              </h2>
              <div className="flex gap-4 overflow-x-auto pb-2">
                {list.map((v) => (
                  <VideoCard key={v.id} video={v} onClick={setSelectedVideo} />
                ))}
              </div>
            </section>
          );
        })}
      </main>

      {selectedVideo && (
        <PlayerModal
          video={selectedVideo}
          onClose={() => setSelectedVideo(null)}
          authState={authState}
          refreshQuota={refreshQuota}
          onGoLogin={() => {
            setSelectedVideo(null);
          }}
        />
      )}
    </div>
  );
}

// ---------- 後台管理（CRUD 端點尚未在骨架中實作，先以本機資料操作，介面已對齊未來 /admin/* API）----------

function AdminPanel({ videos, setVideos, categories, setCategories, tierConfig, setTierConfig, onBack, adminToken, categoryIdByName, tierIdByLevel }) {
  const [tab, setTab] = useState("videos");
  const [newVideo, setNewVideo] = useState({ title: "", category: categories[0], duration: 30, file: null });
  const [newCat, setNewCat] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadStage, setUploadStage] = useState(""); // "" | "uploading" | "transcoding"
  const [error, setError] = useState("");

  // 呼叫真實 /admin/* API；若失敗（例如尚未登入管理員或後端未啟動）就退回本機模擬，
  // 並顯示錯誤訊息，讓畫面在骨架尚未接完整時仍可操作展示。
  // 有選檔案時走完整三步：建立影片紀錄 → 取得簽章網址直傳 S3 → 觸發轉檔（轉檔完成由後端 webhook 把狀態改成 published）。
  const addVideo = async () => {
    if (!newVideo.title.trim()) return;
    setError("");
    const categoryId = categoryIdByName?.[newVideo.category];
    try {
      if (!adminToken || !categoryId) throw new Error("尚未以管理員身份登入，或分類尚未對應到後端 ID");
      setBusy(true);
      const created = await apiFetch("/admin/videos", {
        method: "POST",
        token: adminToken,
        body: { title: newVideo.title.trim(), categoryId, durationMinutes: Number(newVideo.duration) || 1 },
      });

      if (newVideo.file) {
        setUploadStage("uploading");
        const { uploadUrl } = await apiFetch(
          `/admin/videos/${created.id}/upload-url?filename=${encodeURIComponent(newVideo.file.name)}`,
          { token: adminToken },
        );
        await fetch(uploadUrl, { method: "PUT", body: newVideo.file });
        setUploadStage("transcoding");
        await apiFetch(`/admin/videos/${created.id}/start-transcode`, { method: "POST", token: adminToken });
      }

      setVideos((prev) => [
        ...prev,
        { id: created.id, title: created.title, category: newVideo.category, duration: created.durationMinutes, color: COLORS[prev.length % COLORS.length] },
      ]);
    } catch (err) {
      setError(err.message);
      setVideos((prev) => [
        ...prev,
        { id: String(Date.now()), title: newVideo.title.trim(), category: newVideo.category, duration: Number(newVideo.duration) || 1, color: COLORS[prev.length % COLORS.length] },
      ]);
    } finally {
      setBusy(false);
      setUploadStage("");
      setNewVideo({ title: "", category: categories[0], duration: 30, file: null });
    }
  };

  const removeVideo = async (id) => {
    setError("");
    try {
      if (!adminToken) throw new Error("尚未以管理員身份登入");
      await apiFetch(`/admin/videos/${id}`, { method: "DELETE", token: adminToken });
    } catch (err) {
      setError(err.message);
    } finally {
      setVideos((prev) => prev.filter((v) => v.id !== id));
    }
  };

  const addCategory = async () => {
    const c = newCat.trim();
    if (!c || categories.includes(c)) return;
    setError("");
    try {
      if (!adminToken) throw new Error("尚未以管理員身份登入");
      await apiFetch("/admin/categories", { method: "POST", token: adminToken, body: { name: c } });
    } catch (err) {
      setError(err.message);
    } finally {
      setCategories((prev) => [...prev, c]);
      setNewCat("");
    }
  };

  const removeCategory = async (c) => {
    setError("");
    const id = categoryIdByName?.[c];
    try {
      if (!adminToken || !id) throw new Error("尚未以管理員身份登入");
      await apiFetch(`/admin/categories/${id}`, { method: "DELETE", token: adminToken });
    } catch (err) {
      setError(err.message);
    } finally {
      setCategories((prev) => prev.filter((x) => x !== c));
      setVideos((prev) => prev.filter((v) => v.category !== c));
    }
  };

  const saveTierField = async (level, field, value) => {
    setTierConfig((prev) => ({ ...prev, [level]: { ...prev[level], [field]: value } }));
    setError("");
    const tierId = tierIdByLevel?.[level];
    if (!adminToken || !tierId) {
      setError("尚未以管理員身份登入，變更僅存在本機畫面上");
      return;
    }
    try {
      await apiFetch(`/admin/membership-tiers/${tierId}`, {
        method: "PATCH",
        token: adminToken,
        body: field === "hours" ? { monthlyMinutes: value * 60 } : { monthlyPrice: value },
      });
    } catch (err) {
      setError(err.message);
    }
  };

  const saveExtraHourPrice = async (value) => {
    setTierConfig((prev) => ({ ...prev, extraHourPrice: value }));
    setError("");
    if (!adminToken) {
      setError("尚未以管理員身份登入，變更僅存在本機畫面上");
      return;
    }
    try {
      await apiFetch("/admin/extra-hour-price", { method: "PATCH", token: adminToken, body: { price: value } });
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">
      <header className="border-b border-stone-800 px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings size={18} className="text-amber-500" />
          <span className="font-medium">後台管理</span>
        </div>
        <button onClick={onBack} className="text-xs rounded-full border border-stone-700 px-3 py-1.5 hover:bg-stone-800">
          返回前台
        </button>
      </header>

      <div className="max-w-4xl mx-auto px-5 py-6">
        <p className="text-[11px] text-stone-600 mb-4">
          變更會即時呼叫 /admin/* API；若尚未以管理員身份登入或後端未啟動，會先用本機狀態模擬讓畫面照常可操作。
        </p>
        {error && <p className="text-[11px] text-rose-500 mb-4">{error}</p>}
        {!adminToken && (
          <p className="text-[11px] text-amber-500 mb-4">
            尚未偵測到管理員登入（需以 admin 角色登入取得 token），目前變更僅存在本機畫面上。
          </p>
        )}
        <div className="flex gap-2 mb-6">
          {[
            { k: "videos", label: "影片管理" },
            { k: "cats", label: "分類管理" },
            { k: "pricing", label: "方案定價" },
          ].map((t) => (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              className={`text-xs px-4 py-2 rounded-full transition ${
                tab === t.k
                  ? "bg-amber-700/20 text-amber-400 border border-amber-700/50"
                  : "text-stone-400 border border-stone-800 hover:text-stone-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "videos" && (
          <div className="space-y-6">
            <div className="rounded-lg border border-stone-800 p-4 space-y-3">
              <p className="text-sm text-stone-300 mb-1">新增影片</p>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                <input
                  value={newVideo.title}
                  onChange={(e) => setNewVideo((v) => ({ ...v, title: e.target.value }))}
                  placeholder="影片名稱"
                  className="col-span-2 bg-stone-900 border border-stone-700 rounded px-3 py-2 text-sm outline-none focus:border-amber-600"
                />
                <select
                  value={newVideo.category}
                  onChange={(e) => setNewVideo((v) => ({ ...v, category: e.target.value }))}
                  className="bg-stone-900 border border-stone-700 rounded px-3 py-2 text-sm outline-none focus:border-amber-600"
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  value={newVideo.duration}
                  onChange={(e) => setNewVideo((v) => ({ ...v, duration: e.target.value }))}
                  placeholder="片長（分鐘）"
                  className="bg-stone-900 border border-stone-700 rounded px-3 py-2 text-sm outline-none focus:border-amber-600"
                />
                <input
                  type="file"
                  accept="video/*"
                  onChange={(e) => setNewVideo((v) => ({ ...v, file: e.target.files?.[0] || null }))}
                  className="col-span-2 md:col-span-4 text-xs text-stone-400 file:mr-3 file:rounded file:border-0 file:bg-stone-800 file:px-3 file:py-1.5 file:text-xs file:text-stone-200"
                />
              </div>
              <button
                onClick={addVideo}
                disabled={busy}
                className="flex items-center gap-1 text-xs bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-stone-950 font-medium rounded px-3 py-2 transition"
              >
                <Plus size={14} />
                {uploadStage === "uploading" ? "上傳檔案中…" : uploadStage === "transcoding" ? "觸發轉檔中…" : "上架影片"}
              </button>
              <p className="text-[10px] text-stone-600">
                有選檔案時會直接 PUT 到 S3 並觸發 MediaConvert 轉檔；轉檔完成由後端 webhook 把狀態改成「已上架」，本畫面的清單不會即時反映轉檔進度。
              </p>
            </div>

            <div className="rounded-lg border border-stone-800 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-stone-900 text-stone-500">
                  <tr>
                    <th className="text-left px-3 py-2 font-normal">名稱</th>
                    <th className="text-left px-3 py-2 font-normal">分類</th>
                    <th className="text-left px-3 py-2 font-normal">片長</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {videos.map((v) => (
                    <tr key={v.id} className="border-t border-stone-800">
                      <td className="px-3 py-2 text-stone-200">{v.title}</td>
                      <td className="px-3 py-2 text-stone-400">{v.category}</td>
                      <td className="px-3 py-2 text-stone-400">{v.duration} 分鐘</td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => removeVideo(v.id)} className="text-stone-500 hover:text-rose-500">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "cats" && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <input
                value={newCat}
                onChange={(e) => setNewCat(e.target.value)}
                placeholder="新增分類名稱"
                className="bg-stone-900 border border-stone-700 rounded px-3 py-2 text-sm outline-none focus:border-amber-600"
              />
              <button
                onClick={addCategory}
                className="flex items-center gap-1 text-xs bg-amber-600 hover:bg-amber-500 text-stone-950 font-medium rounded px-3 py-2 transition"
              >
                <Plus size={14} /> 新增
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {categories.map((c) => (
                <span key={c} className="flex items-center gap-2 text-xs bg-stone-900 border border-stone-800 rounded-full px-3 py-1.5">
                  {c}
                  <button onClick={() => removeCategory(c)} className="text-stone-500 hover:text-rose-500">
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {tab === "pricing" && (
          <div className="space-y-4">
            {[1, 2, 3].map((t) => (
              <div key={t} className="rounded-lg border border-stone-800 p-4 flex items-center gap-4">
                <span className="text-sm text-amber-400 w-16">第{t}級</span>
                <label className="text-xs text-stone-500 flex items-center gap-2">
                  每月時數
                  <input
                    type="number"
                    value={tierConfig[t].hours}
                    onChange={(e) => saveTierField(t, "hours", Number(e.target.value) || 0)}
                    className="w-20 bg-stone-900 border border-stone-700 rounded px-2 py-1 text-sm outline-none focus:border-amber-600"
                  />
                  小時
                </label>
                <label className="text-xs text-stone-500 flex items-center gap-2">
                  月費
                  <input
                    type="number"
                    value={tierConfig[t].price}
                    onChange={(e) => saveTierField(t, "price", Number(e.target.value) || 0)}
                    className="w-24 bg-stone-900 border border-stone-700 rounded px-2 py-1 text-sm outline-none focus:border-amber-600"
                  />
                  元
                </label>
              </div>
            ))}
            <div className="rounded-lg border border-stone-800 p-4 flex items-center gap-4">
              <span className="text-sm text-stone-300 w-16">加購</span>
              <label className="text-xs text-stone-500 flex items-center gap-2">
                每小時價格
                <input
                  type="number"
                  value={tierConfig.extraHourPrice}
                  onChange={(e) => saveExtraHourPrice(Number(e.target.value) || 0)}
                  className="w-20 bg-stone-900 border border-stone-700 rounded px-2 py-1 text-sm outline-none focus:border-amber-600"
                />
                元
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- App：串接 API，並在 API 無法連線時退回本機示範資料 ----------

export default function App() {
  const [view, setView] = useState("front");
  const [videos, setVideos] = useState(seedVideos);
  const [categories, setCategories] = useState(CATS);
  const [tierConfig, setTierConfig] = useState(defaultTierConfig);
  const [activeCat, setActiveCat] = useState("全部");
  const [authState, setAuthState] = useState({ user: null, accessToken: null, remainingMinutes: null });
  const [usingLiveApi, setUsingLiveApi] = useState(false);
  const [categoryIdByName, setCategoryIdByName] = useState({});
  const [tierIdByLevel, setTierIdByLevel] = useState({});

  // 進站時嘗試向後端拿真實影片與分類，失敗就沿用本機示範資料
  useEffect(() => {
    (async () => {
      try {
        const [cats, vids, tiers] = await Promise.all([
          apiFetch("/categories"),
          apiFetch("/videos"),
          apiFetch("/membership/tiers"),
        ]);
        setCategories(cats.map((c) => c.name));
        setCategoryIdByName(Object.fromEntries(cats.map((c) => [c.name, c.id])));
        setVideos(
          vids.map((v, i) => ({
            id: v.id,
            title: v.title,
            category: v.category?.name ?? v.category,
            duration: v.durationMinutes,
            color: COLORS[i % COLORS.length],
          })),
        );
        setTierIdByLevel(Object.fromEntries(tiers.map((t) => [t.level, t.id])));
        setTierConfig((prev) => {
          const next = { ...prev };
          tiers.forEach((t) => {
            next[t.level] = { hours: t.monthlyMinutes / 60, price: t.monthlyPrice };
          });
          return next;
        });
        setUsingLiveApi(true);
      } catch {
        setUsingLiveApi(false); // 保留 seed 資料，畫面仍可操作與展示
      }
    })();
  }, []);

  const login = async (email, password) => {
    const data = await apiFetch("/auth/login", { method: "POST", body: { email, password } });
    setAuthState({ user: data.user, accessToken: data.accessToken, remainingMinutes: data.user.remainingMinutes ?? null });
  };

  const register = async (email, password, name) => {
    const data = await apiFetch("/auth/register", { method: "POST", body: { email, password, name } });
    setAuthState({ user: data.user, accessToken: data.accessToken, remainingMinutes: data.user.remainingMinutes ?? null });
  };

  const logout = () => setAuthState({ user: null, accessToken: null, remainingMinutes: null });

  const refreshQuota = async () => {
    if (!authState.accessToken) return;
    try {
      const me = await apiFetch("/me", { token: authState.accessToken });
      setAuthState((prev) => ({ ...prev, remainingMinutes: me.remainingMinutes }));
    } catch {
      // 忽略，畫面上維持前一次已知的剩餘時數
    }
  };

  if (view === "admin") {
    return (
      <AdminPanel
        videos={videos}
        setVideos={setVideos}
        categories={categories}
        setCategories={setCategories}
        tierConfig={tierConfig}
        setTierConfig={setTierConfig}
        onBack={() => setView("front")}
        adminToken={authState.user?.role === "admin" ? authState.accessToken : null}
        categoryIdByName={categoryIdByName}
        tierIdByLevel={tierIdByLevel}
      />
    );
  }

  return (
    <div>
      {!usingLiveApi && (
        <div className="bg-stone-800 text-stone-400 text-[11px] text-center py-1">
          目前未連上後端 API（{API_BASE}），畫面使用本機示範資料
        </div>
      )}
      <Frontend
        videos={videos}
        categories={categories}
        authState={authState}
        tierConfig={tierConfig}
        tierIdByLevel={tierIdByLevel}
        onOpenAdmin={() => setView("admin")}
        onLogin={login}
        onRegister={register}
        onLogout={logout}
        refreshQuota={refreshQuota}
        activeCat={activeCat}
        setActiveCat={setActiveCat}
      />
    </div>
  );
}
