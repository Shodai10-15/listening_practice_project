import React, { useState, useRef, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import mascotSitting from "./assets/mascot-sitting.png";
import mascotLying from "./assets/mascot-lying.png";

// ============================================================
// Supabase接続設定
// ============================================================
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const UNIT_META = {
  U3G1: { label: "Unit3-G1", sub: "Anna & Ms. Chen" },
  U3G2: { label: "Unit3-G2", sub: "文房具クイズ" },
};

function speak(text) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return resolve();
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.rate = 0.95;
    u.onend = resolve;
    u.onerror = resolve;
    window.speechSynthesis.speak(u);
  });
}

// 正解した時の「ピコン」という短い8bit風の音
function playCorrectSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = [660, 880, 1320];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      gain.gain.value = 0.06;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const start = ctx.currentTime + i * 0.09;
      osc.start(start);
      gain.gain.setValueAtTime(0.06, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.15);
      osc.stop(start + 0.16);
    });
  } catch (e) {}
}

function normalize(s) {
  return s.toLowerCase().replace(/[.,!?]/g, "").replace(/\s+/g, " ").trim();
}

function wordMatchDetail(recognizedText, target) {
  const wa = normalize(recognizedText).split(" ").filter(Boolean);
  const wb = normalize(target).split(" ").filter(Boolean);
  if (wb.length === 0) return null;
  const setA = new Set(wa);
  const matched = wb.filter((w) => setA.has(w)).length;
  return { matched, total: wb.length, ratio: Math.round((matched / wb.length) * 100) / 100 };
}

const LEVEL_META = {
  dictation: { label: "① ディクテーション" },
  overlap: { label: "② オーバーラッピング" },
  shadow: { label: "③ シャドーイング" },
};
const LEVEL_ORDER = ["dictation", "overlap", "shadow"];

function freshProgress() {
  return { dictation: false, overlap: false, shadow: false, perIndex: 0, perStage: "dictation" };
}

// ---------------- GB風の共通見た目パーツ ----------------

function GlobalPixelStyle() {
  return (
    <style>{`
      @font-face {
        font-family: 'MisakiGothic';
        src: url('https://cdn.leafscape.be/misaki/misaki_gothic_web.woff2') format('woff2');
        font-display: swap;
      }
      html, body, #root { height: 100%; margin: 0; }
      .pxfont { font-family: 'MisakiGothic', 'Hiragino Sans', 'Yu Gothic', sans-serif; letter-spacing: 0.5px; }
      .pxfont-body { font-family: 'Hiragino Sans', 'Yu Gothic', sans-serif; }
      .pxbtn:active { transform: translate(3px, 3px); box-shadow: none !important; }
      .pxbtn:disabled { cursor: not-allowed; }
      .mascot-img { image-rendering: pixelated; image-rendering: -moz-crisp-edges; image-rendering: crisp-edges; }

      @keyframes popIn {
        0% { transform: scale(0.2) translateY(30px); opacity: 0; }
        55% { transform: scale(1.2) translateY(-8px); opacity: 1; }
        75% { transform: scale(0.95) translateY(2px); }
        100% { transform: scale(1) translateY(0); opacity: 1; }
      }
      @keyframes flashBg {
        0% { opacity: 0; }
        15% { opacity: 1; }
        100% { opacity: 1; }
      }
      @keyframes burstOut {
        0% { transform: translate(0,0) scale(0.4) rotate(0deg); opacity: 1; }
        100% { transform: translate(var(--tx), var(--ty)) scale(1.3) rotate(90deg); opacity: 0; }
      }
      @keyframes bannerPulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.08); }
      }
    `}</style>
  );
}

// キャラクターとセリフウィンドウをセットで出すパーツ
function MascotBubble({ image, children, size = 64 }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 16 }}>
      <img src={image} alt="マスコット" className="mascot-img" style={{ width: size, height: size, flexShrink: 0 }} />
      <div style={styles.speechBubble}>
        <p className="pxfont-body" style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: PALETTE.ink }}>
          {children}
        </p>
      </div>
    </div>
  );
}

// 練習画面の隅にいつも居る、小さいマスコット
function CornerMascot() {
  return (
    <img
      src={mascotSitting}
      alt=""
      className="mascot-img"
      style={{ position: "absolute", top: -14, right: -10, width: 46, height: 46, opacity: 0.95 }}
    />
  );
}

