import React, { useState, useRef, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

// ============================================================
// Supabase接続設定
// Vercelの環境変数に VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY を
// 設定してください（Supabaseのプロジェクト設定 > API から取得）
// ============================================================
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// 単元の表示名（英文本体・practice_modeはSupabaseから取得）
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
  dictation: { label: "① ディクテーション", icon: "✍️" },
  overlap: { label: "② オーバーラッピング", icon: "🗣" },
  shadow: { label: "③ シャドーイング", icon: "👥" },
};
const LEVEL_ORDER = ["dictation", "overlap", "shadow"];

function freshProgress() {
  return { dictation: false, overlap: false, shadow: false, perIndex: 0, perStage: "dictation" };
}

export default function App() {
  const [classNo, setClassNo] = useState("");
  const [confirmedClassNo, setConfirmedClassNo] = useState(null);

  const [units, setUnits] = useState(null); // Supabaseから取得
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

  // ---- Supabase書き込み ----
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

  if (!confirmedClassNo) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <h1 style={styles.h1}>出席番号を入力してね</h1>
          <p style={styles.modeNote}>例：2組15番 → 2-15</p>
          <input
            style={styles.textInput}
            placeholder="2-15"
            value={classNo}
            onChange={(e) => setClassNo(e.target.value)}
          />
          <button
            style={styles.primaryBtn}
            onClick={() => classNo.trim() && setConfirmedClassNo(classNo.trim())}
          >
            はじめる
          </button>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <p style={{ color: "#b33a3a" }}>データの取得でエラーが出ました：{loadError}</p>
        </div>
      </div>
    );
  }

  if (!units) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <p>読み込み中…</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
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
    </div>
  );
}

