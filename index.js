const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const math = require("mathjs");
const { GoogleGenerativeAI } = require("@google/generative-ai");

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "models/gemini-1.5-flash" });

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`GEMINI CHATBOT Server is running at http://localhost:${PORT}`);
});

// Fungsi menghitung nilai masa depan
function hitungFutureValue(pv, r, n) {
  return pv * Math.pow(1 + r, n);
}

// Fungsi menghitung lama pelunasan kewajiban
function hitungLamaBayar(FV, A, r) {
  const n = Math.log((FV * r) / A + 1) / Math.log(1 + r);
  return Math.ceil(n);
}

// Fungsi membaca kolom pertama dari file CSV
function bacaCSVKolom(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    let isFirstRow = true;

    fs.createReadStream(filePath)
      .pipe(csv({ headers: false }))
      .on("data", (row) => {
        if (isFirstRow) {
          isFirstRow = false;
          return; // Lewati header
        }
        const val = parseFloat(row[0]);
        if (!isNaN(val)) results.push(val);
      })
      .on("end", () => {
        resolve([results]); // Kembalikan dalam bentuk array of array
      })
      .on("error", reject);
  });
}

function hitungSharpeRatio(returns, rf) {
  const avgReturn = math.mean(returns);
  const stdDev = math.std(returns);
  return (avgReturn - rf) / stdDev;
}

function hitungVaR(returns, confidenceLevel, nominal) {
  const sorted = [...returns].sort((a, b) => a - b);
  const index = Math.floor((1 - confidenceLevel) * sorted.length);
  const varReturn = sorted[index];
  return nominal * -varReturn;
}

let investasiState = {};

