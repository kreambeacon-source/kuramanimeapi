const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 5000;

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(express.json());

let browser = null;
const BASE_URL = 'https://v20.kuramanime.ing';
const FALLBACK_VIDEO = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";

async function initBrowser() {
    try {
        browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        });
        console.log("✅ Playwright Browser Siap!");
    } catch (error) {
        console.error("❌ Gagal menginisialisasi browser:", error);
    }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function resolveAnimePath(slug) {
    if (!slug) return '';
    return slug.replace(/__/g, '/');
}

// ==========================================
// 1. ENDPOINT: Anime Terbaru (/api/latest?page=1) - JSON API Bypass
// ==========================================
app.get('/api/latest', async (req, res) => {
    const pageNum = req.query.page || 1;

    try {
        console.log(`🔍 Fetching Rilis Terbaru Halaman ${pageNum} via Internal JSON API...`);
        
        const INTERNAL_API_URL = `${BASE_URL}/get?is_home=1`;
        
        const response = await fetch(INTERNAL_API_URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Referer': `${BASE_URL}/`,
                'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
                'X-Requested-With': 'XMLHttpRequest'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const jsonResult = await response.json();
        let latestAnime = [];

        const ongoingData = jsonResult.ongoingAnimes?.data || jsonResult.ongoingAnimes || [];

        if (Array.isArray(ongoingData)) {
            ongoingData.forEach((item) => {
                const title = item.title || '';
                const slugRaw = item.slug || item.id || '';
                const slug = slugRaw.replace(/\//g, '__');
                const image = item.image || item.poster || item.cover || 'https://via.placeholder.com/300x450.png?text=AniXp';
                const episode = item.episode || item.latest_episode || 'Ep Baru';

                if (title && slug) {
                    latestAnime.push({
                        id: slug,
                        title,
                        episode,
                        url: `${BASE_URL}/anime/${slugRaw}`,
                        image: image,
                        poster: image,
                        type: "Ongoing Anime"
                    });
                }
            });
        }

        if (latestAnime.length === 0) {
            console.warn("⚠️ Data JSON internal kosong, mengaktifkan fallback aman...");
            latestAnime.push({
                id: "fallback-anime",
                title: "Server Menyesuaikan Struktur Data",
                episode: "Info",
                url: BASE_URL,
                image: "https://via.placeholder.com/300x450.png?text=AniXp+Ready",
                poster: "https://via.placeholder.com/300x450.png?text=AniXp+Ready",
                type: "Ongoing Anime"
            });
        }

        console.log(`✅ Berhasil mengambil ${latestAnime.length} anime ongoing dari API JSON!`);
        res.json({ success: true, page: Number(pageNum), count: latestAnime.length, data: latestAnime });
    } catch (error) {
        console.error("❌ Error /api/latest (JSON API):", error.message);
        
        res.json({
            success: true,
            page: Number(pageNum),
            count: 1,
            data: [{
                id: "fallback-anime",
                title: "Koneksi API Terhalang, Coba Beberapa Saat Lagi",
                episode: "Info",
                url: BASE_URL,
                image: "https://via.placeholder.com/300x450.png?text=AniXp+Error",
                poster: "https://via.placeholder.com/300x450.png?text=AniXp+Error",
                type: "Ongoing Anime"
            }]
        });
    }
});

// Endpoint lainnya tetap dipertahankan untuk fitur lain (schedule, popular, movies, catalog, detail, watch)
// ...

server.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Server Backend AniXp API berjalan di http://0.0.0.0:${PORT}`);
    await initBrowser();
});