function UnitSelect({ units, onSelect }) {
  return (
    <div>
      <h1 style={styles.h1}>練習する単元をえらぼう</h1>
      <div style={styles.grid}>
        {units.map((u) => (
          <button key={u.id} style={styles.unitBtn} onClick={() => onSelect(u)}>
            <div style={styles.unitLabel}>{u.label}</div>
            <div style={styles.unitSub}>{u.sub}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------- ブロック型 ----------------

function BlockLevelSelect({ unit, unitProgress, levelUnlocked, onBack, onSelect }) {
  return (
    <div>
      <button style={styles.backBtn} onClick={onBack}>← もどる</button>
      <h1 style={styles.h1}>{unit.label} <span style={styles.h1sub}>{unit.sub}</span></h1>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {LEVEL_ORDER.map((key) => {
          const meta = LEVEL_META[key];
          const unlocked = levelUnlocked(key);
          const done = !!unitProgress[key];
          return (
            <button
              key={key}
              disabled={!unlocked}
              style={{
                ...styles.levelBtn,
                opacity: unlocked ? 1 : 0.45,
                cursor: unlocked ? "pointer" : "not-allowed",
                borderColor: done ? "#2f9e6f" : "#d8d3c4",
              }}
              onClick={() => unlocked && onSelect(key)}
            >
              <span style={{ fontSize: 22 }}>{meta.icon}</span>
              <span style={{ flex: 1, textAlign: "left", marginLeft: 12 }}>{meta.label}</span>
              {done && <span style={styles.doneBadge}>提出ずみ</span>}
              {!unlocked && <span style={styles.lockBadge}>🔒 まだ</span>}
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
      <button style={styles.backBtn} onClick={onBack}>← もどる</button>
      <h1 style={styles.h1}>{unit.label} <span style={styles.h1sub}>{unit.sub}</span></h1>
      <p style={styles.progressText}>{allDone ? `全${total}文 完了！` : `${finishedCount} / ${total} 文 完了`}</p>
      <p style={styles.modeNote}>文ごと型：1文につき ディクテーション→オーバーラッピング→シャドーイング を通しでやってから次の文へ進みます</p>
      <button style={styles.primaryBtn} onClick={onStart} disabled={allDone}>
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

  useEffect(() => {
    setInput("");
    setStatus(null);
    setMissCount(0);
    setShowAnswer(false);
  }, [sentence]);

  function check() {
    if (normalize(input) === normalize(sentence)) setStatus("correct");
    else {
      setStatus("wrong");
      setMissCount((c) => c + 1);
    }
  }

  return (
    <div>
      <button style={styles.backBtn} onClick={onBack}>← もどる</button>
      <h1 style={styles.h1}>{heading}</h1>
      <button style={styles.playBtn} onClick={() => speak(sentence)}>🔊 音声を聞く</button>
      <textarea
        style={styles.textarea}
        placeholder="聞こえた英文を入力しよう"
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          setStatus(null);
        }}
      />
      {status === "correct" && <div style={{ ...styles.feedback, background: "#e5f5ec", color: "#1c7a4d" }}>◯ 正解！</div>}
      {status === "wrong" && <div style={{ ...styles.feedback, background: "#fdecec", color: "#b33a3a" }}>✗ ちがうよ。もう一度聞いて挑戦しよう</div>}
      {missCount >= 5 && !showAnswer && (
        <button style={styles.hintBtn} onClick={() => setShowAnswer(true)}>答えを見る（5回間違えたので）</button>
      )}
      {showAnswer && <div style={styles.answerBox}>{sentence}</div>}
      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        {status !== "correct" ? (
          <button style={styles.primaryBtn} onClick={check} disabled={!input.trim()}>答え合わせ</button>
        ) : (
          <button style={styles.primaryBtn} onClick={() => onCorrect(missCount + 1)}>{buttonLabel}</button>
        )}
      </div>
    </div>
  );
}

function SingleRecordView({ heading, sentence, showText, onBack, onSubmit, buttonLabel }) {
  const [attempts, setAttempts] = useState(0);
  const [recording, setRecording] = useState(false);
  const [flags, setFlags] = useState([]);
  const [lastRec, setLastRec] = useState(null); // 提出用データ
  const [history, setHistory] = useState([]); // フィードバック用の全試行履歴
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
    const volumeSamples = []; // 0.2秒ごとの音量を全部記録(平均チェック＋発話時間の推定に使う)
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
    await speak(sentence); // 音声再生と同時に録音中
    const ttsDurationSec = (performance.now() - ttsStart) / 1000;

    await new Promise((resolve) => setTimeout(resolve, 1000)); // 読み終わりに1秒の余裕

    recorder.stop();
    if (recognizer) recognizer.stop();
    clearInterval(volumeTimer);

    await new Promise((resolve) => { recorder.onstop = resolve; });

    stream.getTracks().forEach((t) => t.stop());
    audioCtx.close();

    const durationSec = (Date.now() - startTime) / 1000;
    const avgVolume = volumeSamples.length ? volumeSamples.reduce((a, b) => a + b, 0) / volumeSamples.length : 0;
    const activeSpeechSec = volumeSamples.filter((v) => v > 12).length * 0.2; // 声が出ていたおおよその時間

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
    <div>
      <button style={styles.backBtn} onClick={onBack}>← もどる</button>
      <h1 style={styles.h1}>{heading}</h1>

      {showText ? (
        <div style={styles.sentenceBox}>{sentence}</div>
      ) : (
        <div style={{ ...styles.sentenceBox, color: "#a89f8a" }}>（文字なし・音声だけをたよりに）</div>
      )}

      <button
        style={{ ...styles.playBtn, background: recording ? "#e24b4a" : styles.playBtn.background }}
        onClick={startAttempt}
        disabled={recording}
      >
        {recording ? "● 録音中…（音声を聞きながら声に出そう）" : "🔊 音声を聞いて録音する"}
      </button>

      <p style={styles.progressText}>録音 {attempts} / 3 回</p>

      {micError && <div style={{ ...styles.feedback, background: "#fdecec", color: "#b33a3a" }}>{micError}</div>}
      {flags.length > 0 && (
        <div style={{ ...styles.feedback, background: "#fff6e5", color: "#8a5a00" }}>
          {flags.join(" / ")}。もう一度録ってみよう
        </div>
      )}

      <FeedbackPanel history={history} />

      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        {canSubmit ? (
          <button style={styles.primaryBtn} onClick={handleSubmit}>{buttonLabel}</button>
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
    <div style={{ marginTop: 12, padding: "12px 14px", borderRadius: 12, background: "#eef2fb" }}>
      {wordText && <p style={{ margin: "0 0 6px", fontSize: 14, color: "#1e4e8c" }}>{wordText}</p>}
      <p style={{ margin: "0 0 6px", fontSize: 14, color: "#1e4e8c" }}>{tempoText}</p>
      {growthLines.map((line, i) => (
        <p key={i} style={{ margin: "6px 0 0", fontSize: 14, color: "#1c7a4d", fontWeight: 700 }}>
          ✨ {line}
        </p>
      ))}
    </div>
  );
}

const styles = {
  page: { minHeight: 560, background: "#f4f1ea", display: "flex", justifyContent: "center", padding: "24px 12px", fontFamily: "'Hiragino Sans', 'Yu Gothic', sans-serif" },
  card: { width: "100%", maxWidth: 460, background: "#ffffff", borderRadius: 20, padding: "24px 22px", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" },
  h1: { fontSize: 20, fontWeight: 700, margin: "0 0 14px", color: "#2c2c2a" },
  h1sub: { fontSize: 14, fontWeight: 400, color: "#8a8578", marginLeft: 8 },
  grid: { display: "flex", flexDirection: "column", gap: 12 },
  unitBtn: { textAlign: "left", padding: "16px 18px", borderRadius: 14, border: "1px solid #e2ddd0", background: "#faf8f3", cursor: "pointer" },
  unitLabel: { fontSize: 16, fontWeight: 700, color: "#2c2c2a" },
  unitSub: { fontSize: 13, color: "#8a8578", marginTop: 2 },
  backBtn: { background: "none", border: "none", color: "#0f6e56", fontSize: 14, padding: 0, marginBottom: 14, cursor: "pointer" },
  levelBtn: { display: "flex", alignItems: "center", padding: "14px 16px", borderRadius: 14, border: "2px solid #d8d3c4", background: "#fff", fontSize: 15 },
  doneBadge: { fontSize: 12, background: "#e5f5ec", color: "#1c7a4d", padding: "3px 10px", borderRadius: 8 },
  lockBadge: { fontSize: 12, color: "#a89f8a" },
  progressText: { fontSize: 13, color: "#8a8578", marginBottom: 14 },
  modeNote: { fontSize: 12, color: "#a89f8a", marginTop: 16 },
  playBtn: { width: "100%", padding: "14px 0", borderRadius: 14, border: "none", background: "#0f6e56", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", marginBottom: 14 },
  textarea: { width: "100%", minHeight: 70, borderRadius: 12, border: "1px solid #d8d3c4", padding: 12, fontSize: 15, boxSizing: "border-box", resize: "vertical" },
  textInput: { width: "100%", padding: "12px 14px", borderRadius: 12, border: "1px solid #d8d3c4", fontSize: 15, boxSizing: "border-box", marginBottom: 14 },
  sentenceBox: { padding: "18px 16px", borderRadius: 12, background: "#f4f1ea", fontSize: 16, marginBottom: 14, lineHeight: 1.6 },
  feedback: { padding: "10px 14px", borderRadius: 10, fontSize: 14, marginTop: 12 },
  hintBtn: { marginTop: 10, background: "none", border: "1px solid #d8d3c4", borderRadius: 10, padding: "8px 12px", fontSize: 13, color: "#8a5a00", cursor: "pointer" },
  answerBox: { marginTop: 10, padding: "10px 14px", borderRadius: 10, background: "#eef2fb", color: "#1e4e8c", fontSize: 14 },
  primaryBtn: { flex: 1, padding: "12px 0", borderRadius: 12, border: "none", background: "#2c2c2a", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer" },
  hintText: { fontSize: 13, color: "#8a8578", padding: "10px 0" },
};