app.post("/api/chat", async (req, res) => {
  const rawMessage = req.body.message;
  if (typeof rawMessage !== "string" || rawMessage.trim() === "") {
    return res.json({ reply: "⚠️ Pesan tidak boleh kosong." });
  }

  const userMessage = rawMessage.trim();
  const lowerMessage = userMessage.toLowerCase();

  try {
    if (
      lowerMessage.includes("halo") ||
      lowerMessage.includes("hai") ||
      lowerMessage.includes("bantu") ||
      lowerMessage.includes("mulai") ||
      lowerMessage === "1" ||
      lowerMessage === "2" ||
      lowerMessage === "3"
    ) {
      investasiState = {};

      if (lowerMessage === "1") {
        const folderPath = path.join(__dirname, "saham");
        const files = fs
          .readdirSync(folderPath)
          .filter((f) => f.endsWith(".csv") && f !== "semua_saham.csv")
          .map((f) => f.replace(".csv", ""));

        investasiState = {
          stage: "askFiles",
          availableFiles: files,
        };
        return res.json({
          reply: `📂 Pilih saham yang ingin dianalisis (pisahkan dengan koma):\n${files.join(
            ", "
          )}`,
        });
      }

      if (lowerMessage === "2") {
        investasiState = { stage: "menabung-nominal" };
        return res.json({
          reply:
            "💰 Silakan masukkan nominal dan jumlah bulan tabungan.\n💡 Contoh: Menabung Rp1000000 selama 12 bulan",
        });
      }

      if (lowerMessage === "3") {
        investasiState = { stage: "kewajiban" };
        return res.json({
          reply:
            "📅 Masukkan kewajiban dan angsuran.\n💡 Contoh: Kewajiban Rp5000000 dengan angsuran Rp1000000",
        });
      }

      return res.json({
        reply: `🤖 Hai! Saya siap membantu Anda dalam perencanaan keuangan. Pilih salah satu opsi berikut:<br/>\n<strong>1.</strong> Investasi Saham<br/>\n<strong>2.</strong> Menabung Uang<br/>\n<strong>3.</strong> Membayar Kewajiban<br/>\nKetik <strong>1</strong>, <strong>2</strong>, atau <strong>3</strong> untuk melanjutkan.`,
      });
    }

    if (investasiState.stage === "askFiles") {
      const selected = userMessage.split(",").map((f) => f.trim());
      const valid = selected.every((f) =>
        investasiState.availableFiles.includes(f)
      );
      if (!valid)
        return res.json({ reply: "❌ Salah satu nama saham tidak valid." });

      investasiState.selectedFiles = selected;
      investasiState.stage = "askNominal";
      return res.json({ reply: "Berapa nominal investasi (Rp)?" });
    }

    if (investasiState.stage === "askNominal") {
      const nominal = parseFloat(userMessage.replace(/\D/g, ""));
      if (isNaN(nominal)) return res.json({ reply: "⚠️ Nominal tidak valid." });

      investasiState.nominal = nominal;
      investasiState.stage = "askPeriode";
      return res.json({ reply: "Berapa lama periode investasi (hari)?" });
    }

    if (investasiState.stage === "askPeriode") {
      const periode = parseInt(userMessage);
      if (isNaN(periode)) return res.json({ reply: "⚠️ Periode tidak valid." });
      investasiState.periode = periode;

      const rf = 0.0575 / 252;

      console.log("📥 Mulai membaca semua returns dari file CSV...");

      const returnsPerSaham = await Promise.all(
        investasiState.selectedFiles.map((saham) =>
          bacaCSVKolom(path.join(__dirname, "saham", `${saham}.csv`)).then(
            (data) => {
              if (!data[0] || data[0].length === 0)
                throw new Error(`Data kosong untuk ${saham}`);
              return data[0];
            }
          )
        )
      );

      const simulations = 100;
      const portfolios = [];

      for (let i = 0; i < simulations; i++) {
        const weights = returnsPerSaham.map(() => Math.random());
        const total = weights.reduce((a, b) => a + b, 0);
        const norm = weights.map((w) => w / total);
        const portfolioReturns = returnsPerSaham[0].map((_, idx) =>
          returnsPerSaham.reduce((sum, r, j) => sum + r[idx] * norm[j], 0)
        );
        const sharpe = hitungSharpeRatio(portfolioReturns, rf);
        portfolios.push({ weights: norm, sharpe });
      }

      portfolios.sort((a, b) => b.sharpe - a.sharpe);
      const best = portfolios[0];
      const propReturns = returnsPerSaham[0].map((_, idx) =>
        returnsPerSaham.reduce((sum, r, j) => sum + r[idx] * best.weights[j], 0)
      );
      const VaR = hitungVaR(propReturns, 0.99, investasiState.nominal);

      let reply = `📊 Proporsi terbaik ditemukan.\n📉 VaR (99%) dari Rp${investasiState.nominal.toLocaleString()} untuk ${
        investasiState.periode
      } hari: Rp${VaR.toFixed(2).toLocaleString()}\n`;

      let totalShort = 0;
      const detail = best.weights.map((w, i) => {
        const nama = investasiState.selectedFiles[i];
        const persen = (w * 100).toFixed(2);
        if (w < 0) totalShort += -w * investasiState.nominal;
        return `📈 ${nama}: ${persen}%`;
      });

      reply += detail.join("\n");

      if (totalShort > 0) {
        investasiState.bestWeights = best.weights;
        investasiState.stage = "askRemoveShort";
        return res.json({
          reply: `${reply}\n⚠️ Terdapat short selling sebesar Rp${totalShort
            .toFixed(2)
            .toLocaleString()}. Hapus saham proporsi negatif? (ya/tidak)`,
        });
      }

      investasiState = {};
      return res.json({ reply });
    }

    if (investasiState.stage === "askRemoveShort") {
      const yes = userMessage.toLowerCase().includes("ya");
      if (!yes) {
        investasiState = {};
        return res.json({
          reply: "✅ Analisis selesai dengan short selling dipertahankan.",
        });
      }

      const positiveIdx = investasiState.bestWeights
        .map((w, i) => (w > 0 ? i : -1))
        .filter((i) => i >= 0);
      const newFiles = positiveIdx.map((i) => investasiState.selectedFiles[i]);

      const rf = 0.0575 / 252;

      const returnsPerSaham = await Promise.all(
        newFiles.map((saham) =>
          bacaCSVKolom(path.join(__dirname, "saham", `${saham}.csv`)).then(
            (data) => data[0]
          )
        )
      );

      const portfolios = [];
      for (let i = 0; i < 2000; i++) {
        const weights = returnsPerSaham.map(() => Math.random());
        const total = weights.reduce((a, b) => a + b, 0);
        const norm = weights.map((w) => w / total);
        const portfolioReturns = returnsPerSaham[0].map((_, idx) =>
          returnsPerSaham.reduce((sum, r, j) => sum + r[idx] * norm[j], 0)
        );
        const sharpe = hitungSharpeRatio(portfolioReturns, rf);
        portfolios.push({ weights: norm, sharpe });
      }

      portfolios.sort((a, b) => b.sharpe - a.sharpe);
      const best = portfolios[0];
      const propReturns = returnsPerSaham[0].map((_, idx) =>
        returnsPerSaham.reduce((sum, r, j) => sum + r[idx] * best.weights[j], 0)
      );
      const VaR = hitungVaR(propReturns, 0.99, investasiState.nominal);

      const detail = best.weights.map(
        (w, i) => `📈 ${newFiles[i]}: ${(w * 100).toFixed(2)}%`
      );

      investasiState = {};
      return res.json({
        reply: `✅ Saham negatif dihapus.\n📉 VaR (99%) baru: Rp${VaR.toFixed(
          2
        ).toLocaleString()}\n📊 Proporsi baru:\n${detail.join("\n")}`,
      });
    }

    // Menabung
    if (investasiState.stage === "menabung-nominal") {
      const match = userMessage.match(/rp?(\d+).*?(\d+)\s*bulan/i);
      if (!match)
        return res.json({
          reply:
            "⚠️ Format salah. Gunakan contoh: Menabung Rp1000000 selama 12 bulan",
        });
      const nominal = parseFloat(match[1]);
      const bulan = parseInt(match[2]);
      const r = 0.05 / 12;
      const futureValue = hitungFutureValue(nominal, r, bulan);
      investasiState = {};
      return res.json({
        reply: `📈 Setelah ${bulan} bulan, uang Anda menjadi Rp${futureValue
          .toFixed(2)
          .toLocaleString()}`,
      });
    }

    // Kewajiban
    if (investasiState.stage === "kewajiban") {
      const match = userMessage.match(/rp?(\d+).*?rp?(\d+)/i);
      if (!match)
        return res.json({
          reply:
            "⚠️ Format salah. Gunakan contoh: Kewajiban Rp5000000 dengan angsuran Rp1000000",
        });
      const kewajiban = parseFloat(match[1]);
      const angsuran = parseFloat(match[2]);
      const r = 0.05 / 12;
      const bulan = hitungLamaBayar(kewajiban, angsuran, r);
      investasiState = {};
      return res.json({
        reply: `📆 Kewajiban Rp${kewajiban.toLocaleString()} dengan angsuran Rp${angsuran.toLocaleString()} lunas dalam ${bulan} bulan.`,
      });
    }

    return res.json({ reply: "Silakan ketik 1, 2, atau 3 untuk memulai." });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Terjadi kesalahan." });
  }
});