// 正解した瞬間に、短時間だけ出る演出
function CelebrationOverlay({ show }) {
  if (!show) return null;
  const stars = [
    { tx: "-60px", ty: "-50px", delay: "0s" },
    { tx: "60px", ty: "-55px", delay: "0.05s" },
    { tx: "-70px", ty: "10px", delay: "0.1s" },
    { tx: "70px", ty: "15px", delay: "0.08s" },
    { tx: "0px", ty: "-70px", delay: "0.03s" },
    { tx: "0px", ty: "60px", delay: "0.12s" },
  ];
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(247, 236, 216, 0.88)",
        animation: "flashBg 0.15s ease-out",
        zIndex: 20,
        pointerEvents: "none",
      }}
    >
      <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center" }}>
        {stars.map((s, i) => (
          <span
            key={i}
            style={{
              position: "absolute",
              top: "40%",
              left: "50%",
              fontSize: 22,
              "--tx": s.tx,
              "--ty": s.ty,
              animation: `burstOut 0.7s ease-out ${s.delay} forwards`,
            }}
          >
            ✦
          </span>
        ))}
        <img
          src={mascotSitting}
          alt=""
          className="mascot-img"
          style={{ width: 88, height: 88, animation: "popIn 0.5s ease-out" }}
        />
        <div
          className="pxfont"
          style={{
            marginTop: 10,
            padding: "8px 16px",
            background: PALETTE.ink,
            color: PALETTE.cream,
            fontSize: 14,
            border: `2px solid ${PALETTE.ink}`,
            animation: "bannerPulse 0.5s ease-in-out 0.2s 2",
          }}
        >
          せいかい！
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [classNo, setClassNo] = useState("");
  const [confirmedClassNo, setConfirmedClassNo] = useState(null);

  const [units, setUnits] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const [screen, setScreen] = useState("units");
  const [unit, setUnit] = useState(null);
  const [level, setLevel] = useState(null);
  const [progress, setProgress] = useState({});

  useEffect(() => {
    if (!confirmedClassNo) return;
    loadSentences();
  }, [confirmedClassNo]);

  async function loadSentences() {
    const { data, error } = await supabase
      .from("sentences")
      .select("*")
      .order("unit", { ascending: true })
      .order("sentence_no", { ascending: true });

    if (error) {
      setLoadError(error.message);
      return;
    }
    const grouped = {};
    for (const row of data) {
      if (!grouped[row.unit]) {
        grouped[row.unit] = {
          id: row.unit,
          label: UNIT_META[row.unit]?.label || row.unit,
          sub: UNIT_META[row.unit]?.sub || "",
          practiceMode: row.practice_mode,
          sentences: [],
        };
      }
      grouped[row.unit].sentences.push(row.correct_text);
    }
    setUnits(Object.values(grouped));
  }

  const unitProgress = unit ? progress[unit.id] || freshProgress() : freshProgress();

  function openUnit(u) {
    setUnit(u);
    setScreen("levels");
  }

  function updateUnitProgress(patch) {
    setProgress((p) => ({ ...p, [unit.id]: { ...(p[unit.id] || freshProgress()), ...patch } }));
  }

  function levelUnlocked(key) {
    if (key === "dictation") return true;
    if (key === "overlap") return !!unitProgress.dictation;
    if (key === "shadow") return !!unitProgress.overlap;
    return false;
  }

  async function recordDictationAnswer({ unitId, sentenceNo, answerText, isCorrect, attemptCount }) {
    await supabase.from("dictation_answers").insert({
      class_no: confirmedClassNo,
      unit: unitId,
      sentence_no: sentenceNo,
      answer_text: answerText,
      is_correct: isCorrect,
      attempt_count: attemptCount,
      completed_at: isCorrect ? new Date().toISOString() : null,
    });
  }

  async function uploadSubmission({ unitId, sentenceNo, level, attemptNo, blob, durationSec, volumeFlag, durationFlag, matchScore }) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `${confirmedClassNo}_${unitId}_${level}_${sentenceNo}_${attemptNo}_${ts}.webm`;
    const path = `${unitId}/${level}/${fileName}`;

    const { error: uploadError } = await supabase.storage.from("recordings").upload(path, blob, {
      contentType: "audio/webm",
    });
    if (uploadError) {
      setLoadError(uploadError.message);
      return;
    }

    await supabase.from("submissions").insert({
      class_no: confirmedClassNo,
      unit: unitId,
      sentence_no: sentenceNo,
      level,
      attempt_no: attemptNo,
      audio_path: path,
      duration_sec: durationSec,
      volume_flag: volumeFlag,
      duration_flag: durationFlag,
      match_score: matchScore,
      is_final: true,
    });
  }

  let inner;
  if (!confirmedClassNo) {
    inner = (
      <div style={styles.card}>
        <MascotBubble image={mascotSitting}>しゅっせきばんごうを おしえてね！</MascotBubble>
        <h1 className="pxfont" style={styles.h1}>出席番号</h1>
        <p style={styles.modeNote}>例：2組15番 → 2-15</p>
        <input
          style={styles.textInput}
          placeholder="2-15"
          value={classNo}
          onChange={(e) => setClassNo(e.target.value)}
        />
        <button
          className="pxbtn pxfont"
          style={styles.primaryBtn}
          onClick={() => classNo.trim() && setConfirmedClassNo(classNo.trim())}
        >
          はじめる
        </button>
      </div>
    );
  } else if (loadError) {
    inner = (
      <div style={styles.card}>
        <p style={{ color: "#b33a3a" }}>データの取得でエラーが出ました：{loadError}</p>
      </div>
    );
  } else if (!units) {
    inner = (
      <div style={styles.card}>
        <p>読み込み中…</p>
      </div>
    );
  } else {
    inner = (
      <div style={styles.card}>
        {screen === "units" && <UnitSelect units={units} onSelect={openUnit} />}

        {screen === "levels" && unit && unit.practiceMode === "block" && (
          <BlockLevelSelect
            unit={unit}
            unitProgress={unitProgress}
            levelUnlocked={levelUnlocked}
            onBack={() => setScreen("units")}
            onSelect={(lvl) => {
              setLevel(lvl);
              setScreen("practice");
            }}
          />
        )}

        {screen === "levels" && unit && unit.practiceMode === "per_sentence" && (
          <PerSentenceHome
            unit={unit}
            unitProgress={unitProgress}
            onBack={() => setScreen("units")}
            onStart={() => setScreen("practice")}
          />
        )}

        {screen === "practice" && unit && unit.practiceMode === "block" && (
          <BlockPractice
            unit={unit}
            level={level}
            onBack={() => setScreen("levels")}
            recordDictationAnswer={recordDictationAnswer}
            uploadSubmission={uploadSubmission}
            onAllComplete={() => {
              updateUnitProgress({ [level]: true });
              setScreen("levels");
            }}
          />
        )}

        {screen === "practice" && unit && unit.practiceMode === "per_sentence" && (
          <PerSentencePractice
            unit={unit}
            progress={unitProgress}
            onBack={() => setScreen("levels")}
            onProgress={(patch) => updateUnitProgress(patch)}
            recordDictationAnswer={recordDictationAnswer}
            uploadSubmission={uploadSubmission}
            onAllComplete={() => {
              updateUnitProgress({ dictation: true, overlap: true, shadow: true });
              setScreen("levels");
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <GlobalPixelStyle />
      <div style={styles.shell}>
        <div style={styles.shellTopRow}>
          <span style={styles.powerDot} />
          <span className="pxfont" style={styles.shellLabel}>LISTENING</span>
        </div>
        <div style={styles.screenBezel}>{inner}</div>
      </div>
    </div>
  );
}

function UnitSelect({ units, onSelect }) {
  return (
    <div>
      <MascotBubble image={mascotSitting}>れんしゅうする たんげんを えらんでね</MascotBubble>
      <div style={styles.grid}>
        {units.map((u) => (
          <button key={u.id} className="pxbtn" style={styles.unitBtn} onClick={() => onSelect(u)}>
            <div className="pxfont" style={styles.unitLabel}>{u.label}</div>
            <div style={styles.unitSub}>{u.sub}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------- ブロック型 ----------------

function BlockLevelSelect({ unit, unitProgress, levelUnlocked, onBack, onSelect }) {
  const allDone = unitProgress.dictation && unitProgress.overlap && unitProgress.shadow;

  return (
    <div>
      <button className="pxbtn" style={styles.backBtn} onClick={onBack}>← もどる</button>
      <h1 className="pxfont" style={styles.h1sm}>{unit.label}</h1>
      <p style={styles.unitSub}>{unit.sub}</p>

      {allDone ? (
        <MascotBubble image={mascotLying}>ぜんぶ おわったね、おつかれさま！</MascotBubble>
      ) : (
        <MascotBubble image={mascotSitting}>じゅんばんに すすめよう</MascotBubble>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {LEVEL_ORDER.map((key) => {
          const meta = LEVEL_META[key];
          const unlocked = levelUnlocked(key);
          const done = !!unitProgress[key];
          return (
            <button
              key={key}
              className="pxbtn"
              disabled={!unlocked}
              style={{
                ...styles.levelBtn,
                opacity: unlocked ? 1 : 0.5,
                cursor: unlocked ? "pointer" : "not-allowed",
                borderColor: done ? PALETTE.ink : PALETTE.tan,
              }}
              onClick={() => unlocked && onSelect(key)}
            >
              <span style={{ flex: 1, textAlign: "left" }}>{meta.label}</span>
              {done && <span className="pxfont" style={styles.doneBadge}>CLEAR</span>}
              {!unlocked && <span style={styles.lockBadge}>🔒</span>}
            </button>
          );
        })}
      </div>
      <p style={styles.modeNote}>ブロック型：1つの活動を全文終えてから次の活動に進みます</p>
    </div>
  );
}

function BlockPractice({ unit, level, onBack, onAllComplete, recordDictationAnswer, uploadSubmission }) {
  const sentences = unit.sentences;
  const [idx, setIdx] = useState(0);

  function advance() {
    if (idx + 1 >= sentences.length) onAllComplete();
    else setIdx(idx + 1);
  }

  const header = `${LEVEL_META[level].label}　（${idx + 1} / ${sentences.length} 文目）`;

  if (level === "dictation") {
    return (
      <SingleDictationView
        heading={header}
        sentence={sentences[idx]}
        onBack={onBack}
        onCorrect={(attemptCount) => {
          recordDictationAnswer({ unitId: unit.id, sentenceNo: idx, answerText: sentences[idx], isCorrect: true, attemptCount });
          advance();
        }}
        buttonLabel={idx + 1 >= sentences.length ? "完了！レベル選択へ" : "次の文へ"}
      />
    );
  }
  return (
    <SingleRecordView
      heading={header}
      sentence={sentences[idx]}
      showText={level === "overlap"}
      onBack={onBack}
      onSubmit={(rec) => {
        uploadSubmission({ unitId: unit.id, sentenceNo: idx, level, ...rec });
        advance();
      }}
      buttonLabel={idx + 1 >= sentences.length ? "聞いて提出する" : "この文はOK・次へ"}
    />
  );
}

// ---------------- 文ごと型 ----------------

function PerSentenceHome({ unit, unitProgress, onBack, onStart }) {
  const total = unit.sentences.length;
  const allDone = !!(unitProgress.dictation && unitProgress.overlap && unitProgress.shadow);
  const finishedCount = allDone ? total : unitProgress.perIndex;

  return (
    <div>
      <button className="pxbtn" style={styles.backBtn} onClick={onBack}>← もどる</button>
      <h1 className="pxfont" style={styles.h1sm}>{unit.label}</h1>
      <p style={styles.unitSub}>{unit.sub}</p>

      {allDone ? (
        <MascotBubble image={mascotLying}>ぜんぶんの れんしゅう おわったよ、すごい！</MascotBubble>
      ) : (
        <MascotBubble image={mascotSitting}>{`${finishedCount} / ${total} 文 完了。つづけよう`}</MascotBubble>
      )}

      <p style={styles.modeNote}>文ごと型：1文につき ディクテーション→オーバーラッピング→シャドーイング を通しでやってから次の文へ進みます</p>
      <button className="pxbtn pxfont" style={styles.primaryBtn} onClick={onStart} disabled={allDone}>
        {allDone ? "全部おわったよ" : unitProgress.perIndex > 0 ? "つづきから" : "はじめる"}
      </button>
    </div>
  );
}

function PerSentencePractice({ unit, progress, onBack, onProgress, onAllComplete, recordDictationAnswer, uploadSubmission }) {
  const sentences = unit.sentences;
  const idx = progress.perIndex;
  const stage = progress.perStage;
  const sentence = sentences[idx];

  const stageLabel = { dictation: "① ディクテーション", overlap: "② オーバーラッピング", shadow: "③ シャドーイング" }[stage];
  const header = `${stageLabel}　（${idx + 1} / ${sentences.length} 文目）`;

  function goNextStage() {
    if (stage === "dictation") onProgress({ perStage: "overlap" });
    else if (stage === "overlap") onProgress({ perStage: "shadow" });
    else if (idx + 1 >= sentences.length) onAllComplete();
    else onProgress({ perIndex: idx + 1, perStage: "dictation" });
  }

  if (stage === "dictation") {
    return (
      <SingleDictationView
        heading={header}
        sentence={sentence}
        onBack={onBack}
        onCorrect={(attemptCount) => {
          recordDictationAnswer({ unitId: unit.id, sentenceNo: idx, answerText: sentence, isCorrect: true, attemptCount });
          goNextStage();
        }}
        buttonLabel="オーバーラッピングへ進む"
      />
    );
  }
  return (
    <SingleRecordView
      heading={header}
      sentence={sentence}
      showText={stage === "overlap"}
      onBack={onBack}
      onSubmit={(rec) => {
        uploadSubmission({ unitId: unit.id, sentenceNo: idx, level: stage, ...rec });
        goNextStage();
      }}
      buttonLabel={stage === "overlap" ? "シャドーイングへ進む" : idx + 1 >= sentences.length ? "聞いて提出する" : "次の文へ"}
    />
  );
}

// ---------------- 共通パーツ ----------------

function SingleDictationView({ heading, sentence, onBack, onCorrect, buttonLabel }) {
  const [input, setInput] = useState("");
  const [status, setStatus] = useState(null);
  const [missCount, setMissCount] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [celebrate, setCelebrate] = useState(false);

  useEffect(() => {
    setInput("");
    setStatus(null);
    setMissCount(0);
    setShowAnswer(false);
    setCelebrate(false);
  }, [sentence]);

  function check() {
    if (normalize(input) === normalize(sentence)) {
      setStatus("correct");
      setCelebrate(true);
      playCorrectSound();
      setTimeout(() => setCelebrate(false), 1100);
    } else {
      setStatus("wrong");
      setMissCount((c) => c + 1);
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <CornerMascot />
      <CelebrationOverlay show={celebrate} />
      <button className="pxbtn" style={styles.backBtn} onClick={onBack}>← もどる</button>
      <h1 className="pxfont" style={styles.h1sm}>{heading}</h1>
      <button className="pxbtn pxfont" style={styles.playBtn} onClick={() => speak(sentence)}>🔊 きく</button>
      <textarea
        style={styles.textarea}
        placeholder="聞こえた英文を入力しよう"
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          setStatus(null);
        }}
      />
      {status === "correct" && <div style={{ ...styles.feedback, background: PALETTE.cream, borderColor: PALETTE.ink, color: PALETTE.ink }}>◯ 正解！</div>}
      {status === "wrong" && <div style={{ ...styles.feedback, background: "#f6dede", borderColor: "#b33a3a", color: "#8a2c2c" }}>✗ ちがうよ。もう一度聞いて挑戦しよう</div>}
      {missCount >= 5 && !showAnswer && (
        <button className="pxbtn" style={styles.hintBtn} onClick={() => setShowAnswer(true)}>答えを見る（5回間違えたので）</button>
      )}
      {showAnswer && <div style={styles.answerBox}>{sentence}</div>}
      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        {status !== "correct" ? (
          <button className="pxbtn pxfont" style={styles.primaryBtn} onClick={check} disabled={!input.trim()}>答え合わせ</button>
        ) : (
          <button className="pxbtn pxfont" style={styles.primaryBtn} onClick={() => onCorrect(missCount + 1)}>{buttonLabel}</button>
        )}
      </div>
    </div>
  );
}

function SingleRecordView({ heading, sentence, showText, onBack, onSubmit, buttonLabel }) {
  const [attempts, setAttempts] = useState(0);
  const [recording, setRecording] = useState(false);
  const [flags, setFlags] = useState([]);
  const [lastRec, setLastRec] = useState(null);
  const [history, setHistory] = useState([]);
  const [micError, setMicError] = useState(null);

  useEffect(() => {
    setAttempts(0);
    setFlags([]);
    setLastRec(null);
    setHistory([]);
    setMicError(null);
  }, [sentence, showText]);

  const canSubmit = attempts >= 3;

  async function startAttempt() {
    setFlags([]);
    setMicError(null);
    setRecording(true);

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (e) {
      setMicError("マイクが使えませんでした。マイクの許可を確認してください。");
      setRecording(false);
      return;
    }

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioCtx.createAnalyser();
    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const volumeSamples = [];
    const volumeTimer = setInterval(() => {
      analyser.getByteFrequencyData(dataArray);
      const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      volumeSamples.push(avg);
    }, 200);

    let recognizedText = "";
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognizer = null;
    if (SR) {
      recognizer = new SR();
      recognizer.lang = "en-US";
      recognizer.continuous = true;
      recognizer.interimResults = false;
      recognizer.onresult = (e) => {
        for (let i = 0; i < e.results.length; i++) recognizedText += " " + e.results[i][0].transcript;
      };
      recognizer.start();
    }

    const chunks = [];
    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => chunks.push(e.data);

    const startTime = Date.now();
    recorder.start();

    const ttsStart = performance.now();
    await speak(sentence);
    const ttsDurationSec = (performance.now() - ttsStart) / 1000;

    await new Promise((resolve) => setTimeout(resolve, 1000));

    recorder.stop();
    if (recognizer) recognizer.stop();
    clearInterval(volumeTimer);

    await new Promise((resolve) => { recorder.onstop = resolve; });

    stream.getTracks().forEach((t) => t.stop());
    audioCtx.close();

    const durationSec = (Date.now() - startTime) / 1000;
    const avgVolume = volumeSamples.length ? volumeSamples.reduce((a, b) => a + b, 0) / volumeSamples.length : 0;
    const activeSpeechSec = volumeSamples.filter((v) => v > 12).length * 0.2;

    const volumeFlag = avgVolume < 8;
    const durationFlag = durationSec < ttsDurationSec * 0.5;
    const wordMatch = recognizer ? wordMatchDetail(recognizedText, sentence) : null;

    const blob = new Blob(chunks, { type: "audio/webm" });

    const newFlags = [];
    if (volumeFlag) newFlags.push("音が小さいかも");
    if (durationFlag) newFlags.push("時間が短いかも");

    const attemptNo = attempts + 1;
    const record = { attemptNo, wordMatch, activeSpeechSec, ttsDurationSec };

    setFlags(newFlags);
    setHistory((h) => [...h, record]);
    setLastRec({ blob, durationSec, volumeFlag, durationFlag, matchScore: wordMatch ? wordMatch.ratio : null });
    setAttempts(attemptNo);
    setRecording(false);
  }

  function handleSubmit() {
    if (!lastRec) return;
    onSubmit({
      attemptNo: attempts,
      blob: lastRec.blob,
      durationSec: lastRec.durationSec,
      volumeFlag: lastRec.volumeFlag,
      durationFlag: lastRec.durationFlag,
      matchScore: lastRec.matchScore,
    });
  }

  return (
    <div style={{ position: "relative" }}>
      <CornerMascot />
      <button className="pxbtn" style={styles.backBtn} onClick={onBack}>← もどる</button>
      <h1 className="pxfont" style={styles.h1sm}>{heading}</h1>

      {showText ? (
        <div style={styles.sentenceBox}>{sentence}</div>
      ) : (
        <div style={{ ...styles.sentenceBox, color: PALETTE.tanDark }}>（文字なし・音声だけをたよりに）</div>
      )}

      <button
        className="pxbtn pxfont"
        style={{ ...styles.playBtn, background: recording ? "#c94a4a" : styles.playBtn.background }}
        onClick={startAttempt}
        disabled={recording}
      >
        {recording ? "● ろくおんちゅう…" : "🔊 きいて ろくおん"}
      </button>

      <p style={styles.progressText}>録音 {attempts} / 3 回</p>

      {micError && <div style={{ ...styles.feedback, background: "#f6dede", borderColor: "#b33a3a", color: "#8a2c2c" }}>{micError}</div>}
      {flags.length > 0 && (
        <div style={{ ...styles.feedback, background: "#fbeecb", borderColor: PALETTE.tanDark, color: "#7a5a1e" }}>
          {flags.join(" / ")}。もう一度録ってみよう
        </div>
      )}

      <FeedbackPanel history={history} />

      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        {canSubmit ? (
          <button className="pxbtn pxfont" style={styles.primaryBtn} onClick={handleSubmit}>{buttonLabel}</button>
        ) : (
          <div style={styles.hintText}>あと{3 - attempts}回、録音してみよう</div>
        )}
      </div>
    </div>
  );
}

function FeedbackPanel({ history }) {
  if (history.length === 0) return null;
  const latest = history[history.length - 1];
  const first = history[0];

  const tempoGap = Math.abs(latest.activeSpeechSec - latest.ttsDurationSec);
  const tempoText =
    tempoGap < 0.4
      ? "テンポ：お手本とほぼ同じ速さだったよ！"
      : latest.activeSpeechSec > latest.ttsDurationSec
      ? `テンポ：お手本より${tempoGap.toFixed(1)}秒長かったよ`
      : `テンポ：お手本より${tempoGap.toFixed(1)}秒短かったよ`;

  const wordText = latest.wordMatch
    ? `単語：${latest.wordMatch.total}語中${latest.wordMatch.matched}語 聞き取れたよ！`
    : null;

  const showGrowth = history.length >= 2;
  const firstTempoGap = Math.abs(first.activeSpeechSec - first.ttsDurationSec);
  const growthLines = [];
  if (showGrowth && first.wordMatch && latest.wordMatch) {
    const diff = latest.wordMatch.matched - first.wordMatch.matched;
    if (diff > 0) growthLines.push(`1回目より${diff}語多く聞き取れたよ`);
    else if (diff === 0) growthLines.push("1回目と同じくらい聞き取れてるよ");
  }
  if (showGrowth && tempoGap < firstTempoGap - 0.1) {
    growthLines.push("テンポもお手本に近づいてきたね");
  }

  return (
    <div style={styles.feedbackPanel}>
      {wordText && <p style={{ margin: "0 0 6px", fontSize: 13, color: PALETTE.ink }}>{wordText}</p>}
      <p style={{ margin: "0 0 6px", fontSize: 13, color: PALETTE.ink }}>{tempoText}</p>
      {growthLines.map((line, i) => (
        <p key={i} style={{ margin: "6px 0 0", fontSize: 13, color: "#2f7a4d", fontWeight: 700 }}>
          ✨ {line}
        </p>
      ))}
    </div>
  );
}

// ---------------- GB風カラーパレット ----------------
const PALETTE = {
  bg: "#241f38",
  shellBody: "#8a86a8",     // ゲーム機本体のプラスチック色
  shellBodyDark: "#6d698a",
  screenEdge: "#14213d",
  cream: "#f7ecd8",
  tan: "#d8b98a",
  tanDark: "#a9865a",
  ink: "#1f2233",
};

const styles = {
  page: {
    minHeight: "100vh",
    width: "100%",
    boxSizing: "border-box",
    background: PALETTE.bg,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px 12px",
    fontFamily: "'Hiragino Sans', 'Yu Gothic', sans-serif",
  },
  shell: {
    width: "100%",
    maxWidth: 500,
    background: PALETTE.shellBody,
    borderRadius: 28,
    padding: "18px 18px 26px",
    boxShadow: `0 10px 0 ${PALETTE.shellBodyDark}, 0 14px 24px rgba(0,0,0,0.35)`,
  },
  shellTopRow: { display: "flex", alignItems: "center", gap: 8, padding: "2px 6px 14px" },
  powerDot: { width: 8, height: 8, borderRadius: "50%", background: "#e0453f", boxShadow: "0 0 4px #e0453f" },
  shellLabel: { fontSize: 10, color: "#3b3752" },
  screenBezel: {
    background: PALETTE.screenEdge,
    borderRadius: 10,
    padding: 10,
  },
  card: {
    width: "100%",
    maxHeight: "78vh",
    overflowY: "auto",
    boxSizing: "border-box",
    background: PALETTE.cream,
    border: `4px solid ${PALETTE.ink}`,
    padding: "22px 20px",
    position: "relative",
  },
  h1: { fontSize: 15, lineHeight: 1.8, margin: "0 0 14px", color: PALETTE.ink },
  h1sm: { fontSize: 13, lineHeight: 1.8, margin: "0 0 10px", color: PALETTE.ink },
  h1sub: { fontSize: 14, fontWeight: 400, color: PALETTE.tanDark, marginLeft: 8 },
  grid: { display: "flex", flexDirection: "column", gap: 12 },
  unitBtn: {
    textAlign: "left",
    padding: "14px 16px",
    border: `3px solid ${PALETTE.ink}`,
    boxShadow: `3px 3px 0 ${PALETTE.tanDark}`,
    background: "#fff",
    cursor: "pointer",
  },
  unitLabel: { fontSize: 12, color: PALETTE.ink, marginBottom: 6 },
  unitSub: { fontSize: 13, color: PALETTE.tanDark, marginTop: 2, marginBottom: 12 },
  backBtn: {
    background: "none",
    border: "none",
    color: PALETTE.ink,
    fontSize: 14,
    padding: 0,
    marginBottom: 14,
    cursor: "pointer",
    textDecoration: "underline",
  },
  levelBtn: {
    display: "flex",
    alignItems: "center",
    padding: "14px 16px",
    border: `3px solid ${PALETTE.tan}`,
    boxShadow: `3px 3px 0 ${PALETTE.tanDark}`,
    background: "#fff",
    fontSize: 14,
  },
  doneBadge: { fontSize: 10, background: PALETTE.ink, color: PALETTE.cream, padding: "4px 8px" },
  lockBadge: { fontSize: 14 },
  progressText: { fontSize: 13, color: PALETTE.tanDark, marginBottom: 14 },
  modeNote: { fontSize: 12, color: PALETTE.tanDark, marginTop: 16, marginBottom: 16, lineHeight: 1.6 },
  playBtn: {
    width: "100%",
    padding: "14px 0",
    border: `3px solid ${PALETTE.ink}`,
    boxShadow: `3px 3px 0 ${PALETTE.ink}`,
    background: PALETTE.tan,
    color: PALETTE.ink,
    fontSize: 13,
    cursor: "pointer",
    marginBottom: 14,
  },
  textarea: {
    width: "100%",
    minHeight: 70,
    border: `2px solid ${PALETTE.ink}`,
    padding: 12,
    fontSize: 15,
    boxSizing: "border-box",
    resize: "vertical",
    fontFamily: "'Hiragino Sans', 'Yu Gothic', sans-serif",
  },
  textInput: {
    width: "100%",
    padding: "12px 14px",
    border: `2px solid ${PALETTE.ink}`,
    fontSize: 15,
    boxSizing: "border-box",
    marginBottom: 14,
  },
  sentenceBox: {
    padding: "18px 16px",
    border: `2px dashed ${PALETTE.tanDark}`,
    background: "#fffaf0",
    fontSize: 16,
    marginBottom: 14,
    lineHeight: 1.6,
  },
  feedback: { padding: "10px 14px", border: "2px solid", fontSize: 14, marginTop: 12 },
  feedbackPanel: { marginTop: 12, padding: "12px 14px", border: `2px solid ${PALETTE.tan}`, background: "#fffaf0" },
  hintBtn: {
    marginTop: 10,
    background: "#fff",
    border: `2px solid ${PALETTE.tanDark}`,
    padding: "8px 12px",
    fontSize: 13,
    color: "#7a5a1e",
    cursor: "pointer",
  },
  answerBox: { marginTop: 10, padding: "10px 14px", border: `2px solid ${PALETTE.ink}`, background: "#fff", color: PALETTE.ink, fontSize: 14 },
  primaryBtn: {
    flex: 1,
    padding: "13px 0",
    border: `3px solid ${PALETTE.ink}`,
    boxShadow: `3px 3px 0 ${PALETTE.ink}`,
    background: PALETTE.ink,
    color: PALETTE.cream,
    fontSize: 12,
    cursor: "pointer",
  },
  hintText: { fontSize: 13, color: PALETTE.tanDark, padding: "10px 0" },
  speechBubble: {
    flex: 1,
    border: `2px solid ${PALETTE.ink}`,
    background: "#fff",
    padding: "10px 12px",
    position: "relative",
  },
};

